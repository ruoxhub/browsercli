/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Unit tests for the ego-bridge CDP worker.
 *
 * The worker runs inside ego lite's embedded Node runtime, so it is driven here
 * through an injected fake of the `globalThis.ego` native bindings: the tests
 * speak real WebSocket/CDP to the worker's own listening socket and assert on
 * what reaches the native binding (and what does not).
 */

import assert from 'node:assert';
import {spawn} from 'node:child_process';
import {describe, it} from 'node:test';

import {
  createEgoBridge,
  READY_PREFIX,
  type EgoNativeBindings,
  type EgoTaskFinish,
} from '../../../../src/modules/browser/ego/ego-bridge-worker.js';

interface FakeEgo {
  ego: EgoNativeBindings;
  sent: string[];
  calls: string[];
  emit: (message: unknown) => void;
  emitSendError: (message: string, errorCode?: string) => void;
}

function createFakeEgo(overrides: Partial<EgoNativeBindings> = {}): FakeEgo {
  const sent: string[] = [];
  const calls: string[] = [];
  const ego: EgoNativeBindings = {
    sendCDPMessage(message: string) {
      sent.push(message);
    },
    onCDPMessage: undefined,
    onSendCDPMessageError: undefined,
    createTaskSpace: async (name: string) => ({id: 1, name}),
    useTaskSpace: () => 1,
    closeTaskSpace: async () => {
      calls.push('closeTaskSpace');
    },
    completeTaskSpace: async () => {
      calls.push('completeTaskSpace');
    },
    ...overrides,
  };
  return {
    ego,
    sent,
    calls,
    emit: message => ego.onCDPMessage?.(JSON.stringify(message)),
    emitSendError: (message, errorCode) =>
      ego.onSendCDPMessageError?.(message, errorCode),
  };
}

const delay = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

async function waitFor<T>(
  read: () => T | undefined,
  timeoutMs = 2000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for bridge output');
    }
    await delay(5);
  }
}

async function connect(wsEndpoint: string): Promise<WebSocket> {
  const ws = new WebSocket(wsEndpoint);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), {once: true});
    ws.addEventListener('error', () => reject(new Error('ws connect failed')), {
      once: true,
    });
  });
  return ws;
}

interface CdpFrame {
  id?: number;
  result?: Record<string, string>;
  error?: {code: number; message: string};
  sessionId?: string;
  method?: string;
  params?: Record<string, unknown>;
}

interface Collector {
  /** frames as the client received them, before any parsing */
  raw: string[];
  parsed: CdpFrame[];
}

function collect(ws: WebSocket): Collector {
  const collector: Collector = {raw: [], parsed: []};
  ws.addEventListener('message', event => {
    const text = String(event.data);
    collector.raw.push(text);
    collector.parsed.push(JSON.parse(text));
  });
  return collector;
}

