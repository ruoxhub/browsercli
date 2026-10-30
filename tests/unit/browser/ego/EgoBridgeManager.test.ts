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
import {pathToFileURL} from 'node:url';

import {
  READY_PREFIX,
  workspaceTaskSpaceName,
} from '../../../../src/modules/browser/ego/ego-bridge-worker.js';
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

/**
 * A stub worker module, imported by the manager-generated bootstrap in the
 * `-e` execution tests (I3).
 *
 * It stands in for `ego-bridge-worker.js` and asserts the *contract the bootstrap
 * provides to it* from inside the process that actually ran the bootstrap: the
 * four baked values are present, stdin was replaced by a never-ending stream, and
 * readiness travels through the sink file. Then it opens a real loopback listener
 * and exits when the stop file appears.
 */
function stubWorkerBody(): string {
  const NL = `String.fromCharCode(10)`;
  const lines = [
    "const fs = require('node:fs');",
    "const http = require('node:http');",
    'const out = process.env.EGO_BRIDGE_STUB_ASSERTIONS;',
    'const fail = function (why) {',
    `  fs.appendFileSync(out, 'FAIL ' + why + ${NL});`,
    '  process.exit(9);',
    '};',
    'const required = [',
    "  'EGO_BRIDGE_READY_FILE',",
    "  'EGO_BRIDGE_STOP_FILE',",
    "  'EGO_BRIDGE_PARENT_PID',",
    "  'EGO_BRIDGE_TASK_SPACE_NAME',",
    '];',
    'for (const name of required) {',
    '  const value = process.env[name];',
    "  if (typeof value !== 'string' || value.length === 0) {",
    "    fail(name + ' is missing or empty');",
    '  }',
    '}',
    'if (!/^[0-9]+$/.test(process.env.EGO_BRIDGE_PARENT_PID)) {',
    "  fail('parent pid is not a pid');",
    '}',
    'if (!/^browsercli-[0-9a-f]{12}$/.test(process.env.EGO_BRIDGE_TASK_SPACE_NAME)) {',
    "  fail('task space name is not a workspace name');",
    '}',
    // The bootstrap must have replaced stdin with a never-ending stream, otherwise
    // the worker's legacy stdin-EOF shutdown path would fire immediately.
    "if (process.stdin.readableEnded) fail('stdin was not replaced');",
    "process.stdin.on('end', function () { fail('stdin ended'); });",
    'process.stdin.resume();',
    'const stopFile = process.env.EGO_BRIDGE_STOP_FILE;',
    'const server = http.createServer(function (_req, res) {',
    '  res.end(process.env.EGO_BRIDGE_TASK_SPACE_NAME);',
    '});',
    "server.listen(0, '127.0.0.1', function () {",
    '  const port = server.address().port;',
    // The bootstrap must prefix stderr lines and append them to the same sink; the
    // check runs before the ready line so the manager cannot have truncated yet.
    "  process.stderr.write('stub-diagnostic-marker' + " + NL + ');',
    '  const sinkText = fs',
    '    .readFileSync(process.env.EGO_BRIDGE_READY_FILE)',
    "    .toString('utf8');",
    "  if (sinkText.indexOf('[ERR] stub-diagnostic-marker') < 0) {",
    "    fail('stderr was not prefixed with [ERR] and redirected into the sink');",
    '  }',
    // Written to stdout on purpose: the bootstrap must redirect it into the sink,
    // otherwise the manager can never observe readiness on the real host.
    "  process.stdout.write('[ego-bridge:ready] ws://127.0.0.1:' + port +",
    "    '/devtools/browser/stub-' + process.pid + " + NL + ');',
    '});',
    'const timer = setInterval(function () {',
    '  if (!fs.existsSync(stopFile)) return;',
    '  clearInterval(timer);',
    '  server.close(function () { process.exit(0); });',
    '  setTimeout(function () { process.exit(0); }, 250);',
    '}, 25);',
  ];
  return lines.join(String.fromCharCode(10));
}

