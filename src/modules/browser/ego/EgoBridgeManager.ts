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
 *     ego-browser nodejs -e "await import('file:///…/ego-bridge-worker.js')"
 *
 * and supervises that child: it parses the worker's single ready line, drains
 * stderr (a full pipe would stall every CDP message on the worker's serialized
 * native queue), and tears the child down on `stop()` or process exit.
 *
 * stdin is the lifetime channel: the worker treats its EOF as "parent is gone".
 * It is therefore never written to, and only closed to shut the child down.
 */

import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';

import {READY_PREFIX} from './ego-bridge-worker.js';
import {findEgoBrowserBinary, egoSearchRoots} from './ego-detect.js';

/** `[ego-bridge:fatal] <message>` on stdout means the worker gave up. */
const FATAL_PREFIX = '[ego-bridge:fatal]';
const DEFAULT_START_TIMEOUT_MS = 20_000;
const DEFAULT_STOP_GRACE_MS = 5_000;
const DEFAULT_KILL_GRACE_MS = 2_000;
/** Bounded stderr retention: enough for a diagnosis, never a leak. */
const STDERR_MAX_LINES = 64;
const STDERR_MAX_BYTES = 8 * 1024;
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
  /** How long `stop()` waits after closing stdin before SIGTERM. */
  stopGraceMs?: number;
  /** How long `stop()` waits after SIGTERM before SIGKILL. */
  killGraceMs?: number;
  /** Signal sender, injectable to observe the escalation order in tests. */
  kill?: (child: ChildProcess, signal: NodeJS.Signals) => void;
}

interface LiveChild {
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

  private live: LiveChild | undefined;
  private startPromise: Promise<EgoBridgeConnection> | undefined;
  private stopPromise: Promise<void> | undefined;
  private stderrLines: string[] = [];
  private stderrBytes = 0;
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

  /** The retained stderr tail, for diagnostics. */
  stderrTail(): string {
    return this.stderrLines.join('\n');
  }

  /**
   * Start (or reuse) the bridge child and resolve once it printed its endpoint.
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
   * Shut the bridge down: close stdin (the worker's graceful path), wait, then
   * escalate through SIGTERM and SIGKILL. Resolves only after the child exited.
   */
  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (this.startPromise) {
      await this.startPromise.catch(() => undefined);
    }

    const live = this.live;
    if (!live) {
      this.removeExitHook();
      return;
    }