describe('ego-bridge-worker', () => {
  it('answers Browser.getVersion locally instead of forwarding it', async () => {
    const fake = createFakeEgo();
    const bridge = createEgoBridge({ego: fake.ego, taskSpaceName: 'unit-test'});
    const {wsEndpoint} = await bridge.start();
    assert.match(
      wsEndpoint,
      /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[0-9a-f-]+$/,
    );
    const ws = await connect(wsEndpoint);
    try {
      const received = collect(ws);
      ws.send(JSON.stringify({id: 5, method: 'Browser.getVersion'}));
      const reply = await waitFor(() => received.parsed[0]);

      assert.equal(reply.id, 5);
      assert.equal(reply.result.protocolVersion, '1.3');
      assert.match(reply.result.product, /Chrome\/\d+/);
      assert.equal(typeof reply.result.revision, 'string');
      assert.equal(typeof reply.result.userAgent, 'string');
      assert.equal(typeof reply.result.jsVersion, 'string');
      assert.deepEqual(fake.sent, [], 'getVersion must not reach native CDP');
    } finally {
      ws.close();
      await bridge.stop();
    }
  });

  it('echoes the sessionId when the version request carries one', async () => {
    const fake = createFakeEgo();
    const bridge = createEgoBridge({ego: fake.ego, taskSpaceName: 'unit-test'});
    const {wsEndpoint} = await bridge.start();
    const ws = await connect(wsEndpoint);
    try {
      const received = collect(ws);
      ws.send(
        JSON.stringify({id: 8, method: 'Browser.getVersion', sessionId: 's8'}),
      );
      const reply = await waitFor(() => received.parsed[0]);
      assert.equal(reply.id, 8);
      assert.equal(reply.sessionId, 's8');
      assert.deepEqual(fake.sent, []);
    } finally {
      ws.close();
      await bridge.stop();
    }
  });

  it('uses ego.getBrowserVersion for the product string when present', async () => {
    const fake = createFakeEgo({
      getBrowserVersion: async () => ({currentVersion: '0.6.1.13'}),
    });
    const bridge = createEgoBridge({ego: fake.ego, taskSpaceName: 'unit-test'});
    const {wsEndpoint} = await bridge.start();
    const ws = await connect(wsEndpoint);
    try {
      const received = collect(ws);
      ws.send(JSON.stringify({id: 6, method: 'Browser.getVersion'}));
      const reply = await waitFor(() => received.parsed[0]);

      assert.equal(reply.id, 6);
      assert.match(reply.result.product, /Chrome\/0\.6\.1\.13/);
      assert.deepEqual(fake.sent, []);
    } finally {
      ws.close();
      await bridge.stop();
    }
  });

  it('drops Target.attachedToTarget events outside the whitelist', async () => {
    const fake = createFakeEgo();
    const bridge = createEgoBridge({
      ego: fake.ego,
      taskSpaceName: 'unit-test',
      listOwnTargetIds: async () => ['own-target'],
    });
    const {wsEndpoint} = await bridge.start();
    const ws = await connect(wsEndpoint);
    try {
      const received = collect(ws);
      fake.emit({
        method: 'Target.attachedToTarget',
        params: {
          sessionId: 'foreign-session',
          targetInfo: {targetId: 'foreign-target', type: 'page'},
          waitingForDebugger: false,
        },
      });
      fake.emit({
        method: 'Target.attachedToTarget',
        params: {
          sessionId: 'own-session',
          targetInfo: {targetId: 'own-target', type: 'page'},
          waitingForDebugger: false,
        },
      });

      const forwarded = await waitFor(() => received.parsed[0]);
      assert.deepEqual(forwarded, {
        method: 'Target.attachedToTarget',
        params: {
          sessionId: 'own-session',
          targetInfo: {targetId: 'own-target', type: 'page'},
          waitingForDebugger: false,
        },
      });
      await delay(50);
      assert.equal(
        received.parsed.length,
        1,
        'foreign target must be filtered out',
      );
    } finally {
      ws.close();
      await bridge.stop();
    }
  });

  it('forwards whitelisted non-Target events verbatim', async () => {
    const fake = createFakeEgo();
    const bridge = createEgoBridge({
      ego: fake.ego,
      taskSpaceName: 'unit-test',
      listOwnTargetIds: async () => ['own-target'],
    });
    const {wsEndpoint} = await bridge.start();
    const ws = await connect(wsEndpoint);
    try {
      const received = collect(ws);
      const rawEvent =
        '{"method":"Runtime.consoleAPICalled","params":{"type":"log","args":[],"sessionId":"any-session"}}';
      fake.ego.onCDPMessage?.(rawEvent);
      assert.equal(await waitFor(() => received.raw[0]), rawEvent);
      assert.deepEqual(received.parsed[0], JSON.parse(rawEvent));
    } finally {
      ws.close();
      await bridge.stop();
    }
  });

  it('forwards CDP requests byte-for-byte and routes responses back', async () => {
    const fake = createFakeEgo();
    const bridge = createEgoBridge({ego: fake.ego, taskSpaceName: 'unit-test'});
    const {wsEndpoint} = await bridge.start();
    const ws = await connect(wsEndpoint);
    try {
      const received = collect(ws);
      // Deliberately not canonical JSON: whitespace and key order differ from
      // what JSON.stringify would emit, so only true passthrough matches.
      const request =
        '{ "sessionId" : "session-1", ' +
        '"params": {"expression": "1+1", "returnByValue": true}, ' +
        '"method": "Runtime.evaluate", "id": 7 }';
      ws.send(request);
      await waitFor(() => fake.sent[0]);
      assert.equal(fake.sent[0], request, 'request must be forwarded verbatim');

      fake.emit({
        id: 7,
        result: {result: {type: 'number', value: 2}},
        sessionId: 'session-1',
      });
      assert.deepEqual(await waitFor(() => received.parsed[0]), {
        id: 7,
        result: {result: {type: 'number', value: 2}},
        sessionId: 'session-1',
      });
    } finally {
      ws.close();
      await bridge.stop();
    }
  });

  it('forwards Target.setAutoAttach rather than swallowing it', async () => {
    const fake = createFakeEgo();
    const bridge = createEgoBridge({ego: fake.ego, taskSpaceName: 'unit-test'});
    const {wsEndpoint} = await bridge.start();
    const ws = await connect(wsEndpoint);
    try {
      const received = collect(ws);
      const request =
        '{"id":2,"method":"Target.setAutoAttach","params":{"autoAttach":true,"waitForDebuggerOnStart":true,"flatten":true}}';
      ws.send(request);
      await waitFor(() => fake.sent[0]);
      assert.equal(fake.sent[0], request);
      await delay(50);
      assert.deepEqual(received.raw, [], 'no local reply expected');
    } finally {
      ws.close();
      await bridge.stop();
    }
  });

  it('routes a native send failure back as a CDP error for the pending id', async () => {
    const fake = createFakeEgo();
    const bridge = createEgoBridge({ego: fake.ego, taskSpaceName: 'unit-test'});
    const {wsEndpoint} = await bridge.start();
    const ws = await connect(wsEndpoint);
    try {
      const received = collect(ws);
      ws.send(
        '{"id":9,"method":"Page.navigate","params":{"url":"https://example.com"},"sessionId":"s1"}',
      );
      await waitFor(() => fake.sent[0]);
      fake.emitSendError(
        'the task is under user control',
        'EGO_TASK_SPACE_USER_IN_CONTROL',
      );
      const reply = await waitFor(() => received.parsed[0]);
      assert.equal(reply.id, 9);
      assert.equal(reply.sessionId, 's1');
      assert.match(reply.error.message, /EGO_TASK_SPACE_USER_IN_CONTROL/);
    } finally {
      ws.close();
      await bridge.stop();
    }
  });

  it('finishes with keep: [] by default and closes the listener once', async () => {
    const fake = createFakeEgo();
    const finishes: Array<{keep: 'all' | string[]}> = [];
    const finishTask: EgoTaskFinish = options => finishes.push(options);
    const bridge = createEgoBridge({
      ego: fake.ego,
      taskSpaceName: 'unit-test',
      finishTask,
    });
    const {wsEndpoint} = await bridge.start();

    await bridge.stop();
    await bridge.stop();

    assert.deepEqual(finishes, [{keep: []}]);
    assert.deepEqual(fake.calls, []);
    await assert.rejects(connect(wsEndpoint), /ws connect failed/);
  });

  it('finishes with keep: "all" when keepPage is set', async () => {
    const finishes: Array<{keep: 'all' | string[]}> = [];
    const bridge = createEgoBridge({
      ego: createFakeEgo().ego,
      taskSpaceName: 'unit-test',
      keepPage: true,
      finishTask: options => finishes.push(options),
    });
    await bridge.start();
    await bridge.stop();
    assert.deepEqual(finishes, [{keep: 'all'}]);
  });

  it('falls back to the native task-space bindings', async () => {
    const fake = createFakeEgo();
    const bridge = createEgoBridge({ego: fake.ego, taskSpaceName: 'unit-test'});
    await bridge.start();
    await bridge.stop();
    assert.deepEqual(fake.calls, ['closeTaskSpace']);
    assert.equal(fake.ego.onCDPMessage, undefined);
    assert.equal(fake.ego.onSendCDPMessageError, undefined);

    const keep = createFakeEgo();
    const keepBridge = createEgoBridge({
      ego: keep.ego,
      taskSpaceName: 'unit-test',
      keepPage: true,
    });
    await keepBridge.start();
    await keepBridge.stop();
    assert.deepEqual(keep.calls, ['completeTaskSpace']);
  });

  it('never throws from cleanup when no task-finish binding exists', async () => {
    const fake = createFakeEgo({
      closeTaskSpace: undefined,
      completeTaskSpace: undefined,
    });
    const logs: string[] = [];
    const bridge = createEgoBridge({
      ego: fake.ego,
      taskSpaceName: 'unit-test',
      log: line => logs.push(line),
    });
    await bridge.start();
    await assert.doesNotReject(bridge.stop());
    assert.ok(
      logs.some(line => /task finish unavailable/.test(line)),
      `expected an unavailability log, got ${JSON.stringify(logs)}`,
    );
  });

  it('autostarts even when the inherited NODE_ENV is "test"', async () => {
    const workerUrl = new URL(
      '../../../../src/modules/browser/ego/ego-bridge-worker.js',
      import.meta.url,
    ).href;
    const script = `
      globalThis.ego = {
        sendCDPMessage() {},
        onCDPMessage: undefined,
        onSendCDPMessageError: undefined,
        createTaskSpace: async name => ({id: 1, name}),
        useTaskSpace: () => 1,
        closeTaskSpace: async () => { process.stdout.write('[finish:close]\\n'); },
      };
      await import(${JSON.stringify(workerUrl)});
    `;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: {...process.env, NODE_ENV: 'test'},
      },
    );
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    try {
      await waitFor(
        () => (stdout.includes(READY_PREFIX) ? stdout : undefined),
        15000,
      );
      child.stdin.end();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`worker did not exit; stdout: ${stdout}`)),
          15000,
        );
        child.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      assert.match(stdout, /\[ego-bridge:ready\] ws:\/\/127\.0\.0\.1:\d+\//);
      assert.match(stdout, /\[finish:close\]/);
    } finally {
      child.kill();
    }
  });
});
