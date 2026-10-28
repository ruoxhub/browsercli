/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Unit tests for the ego bridge process-lifecycle manager and the binary
 * detector.
 *
 * `start()` is driven against a *fake CLI*: the injected spawn launches
 * `process.execPath -e '<script>'` instead of a real ego lite install, so the
 * readiness-file parsing, sink draining, timeout handling, kill escalation and
 * exit-hook teardown all run for real against a real child process.
 *
 * The fake CLI mirrors the contract the real host was probed into: it reports
 * readiness by appending to `EGO_BRIDGE_READY_FILE`, and it shuts down when
 * `EGO_BRIDGE_STOP_FILE` appears — never via stdin, which the embedded runtime
 * does not provide as a control channel. It binds a real loopback server, so
 * "the endpoint serves while alive and refuses once stopped" is asserted against
 * a real listening socket.
 */

import assert from 'node:assert/strict';
import {spawn, type ChildProcess, type SpawnOptions} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';

import {READY_PREFIX} from '../../../../src/modules/browser/ego/ego-bridge-worker.js';
import {findEgoBrowserBinary} from '../../../../src/modules/browser/ego/ego-detect.js';
import {
  EgoBridgeManager,
  type EgoBridgeManagerOptions,
  type EgoSpawn,
} from '../../../../src/modules/browser/ego/EgoBridgeManager.js';

const FATAL_PREFIX = '[ego-bridge:fatal]';
const NL = 'String.fromCharCode(10)';

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

interface FakeCliOptions {
  /** Runs after the ready line, i.e. it can make the child misbehave. */
  extra?: string;
  /** Ignore the stop file, so only signals can stop the child. */
  ignoreStop?: boolean;
  /** Write the ready line to the sink at all. */
  ready?: boolean;
}

/**
 * Body of a fake ego CLI: bind a real loopback server, append the ready line
 * with the port it really bound to the sink file, then exit when the stop file
 * appears (the real worker's shutdown channel).
 */
function fakeCliBody(
  prefix: string,
  {extra = '', ignoreStop = false, ready = true}: FakeCliOptions = {},
): string {
  const body = [
    "const fs = require('node:fs');",
    "const http = require('node:http');",
    `const NL = ${NL};`,
    `const PREFIX = '${prefix}';`,
    'const sink = process.env.EGO_BRIDGE_READY_FILE;',
    'const stopFile = process.env.EGO_BRIDGE_STOP_FILE;',
    'const w = s => { try { fs.appendFileSync(sink, s + NL); } catch (e) {} };',
    "const server = http.createServer(function (_req, res) { res.end('ok'); });",
    "server.listen(0, '127.0.0.1', function () {",
    '  const port = server.address().port;',
    ready
      ? "  w(PREFIX + ' ws://127.0.0.1:' + port + '/devtools/browser/fake-' + process.pid);"
      : '  void port;',
    '});',
    extra,
  ];
  if (!ignoreStop) {
    // The manager's shutdown channel: a file, not a signal or stdin EOF.
    body.push(
      'const timer = setInterval(function () {',
      '  if (!fs.existsSync(stopFile)) return;',
      '  clearInterval(timer);',
      '  server.close(function () { process.exit(0); });',
      '  setTimeout(function () { process.exit(0); }, 250);',
      '}, 25);',
    );
  } else {
    // Signals are ignored too, so escalation is the only way out.
    body.push(
      "process.on('SIGTERM', function () {});",
      'setInterval(function () {}, 1000);',
    );
  }
  return body.join('\n');
}

interface SpawnRecord {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
  child: ChildProcess;
}

interface SpawnHarness {
  records: SpawnRecord[];
  spawn: EgoSpawn;
  binaryPath: string;
}

/** Injected spawn: runs the fake CLI under the current node, whatever binary resolved. */
function harnessFor(body: string): SpawnHarness {
  const records: SpawnRecord[] = [];
  const binaryPath = path.join(makeTempDir('ego-bin-'), 'ego-browser.exe');
  const spawnFn: EgoSpawn = (command, args, options) => {
    const child = spawn(process.execPath, ['-e', body], {
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
      env: options.env as NodeJS.ProcessEnv,
      windowsHide: true,
    });
    records.push({command, args, options, child});
    return child;
  };
  return {records, spawn: spawnFn, binaryPath};
}

