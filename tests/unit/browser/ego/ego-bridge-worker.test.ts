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
 *
 * The client is the `ws` package rather than the global `WebSocket`, which Node
 * 20 only exposes behind `--experimental-websocket` (see `npm run test:node20`).
 */

import assert from 'node:assert';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import WebSocket from 'ws';

import {
  createEgoBridge,
  listTabsOwnTargetIds,
  READY_PREFIX,
  workspaceTaskSpaceName,
  type EgoNativeBindings,
  type EgoTaskFinish,
} from '../../../../src/modules/browser/ego/ego-bridge-worker.js';

interface FakeEgo {
  ego: EgoNativeBindings;
  sent: string[];
  calls: string[];
  emit: (message: unknown) => void;
  emitRaw: (raw: string) => void;
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
    listTabs: async () => ({tabs: []}),
    listTaskSpaces: async () => ({taskSpaces: []}),
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
    emitRaw: raw => ego.onCDPMessage?.(raw),
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

/**
 * `ws` rather than the global `WebSocket`: Node 20 only ships the global behind
 * `--experimental-websocket`, and `npm run test:node20` does not pass it.
 */
function connect(wsEndpoint: string): Promise<WebSocket> {
  const ws = new WebSocket(wsEndpoint);
  return new Promise<WebSocket>((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', () => reject(new Error('ws connect failed')));
  });
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
  ws.on('message', (data: WebSocket.RawData) => {
    const text = data.toString();
    collector.raw.push(text);
    collector.parsed.push(JSON.parse(text) as CdpFrame);
  });
  return collector;
}

/**
 * A raw TCP client for the FRAME-LEVEL regression tests, where the point is
 * bytes the `ws` client cannot express: fragmented messages, a frame on the
 * 64-bit length path, and a length header that lies.
 */
interface RawClient {
  send: (bytes: Buffer) => void;
  /** resolves once the server closes the connection */
  closed: () => Promise<void>;
  /** every byte the server sent after the handshake */
  received: () => Buffer;
  destroy: () => void;
}

function handshakeRequest(path: string): Buffer {
  return Buffer.from(
    [
      `GET ${path} HTTP/1.1`,
      'Host: 127.0.0.1',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: ' +
        Buffer.from('0123456789abcdef').toString('base64'),
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n'),
    'latin1',
  );
}

async function rawClient(wsEndpoint: string): Promise<RawClient> {
  const url = new URL(wsEndpoint);
  const socket = net.createConnection({
    host: '127.0.0.1',
    port: Number(url.port),
  });
  let buffer: Buffer = Buffer.alloc(0);
  let handshakeDone = false;
  let closed = false;
  const waiters: Array<() => void> = [];
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!handshakeDone) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end === -1) return;
      handshakeDone = true;
      buffer = buffer.subarray(end + 4);
    }
    for (const wake of waiters.splice(0)) wake();
  });
  socket.on('close', () => {
    closed = true;
    for (const wake of waiters.splice(0)) wake();
  });
  socket.on('error', () => undefined);
  socket.write(handshakeRequest(url.pathname));
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 2000;
    const poll = () => {
      if (handshakeDone) return resolve();
      if (Date.now() > deadline) return reject(new Error('no ws handshake'));
      waiters.push(poll);
    };
    poll();
  });
  return {
    send(bytes: Buffer) {
      socket.write(bytes);
    },
    async closed() {
      await waitFor(() => (closed ? true : undefined));
    },
    received() {
      return buffer;
    },
    destroy() {
      socket.destroy();
    },
  };
}

