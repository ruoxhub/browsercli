/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Process-lifecycle manager for the ego lite CDP bridge.
 *
 * `ego lite` exposes no TCP debugging port: raw CDP is only reachable through
 * the native `globalThis.ego` binding inside its own embedded Node runtime. The
 * installed `ego-browser` CLI is the supported way in, so the manager spawns
 *
 *     ego-browser nodejs -e "<bootstrap>"
 *
 * where the bootstrap redirects the worker's stdout/stderr into a *sink file*,
 * installs a never-ending stdin, and then imports the worker module.
 *
 * Why files rather than pipes or signals — all probed against ego 0.6.1.13:
 *   1. `-e` does not execute until stdin reaches EOF, so stdin is `'ignore'`.
 *   2. The embedded runtime never streams `process.stdout`/`process.stderr` to
 *      the spawner's pipes while it is alive, so a ready line on a pipe is
 *      unobservable and `start()` could never resolve.
 *   3. The script does not even run in the spawned launcher: it runs in a
 *      utility process of the running ego app, so the spawn env never reaches it
 *      and a signal sent to our launcher never stops the bridge.
 *
 * Hence: `sink` (worker -> manager: ready line, fatal line, diagnostics) and
 * `stop` (manager -> worker: shutdown request), both files.
 */

import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {READY_PREFIX} from './ego-bridge-worker.js';
import {findEgoBrowserBinary, egoSearchRoots} from './ego-detect.js';

/** `[ego-bridge:fatal] <message>` in the sink means the worker gave up. */
const FATAL_PREFIX = '[ego-bridge:fatal]';
/** Prefix the bootstrap puts on every `process.stderr` line. */
const ERR_PREFIX = '[ERR] ';
const DEFAULT_START_TIMEOUT_MS = 20_000;
const DEFAULT_STOP_GRACE_MS = 5_000;
const DEFAULT_KILL_GRACE_MS = 2_000;
/** How often the manager re-reads the sink file. */
const POLL_MS = 50;
/** Bounded diagnostics retention: enough for a diagnosis, never a leak. */
const STDERR_MAX_LINES = 64;
const STDERR_MAX_BYTES = 8 * 1024;
/** A long-lived session must not grow the sink file without bound. */
const SINK_MAX_BYTES = 256 * 1024;
/** How long a failed start waits for its killed child to be reaped. */
const REAP_TIMEOUT_MS = 2_000;

export interface EgoBridgeStartOptions {
  /** Keep the task space's pages when the bridge stops (the worker's `keep:'all'`). */
  keepPage?: boolean;
}

export interface EgoBridgeConnection {
  wsEndpoint: string;
  childPid?: number;
}

/** The `spawn` signature, injectable so tests never launch a real browser. */
export type EgoSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface EgoBridgeManagerOptions {
  /** Binary discovery; defaults to {@link findEgoBrowserBinary}. */
  findBinary?: () => string | null;
  /** The roots to name in "binary not found" errors; defaults to {@link egoSearchRoots}. */
  searchRoots?: () => string[];
  /** Spawn implementation; defaults to `node:child_process.spawn`. */
  spawn?: EgoSpawn;
  /** Ready-line prefix; defaults to the worker's exported {@link READY_PREFIX}. */
  readyPrefix?: string;
  /** How long `start()` waits for the ready line. */
  startTimeoutMs?: number;
  /** How long `stop()` waits after requesting shutdown before SIGTERM. */
  stopGraceMs?: number;
  /** How long `stop()` waits after SIGTERM before SIGKILL. */
  killGraceMs?: number;
  /** Signal sender, injectable to observe the escalation order in tests. */
  kill?: (child: ChildProcess, signal: NodeJS.Signals) => void;
  /** Directory for the sink/stop files; defaults to `os.tmpdir()`. */
  sinkDir?: string;
}

interface BridgeFiles {
  sinkPath: string;
  stopPath: string;
}

interface LiveChild extends BridgeFiles {
  child: ChildProcess;
  connection: EgoBridgeConnection;
}

export class EgoBridgeManager {
  private static instance: EgoBridgeManager | undefined;

