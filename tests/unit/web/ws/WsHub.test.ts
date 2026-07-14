/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {beforeEach, describe, it} from 'node:test';

import type {ServerMsg} from '../../../../src/web/types.js';
import {WsHub, type MinimalWebSocket} from '../../../../src/web/ws/WsHub.js';

interface MockWs extends MinimalWebSocket {
  sent: ServerMsg[];
  readyState: number;
  send(data: string): void;
  close(): void;
}

function mockWs(readyState = 1): MockWs {
  const sent: ServerMsg[] = [];
  return {
    readyState,
    sent,
    send(data: string) {
      sent.push(JSON.parse(data) as ServerMsg);
    },
    close() {
      this.readyState = 3;
    },
  };
}

describe('WsHub', () => {
  let hub: WsHub;
  let ws: MockWs;

  beforeEach(() => {
    hub = new WsHub();
    ws = mockWs();
  });

  it('replays lastState snapshot when subscribing to a state channel', () => {
    hub.broadcast('worker.status', {ok: true, version: '2.0.3'});
    hub.subscribe(ws, 'worker.status');

    assert.strictEqual(ws.sent.length, 1);
    assert.strictEqual(ws.sent[0]!.type, 'snapshot');
    const snap = ws.sent[0] as {
      type: 'snapshot';
      channel: string;
      payload: unknown;
    };
    assert.strictEqual(snap.channel, 'worker.status');
    assert.deepStrictEqual(snap.payload, {ok: true, version: '2.0.3'});
  });

  it('does NOT replay history when subscribing to a stream channel', () => {
    hub.broadcast('tool.invoke', {traceId: 'tr_old_1', toolName: 'x'});
    hub.broadcast('tool.invoke', {traceId: 'tr_old_2', toolName: 'y'});
    hub.subscribe(ws, 'tool.invoke');

    assert.strictEqual(
      ws.sent.length,
      0,
      'stream 频道订阅时不应回放任何旧事件',
    );

    hub.broadcast('tool.invoke', {traceId: 'tr_new', toolName: 'z'});
    assert.strictEqual(ws.sent.length, 1);
    const evt = ws.sent[0] as {
      type: 'event';
      channel: string;
      payload: unknown;
    };
    assert.strictEqual(evt.type, 'event');
    assert.deepStrictEqual(evt.payload, {traceId: 'tr_new', toolName: 'z'});
  });

  it('subscribing to state channel with no prior state sends nothing', () => {
    hub.subscribe(ws, 'worker.status');
    assert.strictEqual(ws.sent.length, 0);

    hub.broadcast('worker.status', {ok: true});
    assert.strictEqual(ws.sent.length, 1);
    assert.strictEqual(ws.sent[0]!.type, 'event');
  });

  it('broadcast applies filterFn to skip non-matching subscribers', () => {
    const ws1 = mockWs();
    const ws2 = mockWs();
    hub.subscribe(ws1, 'hook.sample', {hookId: 'hook-a'});
    hub.subscribe(ws2, 'hook.sample', {hookId: 'hook-b'});

    hub.broadcast(
      'hook.sample',
      {hookId: 'hook-a', seq: 1},
      sub => sub.filter?.hookId === 'hook-a',
    );

    assert.strictEqual(ws1.sent.length, 1);
    assert.strictEqual(ws2.sent.length, 0);
  });

  it('unsubscribe removes only the targeted channel for that connection', () => {
    hub.subscribe(ws, 'tool.invoke');
    hub.subscribe(ws, 'hook.sample');
    hub.unsubscribe(ws, 'tool.invoke');

    hub.broadcast('tool.invoke', {a: 1});
    hub.broadcast('hook.sample', {b: 2});

    assert.strictEqual(ws.sent.length, 1);
    const evt = ws.sent[0] as {channel: string};
    assert.strictEqual(evt.channel, 'hook.sample');
  });

  it('handleDisconnect removes all subscriptions for a connection', () => {
    hub.subscribe(ws, 'tool.invoke');
    hub.subscribe(ws, 'hook.sample');
    assert.strictEqual(hub.getSubscriberCount('tool.invoke'), 1);

    hub.handleDisconnect(ws);
    assert.strictEqual(hub.getSubscriberCount('tool.invoke'), 0);
    assert.strictEqual(hub.getSubscriberCount('hook.sample'), 0);

    hub.broadcast('tool.invoke', {a: 1});
    assert.strictEqual(ws.sent.length, 0);
  });

  it('handleClientMessage processes subscribe/unsubscribe/ping', () => {
    const subscribed = hub.handleClientMessage(
      ws,
      JSON.stringify({type: 'subscribe', channel: 'tool.invoke'}),
    );
    assert.strictEqual(subscribed, true);
    assert.strictEqual(hub.getSubscriberCount('tool.invoke'), 1);

    ws.sent.length = 0;
    const ponged = hub.handleClientMessage(ws, JSON.stringify({type: 'ping'}));
    assert.strictEqual(ponged, true);
    assert.strictEqual(ws.sent.length, 1);
    const pong = ws.sent[0] as {type: string; ts: number};
    assert.strictEqual(pong.type, 'pong');
    assert.strictEqual(typeof pong.ts, 'number');

    const unsubbed = hub.handleClientMessage(
      ws,
      JSON.stringify({type: 'unsubscribe', channel: 'tool.invoke'}),
    );
    assert.strictEqual(unsubbed, true);
    assert.strictEqual(hub.getSubscriberCount('tool.invoke'), 0);
  });

  it('handleClientMessage rejects invalid JSON with INVALID_JSON error', () => {
    const ok = hub.handleClientMessage(ws, '{not json');
    assert.strictEqual(ok, false);
    assert.strictEqual(ws.sent.length, 1);
    const err = ws.sent[0] as {type: string; code: string};
    assert.strictEqual(err.type, 'error');
    assert.strictEqual(err.code, 'INVALID_JSON');
  });

  it('subscribe to unknown channel sends INVALID_CHANNEL error and does not register', () => {
    hub.subscribe(ws, 'bogus.channel' as never);
    assert.strictEqual(ws.sent.length, 1);
    const err = ws.sent[0] as {type: string; code: string};
    assert.strictEqual(err.type, 'error');
    assert.strictEqual(err.code, 'INVALID_CHANNEL');
    assert.strictEqual(hub.getSubscriberCount('bogus.channel' as never), 0);
  });

  it('broadcast skips connections whose readyState is not OPEN', () => {
    hub.subscribe(ws, 'tool.invoke');
    ws.readyState = 3; // CLOSED
    hub.broadcast('tool.invoke', {a: 1});
    assert.strictEqual(ws.sent.length, 0);
  });

  it('updateState refreshes lastState without notifying current subscribers', () => {
    hub.subscribe(ws, 'worker.status');
    hub.updateState('worker.status', {ok: true});
    assert.strictEqual(
      ws.sent.length,
      0,
      'updateState 是纯写入，不该通知现有订阅者',
    );

    const ws2 = mockWs();
    hub.subscribe(ws2, 'worker.status');
    assert.strictEqual(ws2.sent.length, 1);
    const snap = ws2.sent[0] as {type: 'snapshot'; payload: unknown};
    assert.strictEqual(snap.type, 'snapshot');
    assert.deepStrictEqual(snap.payload, {ok: true});
  });
});