/** A masked client frame; `opcode` 0x1/0x0/0x8, optional 64-bit length. */
function clientFrame(
  opcode: number,
  payload: Buffer,
  options: {fin?: boolean; wide?: boolean} = {},
): Buffer {
  const fin = options.fin ?? true;
  const mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | length;
  } else if (length < 65536 && !options.wide) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    // Declared as a 64-bit length, which is what exercises that read path.
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = (fin ? 0x80 : 0x00) | opcode;
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index++) {
    masked[index] ^= mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
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
      assert.equal(reply.result.product, 'Chrome/141');
      assert.equal(typeof reply.result.revision, 'string');
      assert.equal(typeof reply.result.userAgent, 'string');
      assert.equal(typeof reply.result.jsVersion, 'string');
      assert.deepEqual(fake.sent, [], 'getVersion must not reach native CDP');
    } finally {
      ws.close();
      await bridge.stop();
    }
  });

  it('reports a Chromium major so Patchright version branches work', async () => {
    // ego reports its own app version; Patchright derives `majorVersion()` from
    // `product`, so handing it `0.6.1.13` would make every `>= 143` branch false.
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
      assert.equal(reply.result.product, 'Chrome/141');
      assert.equal(reply.result.egoVersion, '0.6.1.13');
      assert.doesNotMatch(reply.result.revision, /^0\.6\.1\.13$/);
      assert.match(reply.result.userAgent, /Chrome\/141\.0\.7390\.0/);
      assert.deepEqual(fake.sent, []);
    } finally {
      ws.close();
      await bridge.stop();
    }
  });

  it('uses a real Chromium major when ego reports one', async () => {
    const fake = createFakeEgo({
      getBrowserVersion: async () => ({currentVersion: '143.0.7499.4'}),
    });
    const bridge = createEgoBridge({ego: fake.ego, taskSpaceName: 'unit-test'});
    const {wsEndpoint} = await bridge.start();
    const ws = await connect(wsEndpoint);
    try {
      const received = collect(ws);
      ws.send(JSON.stringify({id: 3, method: 'Browser.getVersion'}));
      const reply = await waitFor(() => received.parsed[0]);

      assert.equal(reply.result.product, 'Chrome/143');
      assert.equal(reply.result.revision, '143.0.7499.4');
      assert.equal(reply.result.egoVersion, '143.0.7499.4');
    } finally {
      ws.close();
      await bridge.stop();
    }
  });

  it('derives the user agent platform from process.platform', async () => {
    const fake = createFakeEgo();
    const bridge = createEgoBridge({ego: fake.ego, taskSpaceName: 'unit-test'});
    const {wsEndpoint} = await bridge.start();
    const ws = await connect(wsEndpoint);
    const expected = {
      darwin: /Macintosh/,
      win32: /Windows NT/,
    }[process.platform];
    try {
      const received = collect(ws);
      ws.send(JSON.stringify({id: 4, method: 'Browser.getVersion'}));
      const reply = await waitFor(() => received.parsed[0]);
      if (expected) {
        assert.match(reply.result.userAgent, expected);
      } else {
        assert.match(reply.result.userAgent, /X11; Linux x86_64/);
      }
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

  it('filters every Target lifecycle event by target id', async () => {
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
      // The exact shape a live probe leaked: private url + title, verbatim.
      fake.emit({
        method: 'Target.targetCreated',
        params: {
          targetInfo: {
            targetId: 'foreign-target',
            type: 'page',
            url: 'https://mail.example.com/inbox',
            title: 'Private Inbox',
          },
        },
      });
      fake.emit({
        method: 'Target.targetInfoChanged',
        params: {
          targetInfo: {
            targetId: 'foreign-target',
            url: 'https://mail.example.com/secret',
          },
        },
      });
      fake.emit({
        method: 'Target.targetDestroyed',
        params: {targetId: 'foreign-target'},
      });
      fake.emit({
        method: 'Target.detachedFromTarget',
        params: {sessionId: 'foreign-session', targetId: 'foreign-target'},
      });
      // Unlisted Target.* events have no known target attribution: deny.
      fake.emit({
        method: 'Target.receivedMessageFromTarget',
        params: {sessionId: 'own-session', message: 'leak'},
      });
      fake.emit({
        method: 'Target.attachedToTarget',
        params: {
          sessionId: 'own-session',
          targetInfo: {targetId: 'own-target', type: 'page'},
          waitingForDebugger: false,
        },
      });
      // `detachedFromTarget` may carry only the sessionId of the earlier attach.
      fake.emit({
        method: 'Target.detachedFromTarget',
        params: {sessionId: 'own-session', targetId: 'own-target'},
      });

      await waitFor(() => (received.parsed.length === 2 ? true : undefined));
      await delay(100);
      const methods = received.parsed.map(frame => frame.method);
      assert.deepEqual(methods, [
        'Target.attachedToTarget',
        'Target.detachedFromTarget',
      ]);
      for (const frame of received.raw) {
        assert.doesNotMatch(frame, /mail\.example\.com/);
        assert.doesNotMatch(frame, /Private Inbox/);
        assert.doesNotMatch(frame, /leak/);
      }
    } finally {
      ws.close();
      await bridge.stop();
    }
  });

  it('forwards a child target announced on a session this bridge already owns', async () => {
    // F8: `ego.listTabs()` only reports top-level tabs, so an OOPIF iframe or a
    // dedicated worker can never match the whitelist by id — and because
    // Patchright sends `waitForDebuggerOnStart: true`, a dropped child stays
    // paused forever. The message-level `sessionId` of the owning page is the
    // only trustworthy attribution, and it is latched once that page's attach
    // was forwarded.
    const fake = createFakeEgo();
    const bridge = createEgoBridge({
      ego: fake.ego,
      taskSpaceName: 'unit-test',
      listOwnTargetIds: async () => ['TAB1'],
    });
    const {wsEndpoint} = await bridge.start();
    const ws = await connect(wsEndpoint);
    try {
      const received = collect(ws);
      fake.emit({
        method: 'Target.attachedToTarget',
        params: {
          sessionId: 'PAGE1',
          targetInfo: {targetId: 'TAB1', type: 'page'},
          waitingForDebugger: false,
        },
      });
      // Both arrive on the page's own session with ids listTabs never reports.
      fake.emit({
        method: 'Target.attachedToTarget',
        sessionId: 'PAGE1',
        params: {
          sessionId: 'IFRAME1',
          targetInfo: {targetId: 'IFRAME1', type: 'iframe'},
          waitingForDebugger: true,
        },
      });
      fake.emit({
        method: 'Target.attachedToTarget',
        sessionId: 'PAGE1',
        params: {
          sessionId: 'WORKER1',
          targetInfo: {targetId: 'WORKER1', type: 'worker'},
          waitingForDebugger: true,
        },
      });

      await waitFor(() => (received.parsed.length === 3 ? true : undefined));

      // Same child shape on a session this bridge never latched: not proven
      // mine, so it must stay dropped.
      fake.emit({
        method: 'Target.attachedToTarget',
        sessionId: 'FOREIGN-PAGE',
        params: {
          sessionId: 'FOREIGN-IFRAME',
          targetInfo: {targetId: 'FOREIGN-IFRAME', type: 'iframe'},
          waitingForDebugger: true,
        },
      });
      // A foreign top-level attach: no message-level sessionId at all.
      fake.emit({
        method: 'Target.attachedToTarget',
        params: {
          sessionId: 'PRIVATE1',
          targetInfo: {
            targetId: 'user-private-tab',
            type: 'page',
            url: 'https://mail.example.com/inbox',
          },
          waitingForDebugger: false,
        },
      });

      await delay(150);
      assert.deepEqual(
        received.parsed.map(frame => frame.params?.targetInfo),
        [
          {targetId: 'TAB1', type: 'page'},
          {targetId: 'IFRAME1', type: 'iframe'},
          {targetId: 'WORKER1', type: 'worker'},
        ],
        'own children must be forwarded; unknown sessions and foreign tabs must not',
      );
      for (const frame of received.raw) {
        assert.doesNotMatch(
          frame,
          /FOREIGN|user-private-tab|mail\.example\.com/,
        );
      }
    } finally {
      ws.close();
      await bridge.stop();
    }
  });

  it('refreshes the whitelist on the browser-level auto-attach only', async () => {
    // F10: Patchright also sends `Target.setAutoAttach` per page session
    // (crPage.js:440), which cannot surface a new top-level tab — every repeat
    // would cost a native `listTabs()` round-trip per page init.
    let lookups = 0;
    const fake = createFakeEgo();
    const bridge = createEgoBridge({
      ego: fake.ego,
      taskSpaceName: 'unit-test',
      listOwnTargetIds: async () => {
        lookups += 1;
        return ['own-target'];
      },
    });
    const {wsEndpoint} = await bridge.start();
    const ws = await connect(wsEndpoint);
    try {
      const baseline = lookups;
      ws.send(
        '{"id":1,"method":"Target.setAutoAttach","params":{"autoAttach":true,"waitForDebuggerOnStart":true,"flatten":true}}',
      );
      await waitFor(() => (lookups > baseline ? true : undefined));
      assert.equal(lookups - baseline, 1, 'browser-level attach must refresh');

      for (let index = 0; index < 5; index++) {
        ws.send(
          JSON.stringify({
            id: 10 + index,
            method: 'Target.setAutoAttach',
            sessionId: `page-${index}`,
            params: {
              autoAttach: true,
              waitForDebuggerOnStart: true,
              flatten: true,
            },
          }),
        );
      }
      await waitFor(() => (fake.sent.length === 6 ? true : undefined));
      await delay(100);
      assert.equal(
        lookups - baseline,
        1,
        `per-page auto-attach must not refresh, saw ${lookups - baseline} lookups`,
      );
    } finally {
      ws.close();
      await bridge.stop();
    }
  });

  it('keeps dropped-event diagnostics off the ready-line stdout channel', async () => {
    // F9: Task 2 parses stdout for the ready line, so diagnostics must go to
    // stderr — and must never carry a private url or title.
    const workerUrl = new URL(
      '../../../../src/modules/browser/ego/ego-bridge-worker.js',
      import.meta.url,
    ).href;
    const script = `
      globalThis.ego = {
        sendCDPMessage() {},
        onCDPMessage: undefined,
        onSendCDPMessageError: undefined,
        listTabs: async () => ({tabs: []}),
        createTaskSpace: async name => ({id: 1, name}),
        useTaskSpace: () => 1,
        closeTaskSpace: async () => {},
      };
      await import(${JSON.stringify(workerUrl)});
      const foreign = JSON.stringify({
        method: 'Target.targetCreated',
        params: {
          targetInfo: {
            targetId: 'user-private-tab',
            url: 'https://mail.example.com/inbox',
            title: 'Private Inbox',
          },
        },
      });
      setInterval(() => globalThis.ego.onCDPMessage?.(foreign), 10);
    `;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', script],
      {stdio: ['pipe', 'pipe', 'pipe']},
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    try {
      await waitFor(
        () => (stdout.includes(READY_PREFIX) ? stdout : undefined),
        15000,
      );
      await waitFor(
        () => (/dropped Target\.targetCreated/.test(stderr) ? true : undefined),
        15000,
      );
      assert.doesNotMatch(stdout, /\[ego-bridge\] dropped/);
      assert.deepEqual(
        stdout
          .split('\n')
          .filter(line => line.length > 0)
          .filter(line => !line.startsWith(READY_PREFIX)),
        [],
        `stdout must carry only the ready line, got ${stdout}`,
      );
      assert.doesNotMatch(stderr, /mail\.example\.com|Private Inbox/);
    } finally {
      child.stdin.end();
      child.kill();
    }
  });

  it('does not await a native round-trip per native event', async () => {
    // Finding 9: the whitelist must be cached and refreshed at most once per
    // unknown target, never once per event on the serialized native queue.
    let lookups = 0;
    const fake = createFakeEgo();
    const bridge = createEgoBridge({
      ego: fake.ego,
      taskSpaceName: 'unit-test',
      listOwnTargetIds: async () => {
        lookups += 1;
        await delay(5);
        return ['own-target'];
      },
    });
    const {wsEndpoint} = await bridge.start();
    const lookupsAfterStart = lookups;
    const ws = await connect(wsEndpoint);
    try {
      const received = collect(ws);
      const foreignEvent = (index: number) => ({
        method: 'Target.targetInfoChanged',
        params: {
          targetInfo: {
            targetId: `foreign-target-${index}`,
            url: `https://mail.example.com/${index}`,
          },
        },
      });
      // Distinct ids too: a per-target verdict alone would still allow one
      // native round-trip per new target inside the same burst.
      for (let index = 0; index < 40; index++) {
        fake.emit(foreignEvent(index));
        fake.emit({
          method: 'Target.targetCreated',
          params: {
            targetInfo: {targetId: `foreign-${index}`, type: 'page'},
          },
        });
      }
      fake.emit({
        method: 'Target.attachedToTarget',
        params: {
          sessionId: 'own-session',
          targetInfo: {targetId: 'own-target', type: 'page'},
          waitingForDebugger: false,
        },
      });

      // The owned attach must not have been stuck behind 40 native round-trips.
      const forwarded = await waitFor(() => received.parsed[0], 5000);
      assert.equal(forwarded.method, 'Target.attachedToTarget');
      await delay(100);
      assert.equal(received.parsed.length, 1);
      assert.equal(
        lookups - lookupsAfterStart,
        1,
        `expected one whitelist lookup for the foreign burst, saw ${lookups - lookupsAfterStart}`,
      );
    } finally {
      ws.close();
      await bridge.stop();
    }
  });

  it('denies every Target event when the whitelist is empty', async () => {
    // Supplied-but-empty is the production "this space owns no tabs yet" state:
    // it must deny, not mean "no restriction".
    const fake = createFakeEgo();
    const bridge = createEgoBridge({
      ego: fake.ego,
      taskSpaceName: 'unit-test',
      listOwnTargetIds: async () => [],
    });
    const {wsEndpoint} = await bridge.start();
    const ws = await connect(wsEndpoint);
    try {
      const received = collect(ws);
      fake.emit({
        method: 'Target.attachedToTarget',
        params: {
          sessionId: 'any-session',
          targetInfo: {targetId: 'any-target', type: 'page'},
          waitingForDebugger: false,
        },
      });
      fake.emit({
        method: 'Target.targetCreated',
        params: {targetInfo: {targetId: 'any-target', type: 'page'}},
      });
      // Non-Target events are unaffected by the whitelist.
      fake.emitRaw(
        '{"method":"Runtime.consoleAPICalled","params":{"type":"log"}}',
      );
      await waitFor(() => (received.parsed.length === 1 ? true : undefined));
      await delay(100);
      assert.equal(received.parsed.length, 1);
      assert.equal(received.parsed[0].method, 'Runtime.consoleAPICalled');
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
      fake.emitRaw(rawEvent);
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

  it('closes the port when stop() races an in-flight start()', async () => {
    let releaseTaskSpace: () => void = () => undefined;
    const taskSpaceGate = new Promise<void>(resolve => {
      releaseTaskSpace = resolve;
    });
    const fake = createFakeEgo({
      createTaskSpace: async (name: string) => {
        await taskSpaceGate;
        return {id: 1, name};
      },
    });
    const finishes: Array<{keep: 'all' | string[]}> = [];
    const bridge = createEgoBridge({
      ego: fake.ego,
      taskSpaceName: 'unit-test',
      finishTask: options => finishes.push(options),
    });

    // stop() lands while start() is awaiting enterTaskSpace().
    const starting = bridge.start();
    await delay(10);
    let stopped = false;
    void bridge.stop().then(() => {
      stopped = true;
    });

    // The gate is still shut, so a start() that ignored the stop would already
    // have resolved the teardown and leaked its (future) listening port.
    await delay(100);
    assert.equal(stopped, false, 'stop() must await the in-flight start()');

    releaseTaskSpace();
    await waitFor(() => (stopped ? true : undefined));
    await assert.rejects(starting, /stopped/);
    await bridge.stop();

    assert.deepEqual(finishes, [{keep: []}], 'teardown must run exactly once');
    assert.equal(
      fake.ego.onCDPMessage,
      undefined,
      'callbacks must not be installed after the stop',
    );
    assert.equal(fake.ego.onSendCDPMessageError, undefined);
  });

  it('does not leak a listening port when stop() wins the race', async () => {
    // A leaked listener keeps the Node event loop alive, so a child process that
    // never calls process.exit() is the honest detector: it either exits on its
    // own or it does not.
    const workerUrl = new URL(
      '../../../../src/modules/browser/ego/ego-bridge-worker.js',
      import.meta.url,
    ).href;
    const script = `
      import {createEgoBridge} from ${JSON.stringify(workerUrl)};
      const ego = {
        sendCDPMessage() {},
        onCDPMessage: undefined,
        onSendCDPMessageError: undefined,
        createTaskSpace: async name => {
          await new Promise(resolve => setTimeout(resolve, 30));
          return {id: 1, name};
        },
        useTaskSpace: () => 1,
        closeTaskSpace: async () => {},
      };
      const bridge = createEgoBridge({
        ego,
        taskSpaceName: 'leak-probe',
        listOwnTargetIds: async () => [],
      });
      const starting = bridge.start();
      const stopping = bridge.stop();
      starting.then(
        endpoint => console.log('[unexpected-ready] ' + endpoint),
        () => undefined,
      );
      await stopping;
      console.log('[stopped]');
    `;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', script],
      {stdio: ['pipe', 'pipe', 'inherit']},
    );
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    try {
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `worker did not exit: the listening port leaked; stdout: ${stdout}`,
            ),
          );
        }, 10000);
        child.on('exit', code => {
          clearTimeout(timer);
          resolve(code);
        });
      });
      assert.equal(exitCode, 0);
      assert.match(stdout, /\[stopped\]/);
      assert.doesNotMatch(
        stdout,
        /unexpected-ready/,
        'start() must not report an endpoint after stop()',
      );
    } finally {
      child.kill();
    }
  });

  it('does not leak the port when the ready hook throws', async () => {
    const fake = createFakeEgo();
    let bound = '';
    const bridge = createEgoBridge({
      ego: fake.ego,
      taskSpaceName: 'unit-test',
      listOwnTargetIds: async () => [],
      onReady: wsEndpoint => {
        bound = wsEndpoint;
        throw new Error('manager rejected the endpoint');
      },
    });

    await assert.rejects(bridge.start(), /manager rejected the endpoint/);
    assert.ok(bound.startsWith('ws://127.0.0.1:'));
    // A failed start() must not leave the socket or the native callbacks behind.
    await assert.rejects(connect(bound), /ws connect failed/);
    assert.equal(fake.ego.onCDPMessage, undefined);
    assert.equal(fake.ego.onSendCDPMessageError, undefined);
    await bridge.stop();
  });

  it('reassembles a text message split across three frames', async () => {
    const fake = createFakeEgo();
    const bridge = createEgoBridge({ego: fake.ego, taskSpaceName: 'unit-test'});
    const {wsEndpoint} = await bridge.start();
    const client = await rawClient(wsEndpoint);
    try {
      const message =
        '{"id":11,"method":"Runtime.evaluate","params":{"expression":"1+1"}}';
      const part = Math.ceil(message.length / 3);
      const pieces = [
        message.slice(0, part),
        message.slice(part, part * 2),
        message.slice(part * 2),
      ];
      client.send(
        clientFrame(0x1, Buffer.from(pieces[0], 'utf8'), {fin: false}),
      );
      client.send(
        clientFrame(0x0, Buffer.from(pieces[1], 'utf8'), {fin: false}),
      );
      client.send(clientFrame(0x0, Buffer.from(pieces[2], 'utf8')));

      assert.equal(await waitFor(() => fake.sent[0]), message);
      await delay(50);
      assert.equal(fake.sent.length, 1, 'fragments must not each forward');
    } finally {
      client.destroy();
      await bridge.stop();
    }
  });

  it('accepts an inbound frame larger than 64 KiB on the 64-bit path', async () => {
    const fake = createFakeEgo();
    const bridge = createEgoBridge({ego: fake.ego, taskSpaceName: 'unit-test'});
    const {wsEndpoint} = await bridge.start();
    const client = await rawClient(wsEndpoint);
    try {
      const padding = 'a'.repeat(70 * 1024);
      const message = `{"id":12,"method":"Runtime.evaluate","params":{"expression":"${padding}"}}`;
      assert.ok(message.length > 65536, 'payload must exceed the 16-bit path');
      client.send(clientFrame(0x1, Buffer.from(message, 'utf8'), {wide: true}));

      const forwarded = await waitFor(() => fake.sent[0], 5000);
      assert.equal(forwarded.length, message.length);
      assert.equal(forwarded, message);
    } finally {
      client.destroy();
      await bridge.stop();
    }
  });

  it('closes on a frame declaring more than 256 MiB instead of truncating', async () => {
    const fake = createFakeEgo();
    const bridge = createEgoBridge({ego: fake.ego, taskSpaceName: 'unit-test'});
    const {wsEndpoint} = await bridge.start();
    const client = await rawClient(wsEndpoint);
    try {
      const oversized = Buffer.alloc(10);
      oversized[0] = 0x81;
      oversized[1] = 0x80 | 127;
      oversized.writeBigUInt64BE(BigInt(256 * 1024 * 1024 + 1), 2);
      client.send(
        Buffer.concat([oversized, Buffer.from([0x37, 0xfa, 0x21, 0x3d])]),
      );

      // The connection is closed rather than reading (or forwarding) a
      // truncated message: no native send, and no server frame at all.
      await client.closed();
      assert.equal(
        client.received().length,
        0,
        'the client must not receive a truncated frame',
      );
      assert.deepEqual(fake.sent, []);
    } finally {
      client.destroy();
      await bridge.stop();
    }
  });

  it('reuses an agent-owned task space by name', async () => {
    const used: number[] = [];
    const base = workspaceTaskSpaceName(process.cwd());
    const fake = createFakeEgo({
      listTaskSpaces: async () => ({
        taskSpaces: [
          {id: 7, name: base, ownership: 'agent'},
          {id: 9, name: 'someone-elses-space', ownership: 'user'},
        ],
      }),
      createTaskSpace: async () => {
        throw new Error(
          'must not create a second space for the same workspace',
        );
      },
      useTaskSpace: (id: number) => {
        used.push(id);
        return id;
      },
    });
    const bridge = createEgoBridge({ego: fake.ego, taskSpaceName: base});
    await bridge.start();
    await bridge.stop();
    assert.deepEqual(used, [7]);
  });

  it('creates a suffixed space when the name belongs to the user', async () => {
    const created: string[] = [];
    const used: number[] = [];
    const base = 'browsercli-testhash';
    const fake = createFakeEgo({
      listTaskSpaces: async () => ({
        taskSpaces: [{id: 3, name: base, ownership: 'user'}],
      }),
      createTaskSpace: async (name: string) => {
        created.push(name);
        return {id: 4, name};
      },
      useTaskSpace: (id: number) => {
        used.push(id);
        return id;
      },
    });
    const bridge = createEgoBridge({ego: fake.ego, taskSpaceName: base});
    await bridge.start();
    await bridge.stop();
    // Never claims the user's space: an incremented suffix gets a fresh one,
    // and the created id must be selected or every command fails with
    // EGO_TASK_SPACE_NOT_SELECTED.
    assert.deepEqual(created, [`${base}-2`]);
    assert.deepEqual(used, [4]);
  });

  it('rejects and releases cleanly when stop() lands during the refresh', async () => {
    let releaseRefresh: () => void = () => undefined;
    const refreshGate = new Promise<void>(resolve => {
      releaseRefresh = resolve;
    });
    const fake = createFakeEgo();
    const bridge = createEgoBridge({
      ego: fake.ego,
      taskSpaceName: 'unit-test',
      listOwnTargetIds: async () => {
        await refreshGate;
        return [];
      },
    });

    const starting = bridge.start();
    // enterTaskSpace() has settled by now; start() is parked on the refresh.
    await delay(20);
    let stopped = false;
    void bridge.stop().then(() => {
      stopped = true;
    });
    releaseRefresh();

    await assert.rejects(starting, /stopped/);
    await waitFor(() => (stopped ? true : undefined));
    await bridge.stop();
    assert.equal(fake.ego.onCDPMessage, undefined);
  });

  it('rejects start() when the task space cannot be entered', async () => {
    const ready: string[] = [];
    const fake = createFakeEgo({
      createTaskSpace: async () => ({
        error: 'No active browser',
        error_code: 'EGO_BROWSER_UNAVAILABLE',
      }),
    });
    const bridge = createEgoBridge({
      ego: fake.ego,
      taskSpaceName: 'unit-test',
      onReady: wsEndpoint => ready.push(wsEndpoint),
    });

    try {
      await assert.rejects(bridge.start(), /EGO_BROWSER_UNAVAILABLE/);
      assert.deepEqual(ready, [], 'no healthy ready line for a dead bridge');
    } finally {
      await bridge.stop();
    }
  });

  it('rejects start() when the task-space bindings are missing', async () => {
    const fake = createFakeEgo({
      createTaskSpace: undefined,
      useTaskSpace: undefined,
    });
    const bridge = createEgoBridge({ego: fake.ego, taskSpaceName: 'unit-test'});
    try {
      await assert.rejects(bridge.start(), /task-space bindings unavailable/);
    } finally {
      await bridge.stop();
    }
  });

  it('names the task space from EGO_BRIDGE_TASK_SPACE_NAME, not the cwd (I1)', async () => {
    // In ego's persistent utility process `process.cwd()` is ego's application
    // directory for every workspace, so hashing it would collapse every session
    // into one task space. The manager bakes the workspace identity into the
    // bootstrap; autostart must prefer it over the cwd fallback.
    const workerUrl = new URL(
      '../../../../src/modules/browser/ego/ego-bridge-worker.js',
      import.meta.url,
    ).href;
    const created: string[] = [];
    const script = `
      globalThis.ego = {
        sendCDPMessage() {},
        onCDPMessage: undefined,
        onSendCDPMessageError: undefined,
        listTabs: async () => ({tabs: []}),
        createTaskSpace: async name => {
          process.stdout.write('[created] ' + name + String.fromCharCode(10));
          return {id: 1, name};
        },
        useTaskSpace: () => 1,
        closeTaskSpace: async () => {},
      };
      await import(${JSON.stringify(workerUrl)});
      setInterval(() => {}, 1000);
    `;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          EGO_BRIDGE_TASK_SPACE_NAME: 'browsercli-frommanager',
          EGO_BRIDGE_PARENT_PID: String(process.pid),
        },
      },
    );
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      const match = /\[created\] (\S+)/.exec(stdout);
      if (match) created.push(match[1]);
    });
    try {
      await waitFor(
        () => (stdout.includes(READY_PREFIX) ? stdout : undefined),
        15000,
      );
      assert.deepEqual(
        [...new Set(created)],
        ['browsercli-frommanager'],
        'the baked name must win over the cwd fallback',
      );
      assert.ok(
        !stdout.includes(workspaceTaskSpaceName(process.cwd())),
        'the cwd hash must not be used when the manager supplied a name',
      );
      // The fallback is still there for a directly imported worker.
      assert.equal(typeof workspaceTaskSpaceName(process.cwd()), 'string');
    } finally {
      child.kill();
    }
  });

  it('derives the workspace task-space name from the cwd hash', () => {
    const first = workspaceTaskSpaceName('C:\\work\\project-a');
    assert.match(first, /^browsercli-[0-9a-f]{12}$/);
    assert.equal(first, workspaceTaskSpaceName('C:\\work\\project-a'));
    assert.notEqual(first, workspaceTaskSpaceName('C:\\work\\project-b'));
  });

  it('maps ego.listTabs() to a target-id whitelist', async () => {
    const fake = createFakeEgo({
      listTabs: async () => ({
        tabs: [{targetId: 'own-1'}, {targetId: 'own-2'}, {title: 'no id'}],
      }),
    });
    assert.deepEqual(await listTabsOwnTargetIds(fake.ego), ['own-1', 'own-2']);

    const userControl = createFakeEgo({
      listTabs: async () => ({
        error: 'manual_takeover',
        error_code: 'EGO_TASK_SPACE_USER_IN_CONTROL',
      }),
    });
    assert.deepEqual(await listTabsOwnTargetIds(userControl.ego), []);

    const missing = createFakeEgo({listTabs: undefined});
    assert.deepEqual(await listTabsOwnTargetIds(missing.ego), []);
  });

  it('autostarts with the listTabs firewall even when NODE_ENV is "test"', async () => {
    const workerUrl = new URL(
      '../../../../src/modules/browser/ego/ego-bridge-worker.js',
      import.meta.url,
    ).href;
    // The child only exposes native bindings, never an injected whitelist: the
    // firewall must come from the autostart default, i.e. ego.listTabs().
    const script = `
      globalThis.ego = {
        sendCDPMessage() {},
        onCDPMessage: undefined,
        onSendCDPMessageError: undefined,
        listTabs: async () => ({tabs: [{targetId: 'own-target'}]}),
        createTaskSpace: async name => ({id: 1, name}),
        useTaskSpace: () => 1,
        closeTaskSpace: async () => { process.stdout.write('[finish:close]'); },
      };
      await import(${JSON.stringify(workerUrl)});
      const foreign = JSON.stringify({
        method: 'Target.targetCreated',
        params: {
          targetInfo: {
            targetId: 'user-private-tab',
            url: 'https://mail.example.com/inbox',
            title: 'Private Inbox',
          },
        },
      });
      const own = JSON.stringify({
        method: 'Target.targetCreated',
        params: {targetInfo: {targetId: 'own-target', url: 'https://example.com/'}},
      });
      setInterval(() => {
        globalThis.ego.onCDPMessage?.(foreign);
        globalThis.ego.onCDPMessage?.(own);
      }, 20);
    `;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: {
          ...process.env,
          NODE_ENV: 'test',
          // The real parent signals pi.
          EGO_BRIDGE_PARENT_PID: String(process.pid),
        },
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
      const endpoint = /\[ego-bridge:ready\] (ws:\/\/\S+)/.exec(stdout)?.[1];
      assert.ok(endpoint, `expected a ready line, got ${stdout}`);

      const ws = await connect(endpoint);
      try {
        const received = collect(ws);
        await waitFor(
          () => received.raw.find(frame => frame.includes('own-target')),
          15000,
        );
        await delay(150);
        assert.deepEqual(
          received.raw.filter(frame => frame.includes('mail.example.com')),
          [],
          'autostart must filter foreign targets using ego.listTabs()',
        );
      } finally {
        ws.close();
      }

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

  it('shuts down when the parent pid disappears (the only channel the real host has)', async () => {
    // W3: in production stdin is at EOF immediately and never fires again, so
    // process.ppid polling is what actually detects a dead manager. Here the
    // manager pid is deliberately one that cannot exist.
    const workerUrl = new URL(
      '../../../../src/modules/browser/ego/ego-bridge-worker.js',
      import.meta.url,
    ).href;
    const finishes: string[] = [];
    const script = `
      globalThis.ego = {
        sendCDPMessage() {},
        onCDPMessage: undefined,
        onSendCDPMessageError: undefined,
        listTabs: async () => ({tabs: []}),
        createTaskSpace: async name => ({id: 1, name}),
        useTaskSpace: () => 1,
        closeTaskSpace: async () => {},
        completeTaskSpace: async () => {},
      };
      await import(${JSON.stringify(workerUrl)});
      setInterval(() => {}, 1000);
    `;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // A pid that is essentially guaranteed to be vacant.
          EGO_BRIDGE_PARENT_PID: '4294967290',
          EGO_BRIDGE_LIVENESS_POLL_MS: '50',
        },
      },
    );
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('exit', code => finishes.push(`exit:${code}`));
    try {
      await waitFor(
        () => (stdout.includes(READY_PREFIX) ? stdout : undefined),
        15000,
      );
      await waitFor(() => (finishes.length > 0 ? finishes : undefined), 5000);
      assert.deepEqual(
        finishes,
        ['exit:0'],
        'a lost parent must run the graceful shutdown, not crash',
      );
    } finally {
      child.kill();
    }
  });

  it('shuts down when the stop file appears', async () => {
    // W4: a file, not a signal: on Windows the embedded runtime does not receive
    // signals sent to the launcher, and stdin is already at EOF.
    const workerUrl = new URL(
      '../../../../src/modules/browser/ego/ego-bridge-worker.js',
      import.meta.url,
    ).href;
    const stopDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ego-stop-'));
    const stopFile = path.join(stopDir, 'stop');
    const script = `
      globalThis.ego = {
        sendCDPMessage() {},
        onCDPMessage: undefined,
        onSendCDPMessageError: undefined,
        listTabs: async () => ({tabs: []}),
        createTaskSpace: async name => ({id: 1, name}),
        useTaskSpace: () => 1,
        closeTaskSpace: async () => { process.stdout.write('[finish:close]'); },
        completeTaskSpace: async () => {},
      };
      await import(${JSON.stringify(workerUrl)});
      setInterval(() => {}, 1000);
    `;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          EGO_BRIDGE_PARENT_PID: String(process.pid),
          EGO_BRIDGE_STOP_FILE: stopFile,
          EGO_BRIDGE_LIVENESS_POLL_MS: '50',
        },
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
      fs.writeFileSync(stopFile, 'stop');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`worker did not exit; stdout: ${stdout}`)),
          10000,
        );
        child.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      // The stop file must run the same cleanup as the stdin path.
      assert.match(stdout, /\[finish:close\]/);
    } finally {
      child.kill();
      fs.rmSync(stopDir, {recursive: true, force: true});
    }
  });

  it('runs the cleanup policy when SIGTERM arrives', async () => {
    // W4: signal handling is the graceful path where the host delivers signals.
    //
    // On win32 `child.kill('SIGTERM')` is TerminateProcess: the handler can never
    // run (verified — the process dies with signalCode 'SIGTERM' and no cleanup).
    // So on Windows the signal is emitted in-process instead, which still fails
    // if the handler is not wired; on POSIX the real signal is used.
    const workerUrl = new URL(
      '../../../../src/modules/browser/ego/ego-bridge-worker.js',
      import.meta.url,
    ).href;
    // The retention policy is recorded in a file: `process.exit()` after the stop
    // would truncate a pending stdout write, and the policy is the point here.
    const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ego-sigterm-'));
    const marker = path.join(markerDir, 'finish.txt');
    const script = `
      const fs = await import('node:fs');
      globalThis.ego = {
        sendCDPMessage() {},
        onCDPMessage: undefined,
        onSendCDPMessageError: undefined,
        listTabs: async () => ({tabs: []}),
        createTaskSpace: async name => ({id: 1, name}),
        useTaskSpace: () => 1,
        // The retention policy picks one of these two bindings: with keepPage the
        // worker must complete the space, and must not close it.
        closeTaskSpace: async () => {
          fs.appendFileSync(${JSON.stringify(marker)}, 'closeTaskSpace;');
        },
        completeTaskSpace: async () => {
          fs.appendFileSync(${JSON.stringify(marker)}, 'completeTaskSpace;');
        },
      };
      await import(${JSON.stringify(workerUrl)});
      const emitWhenAsked = setInterval(() => {
        if (!fs.existsSync(${JSON.stringify(marker)}.trigger)) return;
        clearInterval(emitWhenAsked);
        process.emit('SIGTERM');
      }, 20);
      setInterval(() => {}, 1000);
    `;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          EGO_BRIDGE_PARENT_PID: String(process.pid),
          EGO_BRIDGE_KEEP_PAGE: '1',
          EGO_BRIDGE_LIVENESS_POLL_MS: '60000',
        },
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
      if (process.platform === 'win32') {
        // TerminateProcess would skip the handler, so ask the child to emit it.
        fs.writeFileSync(`${marker}.trigger`, 'go');
      } else {
        child.kill('SIGTERM');
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(`worker did not exit on SIGTERM; stdout: ${stdout}`),
            ),
          10000,
        );
        child.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      // `keepPage` must reach the retention policy, not just close the socket.
      assert.equal(
        fs.readFileSync(marker, 'utf8'),
        'completeTaskSpace;',
        'SIGTERM must run the keep-all cleanup policy',
      );
    } finally {
      child.kill();
      fs.rmSync(markerDir, {recursive: true, force: true});
    }
  });
});