  static getInstance(options?: EgoBridgeManagerOptions): EgoBridgeManager {
    if (!EgoBridgeManager.instance) {
      EgoBridgeManager.instance = new EgoBridgeManager(options);
    }
    return EgoBridgeManager.instance;
  }

  static async resetInstance(): Promise<void> {
    if (EgoBridgeManager.instance) {
      await EgoBridgeManager.instance.stop();
      EgoBridgeManager.instance = undefined;
    }
  }

  private readonly findBinary: () => string | null;
  private readonly searchRoots: () => string[];
  private readonly spawnChild: EgoSpawn;
  private readonly readyPrefix: string;
  private readonly startTimeoutMs: number;
  private readonly stopGraceMs: number;
  private readonly killGraceMs: number;
  private readonly kill: (child: ChildProcess, signal: NodeJS.Signals) => void;
  private readonly sinkDir: string;

  private live: LiveChild | undefined;
  private startPromise: Promise<EgoBridgeConnection> | undefined;
  private stopPromise: Promise<void> | undefined;
  /** Bounded diagnostic ring, fed from the sink file and the launcher's stderr. */
  private stderrLines: string[] = [];
  private stderrBytes = 0;
  /** Bytes of the sink already consumed into the ring buffer. */
  private sinkOffset = 0;
  /** A sink line not yet newline-terminated. */
  private sinkPartial = '';
  /** Keeps draining the sink while the bridge lives (W5). */
  private sinkPump: NodeJS.Timeout | undefined;
  /** Files of the current (or last attempted) launch. */
  private files: BridgeFiles | undefined;
  private exitHook: (() => void) | undefined;
  private exitChild: ChildProcess | undefined;

  constructor(options: EgoBridgeManagerOptions = {}) {
    this.findBinary = options.findBinary ?? (() => findEgoBrowserBinary());
    this.searchRoots = options.searchRoots ?? (() => egoSearchRoots());
    this.spawnChild =
      options.spawn ??
      ((command, args, spawnOptions) =>
        nodeSpawn(command, [...args], spawnOptions));
    this.readyPrefix = options.readyPrefix ?? READY_PREFIX;
    this.startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
    this.stopGraceMs = options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.kill = options.kill ?? ((child, signal) => child.kill(signal));
    this.sinkDir = options.sinkDir ?? os.tmpdir();
  }

  /** True while a spawned child is still alive and serving the bridge. */
  isRunning(): boolean {
    const child = this.live?.child;
    return (
      child !== undefined &&
      child.exitCode === null &&
      child.signalCode === null
    );
  }

  /** The retained diagnostic tail, for callers and tests. */
  stderrTail(): string {
    return this.stderrLines.join('\n');
  }

  /**
   * Start (or reuse) the bridge child and resolve once it reported its endpoint.
   *
   * Idempotent while a child is live: a second call returns the same
   * `wsEndpoint` instead of spawning a second bridge.
   */
  async start(
    options: EgoBridgeStartOptions = {},
  ): Promise<EgoBridgeConnection> {
    if (this.startPromise) return this.startPromise;
    if (this.live) return this.live.connection;
    // A stop() in flight owns the teardown; starting underneath it would race the
    // child's exit and leak a process.
    if (this.stopPromise) await this.stopPromise;

    const starting = this.launch(options);
    this.startPromise = starting;
    try {
      return await starting;
    } finally {
      this.startPromise = undefined;
    }
  }

  /**
   * Shut the bridge down: request a stop through the stop file (the only channel
   * that reaches the embedded runtime), wait, then escalate through SIGTERM and
   * SIGKILL against the launcher. Resolves only after the child exited.
   */
  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (this.startPromise) {
      await this.startPromise.catch(() => undefined);
    }

    const live = this.live;
    if (!live) {
      this.removeExitHook();
      this.stopSinkPump();
      this.removeFiles();
      return;
    }

