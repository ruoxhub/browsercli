/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import type {BrowserContext, Response} from 'patchright';

import {DatabaseManager} from '../../../src/database/DatabaseManager.js';
import {MitmModule} from '../../../src/modules/proxy/MitmModule.js';
import type {CapturedExchange} from '../../../src/modules/proxy/types.js';
import {fromMitmExchange} from '../../../src/modules/session/adapters/index.js';
import {CaptureEngine} from '../../../src/modules/session/CaptureEngine.js';
import {CaptureSessionManager} from '../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../src/modules/session/SqliteSessionStore.js';
import {SessionCaptureBridge} from '../../../src/worker/context/SessionCaptureBridge.js';

function cdpResponse(url: string): Response {
  return {
    status: () => 200,
    headers: () => ({'content-type': 'application/json'}),
    request: () => ({
      method: () => 'GET',
      url: () => url,
      headers: () => ({}),
      postData: () => null,
    }),
    text: async () => '{"ok":true}',
  } as unknown as Response;
}

function exchange(url: string): CapturedExchange {
  return {
    requestId: 'r1',
    method: 'GET',
    url,
    requestHeaders: {},
    requestBody: null,
    statusCode: 200,
    responseHeaders: {},
    responseBody: '{"ok":true}',
    contentType: 'application/json',
    isOptions: false,
    isStatic: false,
    isStreaming: false,
    isWebSocket: false,
    truncated: false,
    timestamp: Date.now(),
  };
}

const flush = (): Promise<void> =>
  new Promise(resolve => setImmediate(resolve));

describe('切片 2 双链路接线', () => {
  it('lands CDP and MITM captures in one shared session', async () => {
    const db = new DatabaseManager(':memory:');
    const store = new SqliteSessionStore(db);
    const manager = new CaptureSessionManager(store);
    const engine = new CaptureEngine(manager, store);

    // CDP 链路
    const listeners = new Set<(response: Response) => void>();
    const context = {
      on: (event: string, handler: (response: Response) => void) => {
        if (event === 'response') listeners.add(handler);
        return context;
      },
      off: (_event: string, handler: (response: Response) => void) => {
        listeners.delete(handler);
        return context;
      },
    } as unknown as BrowserContext;
    const bridge = new SessionCaptureBridge(() => engine);
    bridge.attach(context);

    // MITM 链路
    const certsDir = mkdtempSync(path.join(os.tmpdir(), 'capture-wiring-'));
    const mitm = new MitmModule(certsDir, ex => {
      engine.ingestRequest(fromMitmExchange(ex));
    });

    try {
      for (const listener of [...listeners]) {
        listener(cdpResponse('https://f.dev/api/cdp'));
      }
      await flush();
      mitm.recordExchange(exchange('https://f.dev/api/mitm'));
      await flush();

      const session = manager.getActiveSession();
      assert.ok(session, '两条链路必须共享同一个自动创建的会话');

      const all = manager.getRequests(session.id);
      assert.strictEqual(all.length, 2, 'CDP 与 MITM 各一行，不得重复落库');
      assert.deepStrictEqual(
        all.map(r => r.sequence).sort((a, b) => a - b),
        [1, 2],
        'sequence 由 manager 单调递增，两条链路共用计数器',
      );

      const cdpOnly = store.listRequestSummaries(session.id, {
        sources: ['cdp'],
      });
      assert.strictEqual(cdpOnly.length, 1);
      assert.strictEqual(cdpOnly[0]!.url, 'https://f.dev/api/cdp');

      const proxyOnly = store.listRequestSummaries(session.id, {
        sources: ['proxy'],
      });
      assert.strictEqual(proxyOnly.length, 1);
      assert.strictEqual(proxyOnly[0]!.url, 'https://f.dev/api/mitm');

      // 旧链路仍在（并存红线）
      assert.strictEqual(mitm.getStore().size(), 1);

      assert.strictEqual(engine.getFailureCount(), 0);
      assert.strictEqual(bridge.getDroppedCount(), 0);
    } finally {
      bridge.detach();
      rmSync(certsDir, {recursive: true, force: true});
      db.close();
    }
  });
});