/** Write the stub worker as a real `.mjs` file the bootstrap can import. */
function writeStubWorker(): string {
  const file = path.join(makeTempDir('ego-stub-'), 'stub-worker.cjs');
  fs.writeFileSync(file, stubWorkerBody());
  return file;
}

/**
 * Run the manager's own bootstrap under the current node. `args[0]` is ego's
 * `nodejs` subcommand, which is ego's CLI syntax rather than node's, so only the
 * `-e <bootstrap>` tail is passed on.
 */
function spawnRecordedArgs(args: readonly string[], options: SpawnOptions) {
  return spawn(process.execPath, [...args.slice(1)], {
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    env: options.env as NodeJS.ProcessEnv,
    windowsHide: true,
  });
}

interface BootstrapHarness extends SpawnHarness {
  /** The worker URL to inject, so the bootstrap imports the stub. */
  workerUrl: string;
  /** Where the stub records its own assertion failures. */
  assertionFile: string;
}

/**
 * A harness that runs the *manager's own* bootstrap instead of a test body:
 * `process.execPath -e <args[2]>`, with the worker URL pointed at a stub module.
 * Nothing about the bootstrap is re-implemented here (I3).
 */
function bootstrapHarness(): BootstrapHarness {
  const records: SpawnRecord[] = [];
  const binaryPath = path.join(makeTempDir('ego-bin-'), 'ego-browser.exe');
  const assertionFile = path.join(makeTempDir('ego-assert-'), 'stub.log');
  fs.writeFileSync(assertionFile, '');
  const workerUrl = pathToFileURL(writeStubWorker()).href;
  const spawnFn: EgoSpawn = (command, args, options) => {
    const env = {...(options.env as NodeJS.ProcessEnv)};
    env.EGO_BRIDGE_STUB_ASSERTIONS = assertionFile;
    const child = spawnRecordedArgs(args, {...options, env});
    records.push({command, args, options, child});
    return child;
  };
  return {records, spawn: spawnFn, binaryPath, workerUrl, assertionFile};
}

/** The stub's own view of the bootstrap contract: empty means it was satisfied. */
function stubAssertions(harness: BootstrapHarness): string {
  return fs.readFileSync(harness.assertionFile, 'utf8').trim();
}

/**
 * A fake CLI whose bridge lives in a *separate, detached* process, exactly like the
 * real host: the `-e` script runs in ego's persistent utility process, so killing
 * our launcher does not stop the bridge. `EGO_BRIDGE_READY_FILE` /
 * `EGO_BRIDGE_STOP_FILE` are inherited by the detached bridge, so the ready line and
 * the shutdown request still travel through the manager's files (I2a).
 */