    const stopping = this.terminate(live.child);
    this.stopPromise = stopping;
    try {
      await stopping;
    } finally {
      if (this.live === live) this.live = undefined;
      this.removeExitHook();
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

    const child = this.spawnChild(binary, ['nodejs', '-e', workerBootstrap()], {
      // stdin stays piped and open: it is the child's lifetime signal, so it must
      // not be written to and must not be closed until shutdown.
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.childEnv(options),
      windowsHide: true,
    });

    this.installExitHook(child);
    this.drainStderr(child);
    // Registered before the ready line so a child that dies immediately after
    // printing it cannot leave `live` pointing at a corpse.
    this.watchForEarlyExit(child);

    try {
      const wsEndpoint = await this.awaitReady(child);
      if (hasExited(child)) {
        throw new Error(
          `ego bridge exited right after printing its ready line` +
            this.stderrSuffix(),
        );
      }
      const connection: EgoBridgeConnection = {
        wsEndpoint,
        childPid: child.pid,
      };
      this.live = {child, connection};
      return connection;
    } catch (error) {
      // Never leave a half-started child behind: a retry must be able to spawn
      // a fresh one, and an orphan would hold the port.
      await this.reap(child);
      this.removeExitHook();
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
      // Any consumer still holding the old endpoint gets a connection error from
      // the closed port instead of a hang: the child's listener died with it.
    });
  }

  private childEnv(options: EgoBridgeStartOptions): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {...process.env};
    if (options.keepPage) {
      env['EGO_BRIDGE_KEEP_PAGE'] = '1';
    } else {
      // An inherited value would silently change the cleanup policy.
      delete env['EGO_BRIDGE_KEEP_PAGE'];
    }
    return env;
  }

  /**
   * Keep a bounded tail of the child's stderr for the child's whole life.
   *
   * The worker may write one line per dropped foreign target event, so this
   * stream MUST be drained or its pipe fills and the child blocks. The ring
   * buffer keeps the newest lines within a fixed budget.
   */
  private drainStderr(child: ChildProcess): void {
    const stream = child.stderr;
    if (!stream) return;
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => this.captureStderr(chunk));
  }

  /** Resolve the endpoint from the first ready line; reject on fatal/exit/timeout. */
  private awaitReady(child: ChildProcess): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let stdoutBuffer = '';

      const finish = (error: Error | undefined, wsEndpoint?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdout?.removeListener('data', onStdout);
        child.removeListener('exit', onExit);
        child.removeListener('error', onError);
        if (error) reject(error);
        else resolve(wsEndpoint!);
      };

      const fail = (message: string): void =>
        finish(new Error(`${message}${this.stderrSuffix()}`));

      const onStdout = (chunk: string): void => {
        stdoutBuffer += chunk;
        let newline = stdoutBuffer.indexOf('\n');
        while (newline !== -1) {
          const line = stdoutBuffer.slice(0, newline).trim();
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
          if (line.startsWith(this.readyPrefix)) {
            const wsEndpoint = line.slice(this.readyPrefix.length).trim();
            if (!wsEndpoint) {
              fail('ego bridge printed an empty ready line');
              return;
            }
            finish(undefined, wsEndpoint);
            return;
          }
          if (line.startsWith(FATAL_PREFIX)) {
            fail(
              `ego bridge failed to start: ${line.slice(FATAL_PREFIX.length).trim()}`,
            );
            return;
          }
          newline = stdoutBuffer.indexOf('\n');
        }
        // Guard against a child that never emits a newline.
        if (stdoutBuffer.length > STDERR_MAX_BYTES) stdoutBuffer = '';
      };

      const onExit = (
        code: number | null,
        signal: NodeJS.Signals | null,
      ): void => {
        fail(
          `ego bridge exited before printing its ready line ` +
            `(${describeExit(code, signal)})`,
        );
      };

      const onError = (error: Error): void => {
        fail(`could not run the ego-browser CLI: ${error.message}`);
      };

      const timer = setTimeout(() => {
        fail(
          `ego bridge timed out after ${this.startTimeoutMs} ms waiting for its ready line`,
        );
      }, this.startTimeoutMs);

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', onStdout);
      child.once('exit', onExit);
      child.once('error', onError);
    });
  }

  private captureStderr(chunk: string): void {
    for (const line of chunk.split('\n')) {
      if (!line) continue;
      this.stderrLines.push(line);
      this.stderrBytes += line.length + 1;
    }
    while (
      this.stderrLines.length > STDERR_MAX_LINES ||
      this.stderrBytes > STDERR_MAX_BYTES
    ) {
      const dropped = this.stderrLines.shift();
      if (dropped === undefined) break;
      this.stderrBytes -= dropped.length + 1;
    }
  }

  private stderrSuffix(): string {
    const tail = this.stderrLines.join('\n').trim();
    return tail ? `\n--- ego-browser stderr ---\n${tail}` : '';
  }

  /** Close stdin, then escalate; resolves once the child is really gone. */
  private async terminate(child: ChildProcess): Promise<void> {
    const exited = waitForExit(child);
    // The worker's graceful path: stdin EOF means "parent is gone".
    child.stdin?.end();
    if (await settlesWithin(exited, this.stopGraceMs)) {
      drain(child);
      return;
    }

    this.kill(child, 'SIGTERM');
    if (await settlesWithin(exited, this.killGraceMs)) {
      drain(child);
      return;
    }

    this.kill(child, 'SIGKILL');
    await settlesWithin(exited, REAP_TIMEOUT_MS);
    drain(child);
  }

  /** Kill a child whose start failed, so `start()` can be retried. */
  private async reap(child: ChildProcess): Promise<void> {
    const exited = waitForExit(child);
    child.stdin?.end();
    if (await settlesWithin(exited, this.stopGraceMs)) {
      drain(child);
      return;
    }
    this.kill(child, 'SIGKILL');
    await settlesWithin(exited, REAP_TIMEOUT_MS);
    drain(child);
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
      // `exit` cannot await: send the hardest signal so the port is released.
      const target = this.exitChild;
      if (!target) return;
      try {
        target.stdin?.end();
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
}

/** `await import('<file:///…/ego-bridge-worker.js>')`, ASCII only, no double quotes. */
function workerBootstrap(): string {
  const workerUrl = new URL('./ego-bridge-worker.js', import.meta.url);
  return `await import('${workerUrl.href}')`;
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

/** Release whatever pipes the dead child left behind. */
function drain(child: ChildProcess): void {
  child.stdout?.resume();
  child.stderr?.resume();
  child.stdin?.destroy();
}