    const stopping = this.terminate(live);
    this.stopPromise = stopping;
    try {
      await stopping;
    } finally {
      if (this.live === live) this.live = undefined;
      this.removeExitHook();
      this.stopSinkPump();
      this.removeFiles();
      this.stopPromise = undefined;
    }
  }

  private async launch(
    options: EgoBridgeStartOptions,
  ): Promise<EgoBridgeConnection> {
    const binary = this.findBinary();
    if (!binary) {
      throw new Error(
        `ego lite is not installed: could not find the ${'ego-browser'} CLI. ` +
          `Searched: ${this.searchRoots().join(', ') || '(no candidate roots)'}. ` +
          'Install ego lite, or set EGO_BROWSER_CLI to the ego-browser binary.',
      );
    }

    this.stderrLines = [];
    this.stderrBytes = 0;
    this.sinkOffset = 0;
    this.sinkPartial = '';
    this.stopSinkPump();

    const files = this.createFiles();
    this.files = files;

    const child = this.spawnChild(
      binary,
      ['nodejs', '-e', workerBootstrap(files, options)],
      {
        // `-e` only runs once stdin is at EOF, and stdin is not a control channel
        // for the embedded runtime at all, so keep it out of the way entirely.
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.childEnv(files, options),
        windowsHide: true,
      },
    );

    this.installExitHook(child);
    // The launcher's own pipes normally stay empty (the script does not run in
    // it), but a launcher that fails before reaching the script reports there.
    this.drainStream(child.stderr);
    this.drainStream(child.stdout);
    // Registered before the ready line so a child that dies immediately after
    // printing it cannot leave `live` pointing at a corpse.
    this.watchForEarlyExit(child);

    try {
      const wsEndpoint = await this.awaitReady(child);
      if (hasExited(child)) {
        throw new Error(
          `ego bridge exited right after printing its ready line` +
            this.diagnosticsSuffix(),
        );
      }
      const connection: EgoBridgeConnection = {
        wsEndpoint,
        childPid: child.pid,
      };
      this.live = {child, connection, ...files};
      // The ready line is the sink's one job; recycling it here means a long
      // session starts from an empty file instead of inheriting the startup log.
      this.truncateSink();
      // Still keep draining for the bridge's whole life, so a chatty worker can
      // never grow the sink (W5) and the tail stays current for later errors.
      this.startSinkPump();
      return connection;
    } catch (error) {
      // Never leave a half-started child behind: a retry must be able to spawn
      // a fresh one, and a stuck runtime would hold the port.
      await this.reap(child, files.stopPath);
      this.removeExitHook();
      this.removeFiles();
      throw error;
    }
  }

  /**
   * Adopt the child's death: clear the connection so the next `start()` spawns a
   * fresh bridge instead of handing out an endpoint nobody is listening on.
   */
  private watchForEarlyExit(child: ChildProcess): void {
    child.once('exit', () => {
      if (this.live?.child !== child) return;
      this.live = undefined;
      this.removeExitHook();
      this.stopSinkPump();
      this.removeFiles();
      // Any consumer still holding the old endpoint gets a connection error from
      // the closed port instead of a hang: the child's listener died with it.
    });
  }

  /**
   * The child's environment.
   *
   * Probed on ego 0.6.1.13: the `-e` script runs in a utility process of the ego
   * app, and the spawn env does not reach it, so every value here is *also*
   * baked into the bootstrap as a literal — that literal is what actually works.
   * Setting the variables keeps one name per value and behaves identically on a
   * host that does propagate the environment.
   */
  private childEnv(
    files: BridgeFiles,
    options: EgoBridgeStartOptions,
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {...process.env};
    env['EGO_BRIDGE_READY_FILE'] = files.sinkPath;
    env['EGO_BRIDGE_STOP_FILE'] = files.stopPath;
    // The manager's own pid: the runtime's real parent is the ego app, so its
    // `process.ppid` points at a process that outlives the manager.
    env['EGO_BRIDGE_PARENT_PID'] = String(process.pid);
    if (options.keepPage) {
      env['EGO_BRIDGE_KEEP_PAGE'] = '1';
    } else {
      // An inherited value would silently change the cleanup policy.
      delete env['EGO_BRIDGE_KEEP_PAGE'];
    }
    return env;
  }

  private drainStream(stream: NodeJS.ReadableStream | null): void {
    if (!stream) return;
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) this.captureLine(line);
    });
    // A launcher that dies mid-write must not raise an unhandled 'error'.
    stream.on('error', () => undefined);
  }

  /** Resolve the endpoint from the sink file; reject on fatal/exit/timeout. */
  private awaitReady(child: ChildProcess): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const startedAt = Date.now();

      const finish = (error: Error | undefined, wsEndpoint?: string): void => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        child.removeListener('exit', onExit);
        child.removeListener('error', onError);
        if (error) reject(error);
        else resolve(wsEndpoint!);
      };

      const fail = (message: string): void =>
        finish(new Error(`${message}${this.diagnosticsSuffix()}`));

      const inspect = (): boolean => {
        const verdict = this.pumpSink();
        if (verdict?.error !== undefined) {
          fail(verdict.error);
          return true;
        }
        if (verdict?.wsEndpoint !== undefined) {
          finish(undefined, verdict.wsEndpoint);
          return true;
        }
        return false;
      };

      const poll = (): void => {
        if (inspect()) return;
        // The child dying is reported by the exit listener; the timeout is the
        // backstop for a child that stays alive but never gets ready.
        if (Date.now() - startedAt >= this.startTimeoutMs) {
          fail(
            `ego bridge timed out after ${this.startTimeoutMs} ms waiting for its ready line`,
          );
        }
      };

      const onExit = (
        code: number | null,
        signal: NodeJS.Signals | null,
      ): void => {
        // One last read: the worker may have written its line just before exit.
        if (inspect()) return;
        fail(
          `ego bridge exited before printing its ready line ` +
            `(${describeExit(code, signal)})`,
        );
      };

      const onError = (error: Error): void => {
        fail(`could not run the ego-browser CLI: ${error.message}`);
      };

      const timer = setInterval(poll, POLL_MS);
      child.once('exit', onExit);
      child.once('error', onError);
    });
  }

  /**
   * Read the sink's new bytes and look for the ready or fatal line.
   *
   * Incremental by design (W5): only new bytes are read, so a chatty worker
   * costs one `read` per poll instead of re-parsing the whole file.
   */
  private pumpSink(): {wsEndpoint?: string; error?: string} | undefined {
    let verdict: {wsEndpoint?: string; error?: string} | undefined;
    for (const line of this.readSinkLines()) {
      if (line.startsWith(this.readyPrefix)) {
        const wsEndpoint = line.slice(this.readyPrefix.length).trim();
        verdict = wsEndpoint
          ? {wsEndpoint}
          : {error: 'ego bridge printed an empty ready line'};
        break;
      }
      if (line.startsWith(FATAL_PREFIX)) {
        verdict = {
          error: `ego bridge failed to start: ${line.slice(FATAL_PREFIX.length).trim()}`,
        };
        break;
      }
    }
    return verdict;
  }

  /**
   * The complete lines appended to the sink since the last call.
   *
   * A file append cannot block the worker the way a full pipe can, so the only
   * requirement is that the file stays small: every line lands in the ring
   * buffer and the file is truncated once it passes {@link SINK_MAX_BYTES}.
   */
  private readSinkLines(): string[] {
    const sinkPath = this.files?.sinkPath;
    if (!sinkPath) return [];
    let text: string;
    try {
      const size = fs.statSync(sinkPath).size;
      if (size < this.sinkOffset) {
        // Truncated behind our back: restart so nothing is skipped.
        this.sinkOffset = 0;
        this.sinkPartial = '';
      }
      if (size <= this.sinkOffset) return [];
      const handle = fs.openSync(sinkPath, 'r');
      try {
        const length = size - this.sinkOffset;
        const buffer = Buffer.alloc(length);
        const read = fs.readSync(handle, buffer, 0, length, this.sinkOffset);
        text = buffer.subarray(0, read).toString('utf8');
        this.sinkOffset += read;
      } finally {
        fs.closeSync(handle);
      }
    } catch {
      return [];
    }

    const lines = (this.sinkPartial + text).split(/\r?\n/);
    this.sinkPartial = lines.pop() ?? '';
    // A worker that never emits a newline must not grow the buffer unbounded.
    if (this.sinkPartial.length > STDERR_MAX_BYTES) this.sinkPartial = '';
    const complete = lines.filter(line => line.length > 0);
    for (const line of complete) this.captureLine(line);
    // The bytes are safely in the ring buffer, so the file may be recycled.
    if (this.sinkOffset > SINK_MAX_BYTES) this.truncateSink();
    return complete;
  }

  private truncateSink(): void {
    const sinkPath = this.files?.sinkPath;
    if (!sinkPath) return;
    try {
      fs.truncateSync(sinkPath, 0);
      this.sinkOffset = 0;
      this.sinkPartial = '';
    } catch {
      // Diagnostics are best effort: losing the file must not fail a session.
    }
  }

  /** Drain the sink for the bridge's whole life so it can never grow (W5). */
  private startSinkPump(): void {
    this.stopSinkPump();
    const pump = setInterval(() => this.readSinkLines(), POLL_MS);
    pump.unref();
    this.sinkPump = pump;
  }

  private stopSinkPump(): void {
    if (!this.sinkPump) return;
    clearInterval(this.sinkPump);
    this.sinkPump = undefined;
  }

  /** Push one diagnostic line into the bounded ring buffer. */
  private captureLine(line: string): void {
    const text = line.startsWith(ERR_PREFIX)
      ? line.slice(ERR_PREFIX.length)
      : line;
    if (!text) return;
    this.stderrLines.push(text);
    this.stderrBytes += text.length + 1;
    while (
      this.stderrLines.length > STDERR_MAX_LINES ||
      this.stderrBytes > STDERR_MAX_BYTES
    ) {
      const dropped = this.stderrLines.shift();
      if (dropped === undefined) break;
      this.stderrBytes -= dropped.length + 1;
    }
  }

  private diagnosticsSuffix(): string {
    const tail = this.stderrLines.join('\n').trim();
    return tail ? `\n--- ego-browser diagnostics ---\n${tail}` : '';
  }

  /**
   * Request shutdown through the stop file, then escalate against the launcher.
   *
   * The stop file is authoritative: probing ego 0.6.1.13 shows the `-e` script
   * runs in a utility process of the ego app, so neither stdin EOF nor a signal
   * to our launcher reaches it (killing the launcher leaves the port listening).
   * The signals remain as a backstop for a host where the launcher does own it.
   */
  private async terminate(live: LiveChild): Promise<void> {
    const exited = waitForExit(live.child);
    this.requestStop(live.stopPath);
    if (await settlesWithin(exited, this.stopGraceMs)) return;

    this.kill(live.child, 'SIGTERM');
    if (await settlesWithin(exited, this.killGraceMs)) return;

    this.kill(live.child, 'SIGKILL');
    await settlesWithin(exited, REAP_TIMEOUT_MS);
  }

  /** Ask the worker to run its cleanup policy and exit. */
  private requestStop(stopPath: string): void {
    try {
      fs.writeFileSync(stopPath, 'stop');
    } catch {
      // The signal escalation is the only remaining option.
    }
  }

  /** Kill a child whose start failed, so `start()` can be retried. */
  private async reap(child: ChildProcess, stopPath: string): Promise<void> {
    const exited = waitForExit(child);
    this.requestStop(stopPath);
    if (await settlesWithin(exited, this.stopGraceMs)) return;
    this.kill(child, 'SIGKILL');
    await settlesWithin(exited, REAP_TIMEOUT_MS);
  }

  /**
   * Ensure browsercli cannot leave an orphan bridge holding a port.
   *
   * Registered once per manager and re-pointed at each new child (a retry after a
   * failed start spawns a different process), then removed by `stop()` or by the
   * child's own exit.
   */
  private installExitHook(child: ChildProcess): void {
    this.exitChild = child;
    if (this.exitHook) return;
    const hook = (): void => {
      // `exit` cannot await: leave the stop request and send the hardest signal.
      const target = this.exitChild;
      if (!target) return;
      try {
        if (this.files) this.requestStop(this.files.stopPath);
        this.kill(target, 'SIGKILL');
      } catch {
        // Nothing useful can be done from an exit handler.
      }
    };
    this.exitHook = hook;
    process.on('exit', hook);
  }

  private removeExitHook(): void {
    this.exitChild = undefined;
    if (!this.exitHook) return;
    process.removeListener('exit', this.exitHook);
    this.exitHook = undefined;
  }

  /** `<dir>/ego-bridge-<pid>-<random>{,.stop}`; unique per launch. */
  private createFiles(): BridgeFiles {
    const suffix = Math.random().toString(36).slice(2, 10);
    const sinkPath = path.join(
      this.sinkDir,
      `ego-bridge-${process.pid}-${suffix}`,
    );
    const stopPath = `${sinkPath}.stop`;
    this.removeFiles();
    fs.writeFileSync(sinkPath, '');
    fs.rmSync(stopPath, {force: true});
    return {sinkPath, stopPath};
  }

  /** Remove the sink and stop files; nothing needs them after this point. */
  private removeFiles(): void {
    const files = this.files;
    this.files = undefined;
    if (!files) return;
    for (const target of [files.sinkPath, files.stopPath]) {
      try {
        fs.rmSync(target, {force: true});
      } catch {
        // Best effort: a leftover temp file is not worth failing a session.
      }
    }
  }
}

