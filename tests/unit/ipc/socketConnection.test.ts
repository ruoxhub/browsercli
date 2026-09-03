/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

import {SocketConnection, pipePath} from '../../../src/ipc/socketConnection.js';

function tempPipe(): string {
  return pipePath(
    `browsercli-test-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
}

test('sends and receives NDJSON messages', async () => {
  const path = tempPipe();
  const received: unknown[] = [];
  const server = net.createServer(s => {
    const conn = new SocketConnection(s);
    conn.onmessage = m => {
      received.push(m);
      conn.send({id: (m as {id: number}).id, result: 'pong'});
    };
  });
  await new Promise<void>(r => server.listen(path, r));
  const client = new SocketConnection(net.createConnection(path));
  const replyP = new Promise<unknown>(r => {
    client.onmessage = r;
  });
  await client.send({id: 1, method: 'hello'});
  const reply = await Promise.race([
    replyP,
    new Promise(r => setTimeout(() => r('timeout'), 2000)),
  ]);
  assert.deepEqual(reply, {id: 1, result: 'pong'});
  assert.deepEqual(received, [{id: 1, method: 'hello'}]);
  client.close();
  server.close();
});

test('reassembles a message split across data chunks', async () => {
  const path = tempPipe();
  const server = net.createServer(s => {
    const conn = new SocketConnection(s);
    conn.onmessage = m => {
      conn.send({id: (m as {id: number}).id, result: 'ok'});
    };
  });
  await new Promise<void>(r => server.listen(path, r));
  const sock = net.createConnection(path);
  await new Promise<void>(r => sock.once('connect', () => r()));
  sock.write('{"id":1,"me');
  await new Promise(r => setTimeout(r, 50));
  sock.write('thod":"x"}\n');
  const conn = new SocketConnection(sock);
  const got = await new Promise<unknown>(r => {
    conn.onmessage = r;
  });
  assert.deepEqual(got, {id: 1, result: 'ok'});
  conn.close();
  server.close();
});

test('onclose fires when peer destroys', async () => {
  const path = tempPipe();
  let closed = 0;
  const server = net.createServer(s => {
    const conn = new SocketConnection(s);
    conn.onclose = () => {
      closed++;
    };
  });
  await new Promise<void>(r => server.listen(path, r));
  const c1 = new SocketConnection(net.createConnection(path));
  await new Promise(r => setTimeout(r, 100));
  c1.close();
  await new Promise(r => setTimeout(r, 200));
  assert.ok(closed >= 1);
  server.close();
});