function managerOptions(
  harness: SpawnHarness,
  overrides: Partial<EgoBridgeManagerOptions> = {},
): EgoBridgeManagerOptions {
  return {
    findBinary: () => harness.binaryPath,
    spawn: harness.spawn,
    startTimeoutMs: 4000,
    stopGraceMs: 1000,
    killGraceMs: 1000,
    sinkDir: makeTempDir('ego-sink-'),
    ...overrides,
  };
}

function connectRefused(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const request = http
      .request({host: '127.0.0.1', port, path: '/', timeout: 1000})
      .on('error', () => resolve(true))
      .on('response', response => {
        response.resume();
        resolve(false);
      });
    request.end();
  });
}

function portOf(wsEndpoint: string): number {
  return Number(new URL(wsEndpoint).port);
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (hasExited(child)) return Promise.resolve();
  return new Promise<void>(resolve => child.once('exit', () => resolve()));
}

/** The sink file the manager handed to this launch. */
function sinkOf(record: SpawnRecord): string {
  const value = (record.options.env as NodeJS.ProcessEnv).EGO_BRIDGE_READY_FILE;
  assert.ok(value, 'the manager must hand the child a readiness sink file');
  return value;
}

describe('findEgoBrowserBinary', () => {
  it('picks the highest numeric Windows version instead of the first entry', () => {
    const application = makeTempDir('ego-app-');
    for (const version of [
      '0.6.1.9',
      '0.6.1.13',
      '0.6.1.100',
      'not-a-version',
    ]) {
      const dir = path.join(application, version);
      fs.mkdirSync(dir, {recursive: true});
      fs.writeFileSync(path.join(dir, 'ego-browser.exe'), '');
      // Decoy: the app itself is not the CLI.
      fs.writeFileSync(path.join(dir, 'ego.exe'), '');
    }

    const found = findEgoBrowserBinary({
      platform: 'win32',
      env: {},
      roots: [application],
    });

    assert.equal(
      found,
      path.join(application, '0.6.1.100', 'ego-browser.exe'),
      'plain string order would pick 0.6.1.9; numeric order must pick 0.6.1.100',
    );
  });

  it('finds the macOS helper in the app bundle, preferring Versions/Current', () => {
    const applications = makeTempDir('ego-mac-');
    const appBundle = path.join(applications, 'ego lite.app');
    const framework = path.join(
      appBundle,
      'Contents',
      'Frameworks',
      'ego Framework.framework',
      'Versions',
    );
    const current = path.join(framework, 'Current', 'Helpers');
    const stale = path.join(framework, 'A', 'Helpers');
    fs.mkdirSync(current, {recursive: true});
    fs.mkdirSync(stale, {recursive: true});
    fs.writeFileSync(path.join(current, 'ego-browser'), '');
    fs.writeFileSync(path.join(stale, 'ego-browser'), '');

    const found = findEgoBrowserBinary({
      platform: 'darwin',
      env: {},
      roots: [appBundle],
    });

    assert.equal(found, path.join(current, 'ego-browser'));
  });

  it('returns null instead of throwing when nothing is installed', () => {
    const empty = makeTempDir('ego-empty-');
    const found = findEgoBrowserBinary({
      platform: 'win32',
      env: {},
      roots: [path.join(empty, 'missing'), empty],
    });
    assert.equal(found, null);
  });

  it('lets EGO_BROWSER_CLI override discovery', () => {
    const application = makeTempDir('ego-override-');
    const versionDir = path.join(application, '0.6.1.13');
    fs.mkdirSync(versionDir, {recursive: true});
    fs.writeFileSync(path.join(versionDir, 'ego-browser.exe'), '');

    const override = path.join(
      makeTempDir('ego-custom-'),
      'custom-ego-browser',
    );
    fs.writeFileSync(override, '');

    const found = findEgoBrowserBinary({
      platform: 'win32',
      env: {EGO_BROWSER_CLI: override},
      roots: [application],
    });

    assert.equal(found, override);
  });
});