/**
 * The ASCII `-e` bootstrap, in the order the contract requires:
 * (a) stdout -> sink, (b) stderr -> `[ERR] ` lines in the same sink,
 * (c) never-ending stdin, (d) import the worker.
 *
 * Every value is an unconditional literal. Probing ego 0.6.1.13 shows the `-e`
 * script runs in a *persistent* utility process of the ego app: the spawn env
 * never reaches it, and `process.env` mutations from earlier `-e` runs are still
 * visible, so a `process.env.X || literal` fallback would happily reuse a stale
 * path from a previous launch. Assign, never fall back.
 */
function workerBootstrap(
  files: BridgeFiles,
  options: EgoBridgeStartOptions,
): string {
  const workerUrl = new URL('./ego-bridge-worker.js', import.meta.url);
  const sink = stringLiteral(files.sinkPath);
  const stop = stringLiteral(files.stopPath);
  const managerPid = stringLiteral(String(process.pid));
  return [
    "const fs = await import('node:fs');",
    `const sink = ${sink};`,
    'process.stdout.write = data => {',
    '  try { fs.appendFileSync(sink, String(data)); } catch (error) {}',
    '  return true;',
    '};',
    'process.stderr.write = data => {',
    '  try {',
    '    const lines = String(data).split(String.fromCharCode(10));',
    "    let out = '';",
    '    for (const line of lines) {',
    "      if (line) out += '[ERR] ' + line + String.fromCharCode(10);",
    '    }',
    '    if (out) fs.appendFileSync(sink, out);',
    '  } catch (error) {}',
    '  return true;',
    '};',
    // `process.stdin` is a getter-only accessor on this runtime, so it has to be
    // redefined rather than assigned.
    "const stream = await import('node:stream');",
    "Object.defineProperty(process, 'stdin', {",
    '  value: new stream.PassThrough(),',
    '  configurable: true,',
    '  writable: true,',
    '});',
    // Values the embedded runtime cannot receive through its environment.
    `process.env.EGO_BRIDGE_READY_FILE = ${sink};`,
    `process.env.EGO_BRIDGE_STOP_FILE = ${stop};`,
    `process.env.EGO_BRIDGE_PARENT_PID = ${managerPid};`,
    options.keepPage
      ? "process.env.EGO_BRIDGE_KEEP_PAGE = '1';"
      : 'delete process.env.EGO_BRIDGE_KEEP_PAGE;',
    `await import('${workerUrl.href}');`,
  ].join('\n');
}

/** A single-quoted JS string literal: ASCII-safe and free of double quotes. */
function stringLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function describeExit(
  code: number | null,
  signal: NodeJS.Signals | null,
): string {
  return signal ? `signal ${signal}` : `code ${code}`;
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (hasExited(child)) return Promise.resolve();
  return new Promise<void>(resolve => child.once('exit', () => resolve()));
}

/** True when `promise` settled within `ms`. */
function settlesWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), ms);
    void promise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
