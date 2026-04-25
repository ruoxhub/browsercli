/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import WebSocket from 'ws';

import {
  resolveDebuggerLabDir,
  startDebuggerLabSite,
} from '../../../scripts/debugger-lab/server.mjs';

describe('debugger-lab server script', () => {
  it('resolves site dir inside scripts/debugger-lab', () => {
    const siteDir = resolveDebuggerLabDir();
    assert.match(siteDir, /scripts[\\/]+debugger-lab$/);
  });

  it('serves the debugger lab homepage and app asset', async () => {
    const handle = await startDebuggerLabSite({port: 0});

    try {
      const homepage = await fetch(`http://${handle.host}:${handle.port}/`);
      const app = await fetch(`http://${handle.host}:${handle.port}/app.js`);

      assert.strictEqual(homepage.status, 200);
      assert.match(homepage.headers.get('content-type') ?? '', /text\/html/);
      assert.match(await homepage.text(), /Debugger Lab/);

      assert.strictEqual(app.status, 200);
      assert.match(app.headers.get('content-type') ?? '', /javascript/);
      assert.match(await app.text(), /window\.debugLab/);
    } finally {
      await handle.close();
    }
  });

  it('returns dynamic ping payload for network testing', async () => {
    const handle = await startDebuggerLabSite({port: 0});

    try {
      const response = await fetch(
        `http://${handle.host}:${handle.port}/api/ping?via=fetch-test`,
        {
          headers: {'x-debugger-lab': 'unit-test'},
        },
      );
      const payload = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(payload.ok, true);
      assert.strictEqual(payload.via, 'fetch-test');
      assert.strictEqual(payload.headers['x-debugger-lab'], 'unit-test');
    } finally {
      await handle.close();
    }
  });

  it('accepts websocket connections and echoes messages', async () => {
    const handle = await startDebuggerLabSite({port: 0});

    try {
      const messages = await new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://${handle.host}:${handle.port}/ws`);
        const received = [];

        socket.once('error', reject);
        socket.on('message', data => {
          received.push(data.toString());
          if (received.length === 1) {
            socket.send('probe');
            return;
          }
          socket.close();
        });
        socket.on('close', () => resolve(received));
      });

      assert.match(messages[0] ?? '', /"type":"connected"/);
      assert.match(messages[1] ?? '', /"payload":"probe"/);
    } finally {
      await handle.close();
    }
  });
});