describe('EgoBridgeManager', () => {
  it('resolves the ready line from the sink file and reuses a live child', async () => {
    const harness = harnessFor(fakeCliBody(READY_PREFIX));
    const manager = new EgoBridgeManager(managerOptions(harness));

    try {
      const first = await manager.start();
      const second = await manager.start();

      assert.match(
        first.wsEndpoint,
        /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/fake-\d+$/,
      );
      assert.equal(second.wsEndpoint, first.wsEndpoint);
      assert.equal(harness.records.length, 1, 'a live child must be reused');
      assert.equal(first.childPid, harness.records[0].child.pid);
      assert.equal(
        await connectRefused(portOf(first.wsEndpoint)),
        false,
        'the reported endpoint must really be listening',
      );
      // W5: the sink must outlive startup so later diagnostics stay drained.
      assert.equal(
        fs.existsSync(sinkOf(harness.records[0])),
        true,
        'the sink must survive a successful start, so it can keep draining',
      );
    } finally {
      await manager.stop();
    }
  });

  it('coalesces concurrent start() calls into one child', async () => {
    const harness = harnessFor(fakeCliBody(READY_PREFIX));
    const manager = new EgoBridgeManager(managerOptions(harness));

    try {
      const [a, b] = await Promise.all([manager.start(), manager.start()]);
      assert.equal(a.wsEndpoint, b.wsEndpoint);
      assert.equal(harness.records.length, 1);
    } finally {
      await manager.stop();
    }
  });

  it('spawns the file-sink bootstrap with stdin ignored', async () => {
    const harness = harnessFor(fakeCliBody(READY_PREFIX));
    const manager = new EgoBridgeManager(managerOptions(harness));

    try {
      await manager.start({keepPage: true});
      const [record] = harness.records;
      const bootstrap = record.args[2];

      assert.equal(record.command, harness.binaryPath);
      assert.equal(record.args[0], 'nodejs');
      assert.equal(record.args[1], '-e');
      // W1: stdin is at EOF from the start, and is not a control channel.
      assert.deepEqual(record.options.stdio, ['ignore', 'pipe', 'pipe']);
      // W2: the worker URL is still a file:/// URL.
      assert.match(
        bootstrap,
        /await import\('file:\/\/\/.+ego-bridge-worker\.js'\)/,
      );
      // W2: readiness travels through the env-named sink file.
      const sink = sinkOf(record);
      assert.match(sink, new RegExp(`ego-bridge-${process.pid}-`));
      assert.ok(
        bootstrap.includes(path.basename(sink)),
        'the sink path must be baked into the bootstrap: the embedded runtime does not inherit the spawn env',
      );
      // W2/W5: the bootstrap must redirect both streams into that sink, in order.
      assert.ok(bootstrap.includes('process.stdout.write'));
      assert.ok(bootstrap.includes('process.stderr.write'));
      assert.ok(bootstrap.includes('[ERR] '), 'stderr lines must be prefixed');
      const workerImportAt = bootstrap.indexOf("await import('file:///");
      assert.ok(workerImportAt > 0, 'the worker must be imported last');
      assert.ok(
        bootstrap.indexOf('process.stdout.write') < workerImportAt,
        'streams must be redirected before the worker is imported',
      );
      // W3: the never-ending stdin must be installed before the import, or the
      // worker's legacy EOF path fires immediately.
      assert.ok(
        bootstrap.indexOf('PassThrough') < workerImportAt,
        'stdin must be replaced before the worker is imported',
      );
      assert.ok(
        bootstrap.lastIndexOf('await import(') === workerImportAt,
        'the worker import must be the final statement',
      );
      // Survives the Windows command line.
      assert.ok(!bootstrap.includes('"'), 'no double quotes in the bootstrap');
      assert.ok(
        /^[\x20-\x7e\n]+$/.test(bootstrap),
        'the bootstrap must be ASCII only',
      );
      // The values the embedded runtime cannot receive via its environment.
      assert.ok(bootstrap.includes('EGO_BRIDGE_STOP_FILE'));
      assert.ok(bootstrap.includes('EGO_BRIDGE_PARENT_PID'));
      assert.equal(
        (record.options.env as NodeJS.ProcessEnv).EGO_BRIDGE_KEEP_PAGE,
        '1',
      );
    } finally {
      await manager.stop();
    }
  });

  it('omits EGO_BRIDGE_KEEP_PAGE unless keepPage is requested', async () => {
    const harness = harnessFor(fakeCliBody(READY_PREFIX));
    const manager = new EgoBridgeManager(managerOptions(harness));

    try {
      await manager.start();
      const [record] = harness.records;
      assert.equal(
        (record.options.env as NodeJS.ProcessEnv).EGO_BRIDGE_KEEP_PAGE,
        undefined,
      );
      // The bootstrap must actively delete an inherited value, not merely omit it.
      assert.ok(
        record.args[2].includes('delete process.env.EGO_BRIDGE_KEEP_PAGE'),
        'an inherited EGO_BRIDGE_KEEP_PAGE must not change the cleanup policy',
      );
    } finally {
      await manager.stop();
    }
  });

  it('rejects with the searched roots when the binary is missing', async () => {
    const manager = new EgoBridgeManager({
      findBinary: () => null,
      searchRoots: () => [
        'C:/Program Files/Citro Labs/ego lite/Application',
        '/Applications/ego lite.app',
      ],
      spawn: () => {
        throw new Error('must not spawn without a binary');
      },
    });

    await assert.rejects(manager.start(), (error: Error) => {
      assert.match(error.message, /ego lite/i);
      assert.match(error.message, /Citro Labs/);
      assert.match(error.message, /ego lite\.app/);
      assert.match(error.message, /EGO_BROWSER_CLI/);
      return true;
    });
  });

  it('rejects with the sink tail when the child exits before the ready line', async () => {
    const harness = harnessFor(
      [
        "const fs = require('node:fs');",
        `process.stderr.write('native bindings unavailable' + ${NL});`,
        'process.exit(3);',
      ].join('\n'),
    );
    const manager = new EgoBridgeManager(managerOptions(harness));

    await assert.rejects(manager.start(), (error: Error) => {
      assert.match(error.message, /exited before/i);
      assert.match(error.message, /code 3/);
      assert.match(error.message, /native bindings unavailable/);
      return true;
    });
    await waitForExit(harness.records[0].child);
    assert.equal(manager.isRunning(), false);
  });

  it('rejects with the fatal message when the child reports a fatal error', async () => {
    const harness = harnessFor(
      [
        "const fs = require('node:fs');",
        'const sink = process.env.EGO_BRIDGE_READY_FILE;',
        `fs.appendFileSync(sink, '${FATAL_PREFIX} ego bridge stopped during start' + ${NL});`,
        'process.exit(1);',
      ].join('\n'),
    );
    const manager = new EgoBridgeManager(managerOptions(harness));

    await assert.rejects(manager.start(), (error: Error) => {
      assert.match(error.message, /ego bridge stopped during start/);
      return true;
    });
    await waitForExit(harness.records[0].child);
  });

  it('rejects on timeout with the sink tail and kills the child', async () => {
    const harness = harnessFor(
      [
        "const fs = require('node:fs');",
        `process.stderr.write('waiting for a task space' + ${NL});`,
        'setInterval(function () {}, 1000);',
      ].join('\n'),
    );
    const manager = new EgoBridgeManager(
      managerOptions(harness, {startTimeoutMs: 150}),
    );

    await assert.rejects(manager.start(), (error: Error) => {
      assert.match(error.message, /timed out/i);
      assert.match(error.message, /waiting for a task space/);
      return true;
    });
    await waitForExit(harness.records[0].child);
    assert.equal(manager.isRunning(), false);
    assert.equal(hasExited(harness.records[0].child), true);
  });

  it('keeps the diagnostic buffer bounded while a chatty child writes the sink', async () => {
    const harness = harnessFor(
      [
        "const fs = require('node:fs');",
        `const line = 'x'.repeat(400) + ${NL};`,
        'for (let i = 0; i < 500; i++) process.stderr.write(line);',
        `process.stderr.write('LAST-DIAGNOSTIC-LINE' + ${NL});`,
        'setInterval(function () {}, 1000);',
      ].join('\n'),
    );
    const manager = new EgoBridgeManager(
      managerOptions(harness, {startTimeoutMs: 2000}),
    );

    // ~200 KiB of diagnostics must be drained, and the error text handed to a
    // user must stay bounded while keeping the newest line.
    await assert.rejects(manager.start(), (error: Error) => {
      assert.match(error.message, /timed out/i);
      assert.match(error.message, /LAST-DIAGNOSTIC-LINE/);
      assert.ok(
        error.message.length < 16 * 1024,
        `error message should stay bounded, got ${error.message.length} bytes`,
      );
      return true;
    });
    await waitForExit(harness.records[0].child);
  });

  it('caps the sink file so a long-lived session cannot grow it (W5)', async () => {
    const harness = harnessFor(
      fakeCliBody(READY_PREFIX, {
        extra: [
          '// ~4 MB of diagnostics, far past the 256 KiB cap.',
          "const chunk = 'y'.repeat(1000) + String.fromCharCode(10);",
          'const writer = setInterval(function () {',
          '  for (let i = 0; i < 200; i++) fs.appendFileSync(sink, "[ERR] " + chunk);',
          '}, 20);',
          'setTimeout(function () { clearInterval(writer); }, 3000);',
        ].join('\n'),
      }),
    );
    const manager = new EgoBridgeManager(managerOptions(harness));

    try {
      await manager.start();
      const sink = sinkOf(harness.records[0]);
      // Let the writer outrun the manager's 50 ms pump for a while.
      await new Promise(resolve => setTimeout(resolve, 1500));
      const size = fs.existsSync(sink) ? fs.statSync(sink).size : 0;
      assert.ok(
        size < 1024 * 1024,
        `the sink must be recycled, but it grew to ${size} bytes`,
      );
      assert.equal(
        manager.isRunning(),
        true,
        'draining must not stall the child',
      );
      // The ring buffer keeps the newest lines and never grows.
      assert.ok(
        manager.stderrTail().length <= 8 * 1024,
        'the retained tail must stay inside its byte budget',
      );
      assert.ok(
        manager.stderrTail().includes('y'.repeat(100)),
        'newest line kept',
      );
    } finally {
      await manager.stop();
    }
  });

  it('can retry start() after a failed start without leaving the first child alive', async () => {
    const harness = harnessFor(fakeCliBody(READY_PREFIX));
    let attempt = 0;
    const spawnFn: EgoSpawn = (command, args, options) => {
      attempt += 1;
      if (attempt > 1) return harness.spawn(command, args, options);
      const child = spawn(
        process.execPath,
        ['-e', "process.stderr.write('first attempt died'); process.exit(7);"],
        {stdio: ['ignore', 'pipe', 'pipe']},
      );
      harness.records.push({command, args, options, child});
      return child;
    };
    const manager = new EgoBridgeManager(
      managerOptions(harness, {spawn: spawnFn}),
    );

    const exitHookBaseline = process.listenerCount('exit');

    try {
      await assert.rejects(manager.start(), /exited before/i);
      assert.equal(
        process.listenerCount('exit'),
        exitHookBaseline,
        'a failed start must not leave its exit hook behind',
      );

      const connection = await manager.start();

      assert.match(connection.wsEndpoint, /^ws:\/\/127\.0\.0\.1:/);
      assert.equal(manager.isRunning(), true);
      assert.equal(harness.records.length, 2);
      assert.equal(hasExited(harness.records[0].child), true);
      assert.equal(await connectRefused(portOf(connection.wsEndpoint)), false);
      assert.equal(process.listenerCount('exit'), exitHookBaseline + 1);
      // A retry gets its own sink, not the failed attempt's.
      assert.notEqual(sinkOf(harness.records[0]), sinkOf(harness.records[1]));
    } finally {
      await manager.stop();
    }
    assert.equal(process.listenerCount('exit'), exitHookBaseline);
  });

  it('stop() requests shutdown through the stop file and is idempotent', async () => {
    const harness = harnessFor(fakeCliBody(READY_PREFIX));
    const signals: NodeJS.Signals[] = [];
    const manager = new EgoBridgeManager(
      managerOptions(harness, {
        kill: (child, signal) => {
          signals.push(signal);
          child.kill(signal);
        },
      }),
    );
    const exitHookBaseline = process.listenerCount('exit');

    const connection = await manager.start();
    const child = harness.records[0].child;
    const stopPath = `${sinkOf(harness.records[0])}.stop`;
    assert.equal(hasExited(child), false);
    assert.equal(process.listenerCount('exit'), exitHookBaseline + 1);
    assert.equal(fs.existsSync(stopPath), false);

    await manager.stop();

    assert.equal(
      hasExited(child),
      true,
      'stop() must resolve only after the child has actually exited',
    );
    assert.equal(manager.isRunning(), false);
    assert.deepEqual(
      signals,
      [],
      'a cooperative child must shut down on the stop file, with no signal',
    );
    assert.equal(
      await connectRefused(portOf(connection.wsEndpoint)),
      true,
      'the stop-file path must have released the port',
    );
    assert.equal(process.listenerCount('exit'), exitHookBaseline);
    assert.equal(
      fs.existsSync(stopPath),
      false,
      'stop file must be cleaned up',
    );

    await manager.stop();
    assert.equal(harness.records.length, 1);
    assert.equal(process.listenerCount('exit'), exitHookBaseline);
  });

  it('escalates SIGTERM then SIGKILL when the child ignores the stop file', async () => {
    const signals: NodeJS.Signals[] = [];
    // A child that ignores the stop file and SIGTERM: only SIGKILL remains.
    const harness = harnessFor(fakeCliBody(READY_PREFIX, {ignoreStop: true}));
    const manager = new EgoBridgeManager(
      managerOptions(harness, {
        stopGraceMs: 40,
        killGraceMs: 40,
        kill: (child, signal) => {
          signals.push(signal);
          if (signal === 'SIGKILL') child.kill('SIGKILL');
        },
      }),
    );

    await manager.start();
    await manager.stop();

    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
    await waitForExit(harness.records[0].child);
    assert.equal(manager.isRunning(), false);
    assert.equal(hasExited(harness.records[0].child), true);
  });

  it('registers exactly one process exit hook and tears the child down from it', async () => {
    const harness = harnessFor(fakeCliBody(READY_PREFIX, {ignoreStop: true}));
    const signals: NodeJS.Signals[] = [];
    const manager = new EgoBridgeManager(
      managerOptions(harness, {
        kill: (child, signal) => {
          signals.push(signal);
          child.kill(signal);
        },
      }),
    );
    const baseline = process.listenerCount('exit');
    const registered: Array<() => void> = [];
    const originalOn = process.on.bind(process);
    process.on = ((event: string, listener: () => void) => {
      if (event === 'exit') registered.push(listener);
      return originalOn(event, listener);
    }) as typeof process.on;

    try {
      await manager.start();
    } finally {
      process.on = originalOn;
    }

    const child = harness.records[0].child;
    try {
      assert.equal(registered.length, 1, 'exactly one exit hook per manager');
      assert.equal(process.listenerCount('exit'), baseline + 1);

      // The hook must really tear the child down, not merely be registered.
      registered[0]();
      await waitForExit(child);
      assert.equal(hasExited(child), true);
      assert.ok(
        signals.includes('SIGKILL'),
        'the exit hook must not be graceful',
      );
    } finally {
      await manager.stop();
    }
    assert.equal(process.listenerCount('exit'), baseline);
  });

  it('parses an injected ready-line prefix instead of a hard-coded one', async () => {
    const custom = '[custom:ready]';
    const harness = harnessFor(fakeCliBody(custom));
    const manager = new EgoBridgeManager(
      managerOptions(harness, {readyPrefix: custom}),
    );

    try {
      const connection = await manager.start();
      assert.match(connection.wsEndpoint, /^ws:\/\/127\.0\.0\.1:\d+\//);
    } finally {
      await manager.stop();
    }
  });

  it('spawns a fresh child after the worker dies on its own', async () => {
    const harness = harnessFor(
      fakeCliBody(READY_PREFIX, {
        extra: 'setTimeout(function () { process.exit(0); }, 60);',
      }),
    );
    const manager = new EgoBridgeManager(managerOptions(harness));

    try {
      const first = await manager.start();
      await waitForExit(harness.records[0].child);

      assert.equal(manager.isRunning(), false);
      assert.equal(
        await connectRefused(portOf(first.wsEndpoint)),
        true,
        'a stale endpoint must fail fast instead of hanging',
      );

      const second = await manager.start();
      assert.notEqual(second.wsEndpoint, first.wsEndpoint);
      assert.equal(harness.records.length, 2);
      assert.equal(manager.isRunning(), true);
    } finally {
      await manager.stop();
    }
  });

  it('lets a second manager start after the first one stopped', async () => {
    const harness = harnessFor(fakeCliBody(READY_PREFIX));
    const first = new EgoBridgeManager(managerOptions(harness));

    await first.start();
    await first.stop();

    const second = new EgoBridgeManager(managerOptions(harness));
    try {
      const connection = await second.start();
      assert.match(connection.wsEndpoint, /^ws:\/\/127\.0\.0\.1:/);
      assert.equal(harness.records.length, 2);
    } finally {
      await second.stop();
    }
  });
});