function independentBridgeHarness(): SpawnHarness {
  const records: SpawnRecord[] = [];
  const binaryPath = path.join(makeTempDir('ego-bin-'), 'ego-browser.exe');
  const bridgeFile = path.join(makeTempDir('ego-bridge-'), 'bridge.cjs');
  fs.writeFileSync(
    bridgeFile,
    [
      "const fs = require('node:fs');",
      "const http = require('node:http');",
      'const sink = process.env.EGO_BRIDGE_READY_FILE;',
      'const stopFile = process.env.EGO_BRIDGE_STOP_FILE;',
      'const prefix = process.env.EGO_STUB_PREFIX;',
      'const server = http.createServer(function (_req, res) { res.end(prefix); });',
      "server.listen(0, '127.0.0.1', function () {",
      '  const port = server.address().port;',
      '  fs.appendFileSync(sink, prefix +',
      "    ' ws://127.0.0.1:' + port + '/devtools/browser/detached-' + process.pid + ",
      '    String.fromCharCode(10));',
      '});',
      'setInterval(function () {',
      '  if (!fs.existsSync(stopFile)) return;',
      '  server.close(function () { process.exit(0); });',
      '  setTimeout(function () { process.exit(0); }, 250);',
      '}, 25);',
    ].join(String.fromCharCode(10)),
  );
  // The launcher: spawn the detached bridge, then stay alive doing nothing (it is
  // not the bridge, so its death must not be mistaken for the bridge dying).
  const launcher = [
    "const {spawn} = require('node:child_process');",
    `const bridge = spawn(process.execPath, [${JSON.stringify(bridgeFile)}], {`,
    "  detached: true, stdio: 'ignore', env: process.env,",
    '});',
    'bridge.unref();',
    'setInterval(function () {}, 1000);',
  ].join(String.fromCharCode(10));
  const spawnFn: EgoSpawn = (command, args, options) => {
    const env = {
      ...(options.env as NodeJS.ProcessEnv),
      EGO_STUB_PREFIX: READY_PREFIX,
    };
    const child = spawn(process.execPath, ['-e', launcher], {
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
      env,
      windowsHide: true,
    });
    records.push({command, args, options, child});
    return child;
  };
  return {records, spawn: spawnFn, binaryPath};
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

/** The HTTP body the stub worker serves: the task-space name it was given. */
function bodyOf(wsEndpoint: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get(
        {host: '127.0.0.1', port: portOf(wsEndpoint), path: '/', timeout: 1000},
        response => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            body += chunk;
          });
          response.on('end', () => resolve(body));
        },
      )
      .on('error', reject);
  });
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

  // This exercises the launcher's own stderr pipe (`drainStream`), not the sink
  // file: the child never reaches the `-e` bootstrap's sink redirection.
  it('rejects with the launcher stderr tail when the child exits before the ready line', async () => {
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

  it('drains a burst larger than one sink read without losing lines (Minors)', async () => {
    // The single read is capped (64 KiB x 64), so a burst past that is drained over
    // several polls. Nothing may be lost in between: the newest line must survive
    // and the ring buffer must stay inside its budget.
    const harness = harnessFor(
      fakeCliBody(READY_PREFIX, {
        extra: [
          '// ~1 MiB in one synchronous burst, plus a numbered last line.',
          'const chunk = "BURST-" + "z".repeat(990) + String.fromCharCode(10);',
          'let burst = "";',
          'for (let i = 0; i < 1050; i++) burst += chunk;',
          'fs.appendFileSync(sink, burst);',
          'fs.appendFileSync(sink, "LAST-BURST-LINE" + String.fromCharCode(10));',
        ].join(String.fromCharCode(10)),
      }),
    );
    const manager = new EgoBridgeManager(managerOptions(harness));

    try {
      await manager.start();
      const sink = sinkOf(harness.records[0]);
      // Give the pump time to work through the burst and truncate.
      await new Promise(resolve => setTimeout(resolve, 600));
      assert.equal(
        manager.isRunning(),
        true,
        'draining must not stall the child',
      );
      assert.ok(
        manager.stderrTail().includes('LAST-BURST-LINE'),
        'the newest line must be reached across the capped reads',
      );
      assert.ok(
        manager.stderrTail().length <= 8 * 1024,
        'the retained tail must stay inside its byte budget',
      );
      const size = fs.existsSync(sink) ? fs.statSync(sink).size : 0;
      assert.ok(size < 1024 * 1024, `the sink must be recycled, got ${size}`);
    } finally {
      await manager.stop();
    }
  });

  it('decodes a multi-byte character split across a 64 KiB sink read (R2)', async () => {
    // Diagnostics are read in 64 KiB chunks. Decoding each chunk on its own turns a
    // character that straddles a boundary into U+FFFD; one decoder across chunks
    // carries the partial sequence over instead.
    const harness = harnessFor(fakeCliBody(READY_PREFIX));
    const manager = new EgoBridgeManager(managerOptions(harness));

    try {
      await manager.start();
      const sink = sinkOf(harness.records[0]);
      // Padding of exactly 64 KiB - 1 bytes, so the first byte of a 3-byte character
      // is the *last* byte of the manager's first read and the other two come from
      // the second one.
      const padding =
        ('p'.repeat(1000) + '\n').repeat(65) + 'q'.repeat(469) + '\n';
      assert.equal(Buffer.byteLength(padding), 64 * 1024 - 1);
      fs.appendFileSync(
        sink,
        Buffer.from(`${padding}€-SPLIT-CHAR\nTAIL-END\n`, 'utf8'),
      );
      // Let the sink pump drain the whole burst.
      await new Promise(resolve => setTimeout(resolve, 400));

      const tail = manager.stderrTail();
      assert.ok(
        tail.includes('€-SPLIT-CHAR'),
        `the split character must decode intact, tail was: ${JSON.stringify(tail.slice(-200))}`,
      );
      assert.ok(tail.includes('TAIL-END'), 'the burst must be fully drained');
      assert.ok(
        !tail.includes('\uFFFD'),
        'no replacement character may appear where the character was split',
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

  it('leaves the stop request readable after a failed start, so a live worker can stop', async () => {
    // The launcher's death does not stop the worker (it runs in ego's utility
    // process). A start that failed before its ready line therefore has no
    // endpoint to probe and no `tracked` entry — the stop file is the only thing
    // that still reaches that worker. Deleting it immediately (as the cleanup once
    // did) left a listening bridge nothing could ask to stop, while the next
    // start() spawned a second one on the same task space.
    const harness = harnessFor(fakeCliBody(READY_PREFIX));
    // The launcher exits at once but leaves a marker behind, so we can observe how
    // long its stop file survives without needing a live bridge.
    const spawnFn: EgoSpawn = (command, args, options) => {
      const child = spawn(process.execPath, ['-e', 'process.exit(9)'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      harness.records.push({command, args, options, child});
      return child;
    };
    const manager = new EgoBridgeManager(
      managerOptions(harness, {spawn: spawnFn, startTimeoutMs: 3_000}),
    );

    const started = manager.start();
    const startedAt = Date.now();
    let seen = false;
    let stopPath: string | undefined;
    const watcher = setInterval(() => {
      if (stopPath === undefined) {
        const record = harness.records[0];
        if (!record) return;
        stopPath = `${sinkOf(record)}.stop`;
      }
      if (fs.existsSync(stopPath)) seen = true;
    }, 20);
    try {
      await assert.rejects(started, /exited before/i);
    } finally {
      clearInterval(watcher);
    }
    const elapsedMs = Date.now() - startedAt;

    // `reap()` asked for a stop; that request must outlive the launcher long
    // enough for a worker polling once a second to notice, instead of vanishing in
    // the same tick and leaving a bridge nothing can shut down.
    assert.equal(
      seen,
      true,
      'the only channel that can still stop the worker must not be dropped',
    );
    assert.ok(
      elapsedMs >= 1_000,
      `a failed start must give the worker one poll to see the request, took ${elapsedMs}ms`,
    );
    // ...and it must be gone afterwards, so temp files do not accumulate.
    assert.equal(fs.existsSync(stopPath!), false);
  });

  it('creates the sink and stop files owner-only, in a shared tmpdir', async () => {
    // The sink briefly carries the ready line — a live ws endpoint — and the stop
    // file is a shutdown channel. Both live in `os.tmpdir()`, which is world
    // readable, so the default 0644 would expose the endpoint and let another
    // local user kill this bridge. POSIX only: Windows has no mode bits, and
    // `statSync().mode` reports a synthesized value there.
    if (process.platform === 'win32') return;
    const harness = harnessFor(fakeCliBody(READY_PREFIX));
    const manager = new EgoBridgeManager(managerOptions(harness));
    try {
      await manager.start();
      const sink = sinkOf(harness.records[0]);
      const stopPath = `${sink}.stop`;
      assert.equal(
        fs.statSync(sink).mode & 0o777,
        0o600,
        'the sink must be owner-only',
      );
      // The stop file does not exist until a shutdown is requested; asking for one
      // and then letting the bridge die on it is what exercises `requestStop()`.
      await manager.stop();
      assert.equal(fs.existsSync(stopPath), false);
    } finally {
      await manager.stop().catch(() => undefined);
    }
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

  it('bakes a per-workspace task-space name into the bootstrap (I1)', async () => {
    // The worker runs in ego's persistent utility process, where cwd is ego's
    // application directory for every workspace. Two workspaces must still get
    // two different task spaces, so the manager hashes its own cwd.
    const workspaceA = makeTempDir('ego-ws-a-');
    const workspaceB = makeTempDir('ego-ws-b-');
    const harness = bootstrapHarness();
    const managerA = new EgoBridgeManager(
      managerOptions(harness, {
        workerUrl: harness.workerUrl,
        cwd: workspaceA,
      }),
    );
    const managerB = new EgoBridgeManager(
      managerOptions(harness, {
        workerUrl: harness.workerUrl,
        cwd: workspaceB,
      }),
    );

    try {
      const a = await managerA.start();
      const b = await managerB.start();
      const [recordA, recordB] = harness.records;

      const nameA = workspaceTaskSpaceName(workspaceA);
      const nameB = workspaceTaskSpaceName(workspaceB);
      assert.notEqual(
        nameA,
        nameB,
        'different workspaces must not share a name',
      );
      assert.match(nameA, /^browsercli-[0-9a-f]{12}$/);

      // It reaches the runtime as an unconditional literal, not as an env lookup:
      // the spawn env never arrives and `process.env` leaks across `-e` runs.
      for (const [record, name] of [
        [recordA, nameA],
        [recordB, nameB],
      ] as const) {
        assert.ok(
          record.args[2].includes(
            `process.env.EGO_BRIDGE_TASK_SPACE_NAME = '${name}';`,
          ),
          'the task-space name must be baked into the bootstrap',
        );
        assert.ok(
          !record.args[2].includes('|| workspaceTaskSpaceName'),
          'the bootstrap must assign the name, never fall back to a previous run',
        );
      }

      // And the runtime really sees it: the stub worker fails closed when the
      // value is missing or malformed, and it echoes the name it was given.
      assert.equal(stubAssertions(harness), '');
      assert.equal(await bodyOf(a.wsEndpoint), nameA);
      assert.equal(await bodyOf(b.wsEndpoint), nameB);
    } finally {
      await managerA.stop();
      await managerB.stop();
    }
  });

  it('runs the manager-generated bootstrap under node -e and talks to it (I3)', async () => {
    // The only executing test of the real bootstrap that does not need ego: the
    // stub worker stands in for the worker module, everything else is the
    // manager's own argv, sink, stdin replacement and env literals.
    const harness = bootstrapHarness();
    const manager = new EgoBridgeManager(
      managerOptions(harness, {workerUrl: harness.workerUrl}),
    );

    try {
      const connection = await manager.start();
      const [record] = harness.records;

      // The bootstrap was executed, not merely generated: the stub only runs if
      // the import at the end of it succeeded.
      assert.equal(
        stubAssertions(harness),
        '',
        'the stub saw the full contract',
      );
      assert.equal(manager.isRunning(), true);
      assert.match(
        connection.wsEndpoint,
        /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/stub-\d+$/,
      );
      // Readiness really came through the sink the manager polls.
      const sink = sinkOf(record);
      assert.equal(
        (record.options.env as NodeJS.ProcessEnv).EGO_BRIDGE_TASK_SPACE_NAME,
        workspaceTaskSpaceName(process.cwd()),
      );
      assert.ok(
        fs.existsSync(sink),
        'the sink must exist while the bridge lives',
      );
      const port = portOf(connection.wsEndpoint);
      assert.equal(await connectRefused(port), false, 'the endpoint serves');

      await manager.stop();

      assert.equal(manager.isRunning(), false);
      assert.equal(
        await connectRefused(port),
        true,
        'stop() must close the port the stub was listening on',
      );
    } finally {
      await manager.stop();
    }
  });

  it('stop() still closes the bridge after the launcher died (I2a)', async () => {
    // The bridge lives in ego's persistent utility process, so killing the launcher
    // demonstrably leaves it listening. The stop file is then the only mechanism,
    // which means it may not be deleted when the launcher exits.
    const harness = independentBridgeHarness();
    const manager = new EgoBridgeManager(managerOptions(harness));
    const connection = await manager.start();
    const port = portOf(connection.wsEndpoint);
    const stopPath = `${sinkOf(harness.records[0])}.stop`;

    // Simulate the launcher dying on its own: the bridge keeps its port.
    harness.records[0].child.kill('SIGKILL');
    await waitForExit(harness.records[0].child);

    assert.equal(manager.isRunning(), false, 'the launcher is gone');
    assert.equal(
      await connectRefused(port),
      false,
      'the bridge is still listening, which is the whole problem',
    );

    try {
      await manager.stop();

      assert.equal(
        await connectRefused(port),
        true,
        'stop() must shut down a bridge whose launcher is already dead',
      );
      assert.equal(fs.existsSync(stopPath), false, 'then clean it up');
    } finally {
      // The detached bridge has no manager watching it: leave it a stop request so
      // a failed assertion cannot strand a listening port.
      fs.writeFileSync(stopPath, 'stop');
    }
  });

  it('rejects stop() when the bridge survives every shutdown channel (I2b)', async () => {
    // A launcher that never actually receives a signal: the child stays alive.
    const harness = harnessFor(fakeCliBody(READY_PREFIX, {ignoreStop: true}));
    const manager = new EgoBridgeManager(
      managerOptions(harness, {
        stopGraceMs: 40,
        killGraceMs: 40,
        kill: () => {
          // Swallow every signal: nothing can stop this bridge.
        },
      }),
    );

    const connection = await manager.start();
    const stopPath = `${sinkOf(harness.records[0])}.stop`;

    try {
      await assert.rejects(manager.stop(), (error: Error) => {
        assert.match(error.message, /did not stop/i);
        assert.match(error.message, /stop file/);
        assert.match(error.message, /SIGTERM/);
        assert.match(error.message, /SIGKILL/);
        return true;
      });
      // A failed shutdown must stay retryable: the stop file is the mechanism.
      assert.equal(
        fs.existsSync(stopPath),
        true,
        'a failed stop() must not delete the stop file',
      );
      assert.equal(
        await connectRefused(portOf(connection.wsEndpoint)),
        false,
        'the port must still be listening, so the failure was real',
      );
    } finally {
      // Now really tear it down, so the runner exits.
      harness.records[0].child.kill('SIGKILL');
      await waitForExit(harness.records[0].child);
    }
  });

  it('lets a failed stop() be retried, keeping the stop file it needs (I2b)', async () => {
    // A shutdown that reports failure must stay actionable: the tracked bridge, the
    // exit hook and the stop file survive, so a second stop() can finish the job.
    const harness = harnessFor(fakeCliBody(READY_PREFIX, {ignoreStop: true}));
    const signals: NodeJS.Signals[] = [];
    let swallow = true;
    const manager = new EgoBridgeManager(
      managerOptions(harness, {
        stopGraceMs: 40,
        killGraceMs: 40,
        kill: (child, signal) => {
          signals.push(signal);
          if (!swallow) child.kill(signal);
        },
      }),
    );
    const exitHookBaseline = process.listenerCount('exit');

    const connection = await manager.start();
    const stopPath = `${sinkOf(harness.records[0])}.stop`;

    try {
      await assert.rejects(manager.stop(), /did not stop/i);
      assert.equal(fs.existsSync(stopPath), true);
      assert.equal(
        process.listenerCount('exit'),
        exitHookBaseline + 1,
        'the exit hook must survive a failed stop, or nothing could retry',
      );

      // Second attempt, this time the launcher really receives its signals.
      swallow = false;
      await manager.stop();

      assert.equal(manager.isRunning(), false);
      assert.equal(
        await connectRefused(portOf(connection.wsEndpoint)),
        true,
        'the retry must actually release the port',
      );
      assert.equal(fs.existsSync(stopPath), false, 'and then clean up');
      assert.equal(process.listenerCount('exit'), exitHookBaseline);
    } finally {
      harness.records[0].child.kill('SIGKILL');
      await waitForExit(harness.records[0].child);
    }
  });

  it('isRunning() stays true after a failed stop() and goes false after a successful retry', async () => {
    // A failed stop() keeps the bridge alive; reporting `false` there would let a
    // caller believe the bridge is down while its port is still listening.
    const harness = harnessFor(fakeCliBody(READY_PREFIX, {ignoreStop: true}));
    let swallow = true;
    const manager = new EgoBridgeManager(
      managerOptions(harness, {
        stopGraceMs: 40,
        killGraceMs: 40,
        kill: (child, signal) => {
          if (!swallow) child.kill(signal);
        },
      }),
    );

    await manager.start();
    try {
      await assert.rejects(manager.stop(), /did not stop/i);
      assert.equal(
        manager.isRunning(),
        true,
        'a failed stop() must not report the bridge as down',
      );

      swallow = false;
      await manager.stop();
      assert.equal(manager.isRunning(), false);
    } finally {
      harness.records[0].child.kill('SIGKILL');
      await waitForExit(harness.records[0].child);
    }
  });

  it('does not double-spawn when start() is called during an in-flight stop()', async () => {
    const harness = harnessFor(fakeCliBody(READY_PREFIX));
    const manager = new EgoBridgeManager(managerOptions(harness));

    const first = await manager.start();
    const stopping = manager.stop();
    // Two callers racing for a new bridge while the old one is still tearing down.
    const [a, b] = await Promise.all([manager.start(), manager.start()]);
    await stopping;

    try {
      assert.equal(harness.records.length, 2, 'exactly one new child');
      assert.equal(a.wsEndpoint, b.wsEndpoint);
      assert.notEqual(a.wsEndpoint, first.wsEndpoint);
      assert.equal(manager.isRunning(), true);
      assert.equal(
        hasExited(harness.records[0].child),
        true,
        'the stopped child must be gone',
      );
      assert.equal(await connectRefused(portOf(first.wsEndpoint)), true);
      assert.equal(await connectRefused(portOf(a.wsEndpoint)), false);
    } finally {
      await manager.stop();
    }
  });

  it('stops the bridge when stop() follows an un-awaited start() in the same tick (R1)', async () => {
    // A caller that never awaits start() must still get a real teardown: stop()
    // used to read empty fields synchronously and resolve while the queued launch
    // went on to leave a listening bridge, a sink file and a stop file behind.
    const harness = harnessFor(fakeCliBody(READY_PREFIX));
    const sinkDir = makeTempDir('ego-sink-');
    const manager = new EgoBridgeManager(managerOptions(harness, {sinkDir}));

    try {
      const started = manager.start();
      await manager.stop();
      // The launch still completed (the stop was queued behind it), so its
      // endpoint is observable — which is what makes "the port is free"
      // assertable.
      const connection = await started;

      assert.equal(
        manager.isRunning(),
        false,
        'no bridge this manager started may still be running',
      );
      assert.equal(harness.records.length, 1, 'the launch did happen');
      assert.equal(hasExited(harness.records[0].child), true);
      assert.equal(
        await connectRefused(portOf(connection.wsEndpoint)),
        true,
        'the port the bridge bound must refuse connections',
      );
      assert.deepEqual(
        fs.readdirSync(sinkDir),
        [],
        'the sink and stop files must be gone',
      );
    } finally {
      // A regression here is exactly when an orphan bridge is most likely: the
      // assertion above throws, and without this the child would outlive the
      // runner still holding its port. Same shape as the failed-stop test.
      for (const record of harness.records) {
        record.child.kill('SIGKILL');
        await waitForExit(record.child);
      }
    }
  });

  it('stops the bridge when start(); start(); stop() share one tick (R1)', async () => {
    // The double start coalesces into one child; the stop must still own it.
    const harness = harnessFor(fakeCliBody(READY_PREFIX));
    const sinkDir = makeTempDir('ego-sink-');
    const manager = new EgoBridgeManager(managerOptions(harness, {sinkDir}));

    try {
      const first = manager.start();
      const second = manager.start();
      await manager.stop();
      const [a, b] = await Promise.all([first, second]);

      assert.equal(manager.isRunning(), false);
      assert.equal(harness.records.length, 1, 'the two starts share one child');
      assert.equal(a.wsEndpoint, b.wsEndpoint);
      assert.equal(hasExited(harness.records[0].child), true);
      assert.equal(await connectRefused(portOf(a.wsEndpoint)), true);
      assert.deepEqual(fs.readdirSync(sinkDir), [], 'no files may be left');
    } finally {
      for (const record of harness.records) {
        record.child.kill('SIGKILL');
        await waitForExit(record.child);
      }
    }
  });

  it('stays usable after a same-tick start(); stop() (R1)', async () => {
    // The teardown must not wedge the manager: a later start() has to work.
    const harness = harnessFor(fakeCliBody(READY_PREFIX));
    const manager = new EgoBridgeManager(managerOptions(harness));

    const abandoned = manager.start();
    await manager.stop();
    await abandoned.catch(() => undefined);
    assert.equal(manager.isRunning(), false);

    try {
      const connection = await manager.start();
      assert.match(connection.wsEndpoint, /^ws:\/\/127\.0\.0\.1:\d+\//);
      assert.equal(manager.isRunning(), true);
      assert.equal(
        harness.records.length,
        2,
        'a fresh child, not a reused one',
      );
      assert.equal(await connectRefused(portOf(connection.wsEndpoint)), false);
    } finally {
      await manager.stop();
    }
    assert.equal(manager.isRunning(), false);
  });

  it('rejects a repeated start() that would change keepPage instead of ignoring it', async () => {
    const harness = harnessFor(fakeCliBody(READY_PREFIX));
    const manager = new EgoBridgeManager(managerOptions(harness));

    try {
      const live = await manager.start({keepPage: false});
      // Repeating the same options is fine: the bridge is reused.
      const again = await manager.start();
      assert.equal(again.wsEndpoint, live.wsEndpoint);

      await assert.rejects(manager.start({keepPage: true}), (error: Error) => {
        assert.match(error.message, /keepPage=false/);
        assert.match(error.message, /keepPage=true/);
        assert.match(error.message, /stop\(\)/);
        return true;
      });
      assert.equal(harness.records.length, 1, 'nothing may be respawned');
    } finally {
      await manager.stop();
    }
  });

  it('keeps a ready line that straddles a sink truncation (Minors)', async () => {
    // The sink is capped while the worker keeps appending, so a cut can land in
    // the middle of a line. Zeroing the file *and* the buffered half-line would
    // lose that ready line for good; only the consumed prefix may be dropped.
    const body = [
      "const fs = require('node:fs');",
      "const http = require('node:http');",
      'const NL = String.fromCharCode(10);',
      `const PREFIX = '${READY_PREFIX}';`,
      'const sink = process.env.EGO_BRIDGE_READY_FILE;',
      'const stopFile = process.env.EGO_BRIDGE_STOP_FILE;',
      "const server = http.createServer(function (_req, res) { res.end('ok'); });",
      "server.on('listening', function () {",
      '  const port = server.address().port;',
      '  // Past SINK_MAX_BYTES (256 KiB) in one burst, so the manager truncates.',
      "  fs.appendFileSync(sink, ('d'.repeat(1000) + NL).repeat(300));",
      '  // The ready line arrives split across that truncation.',
      "  fs.appendFileSync(sink, PREFIX + ' ws://127.0.0.1:' + port + '/devtools/browser/straddle' + '-' + process.pid);",
      '  setTimeout(function () { fs.appendFileSync(sink, NL); }, 400);',
      '});',
      "server.listen(0, '127.0.0.1');",
      'setInterval(function () {',
      '  if (!fs.existsSync(stopFile)) return;',
      '  server.close(function () { process.exit(0); });',
      '  setTimeout(function () { process.exit(0); }, 250);',
      '}, 25);',
    ].join(String.fromCharCode(10));
    const harness = harnessFor(body);
    const manager = new EgoBridgeManager(managerOptions(harness));

    try {
      const connection = await manager.start();
      assert.match(
        connection.wsEndpoint,
        /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/straddle-\d+$/,
        'a ready line split by the sink cap must still be parsed',
      );
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
