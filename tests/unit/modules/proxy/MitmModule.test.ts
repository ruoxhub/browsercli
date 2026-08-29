/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {DatabaseManager} from '../../../../src/database/DatabaseManager.js';
import {MitmModule} from '../../../../src/modules/proxy/MitmModule.js';
import type {CapturedExchange} from '../../../../src/modules/proxy/types.js';
import {fromMitmExchange} from '../../../../src/modules/session/adapters/index.js';
import {CaptureEngine} from '../../../../src/modules/session/CaptureEngine.js';
import {CaptureSessionManager} from '../../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../../src/modules/session/SqliteSessionStore.js';

/** 与 MitmProxyServer 交给回调的形状一致（src/modules/proxy/types.ts:8-24）。 */
function makeExchange(): CapturedExchange {
  return {
    requestId: 'r1',
    method: 'POST',
    url: 'https://c.dev/api/token',
    requestHeaders: {'content-type': 'application/json'},
    requestBody: '{"a":1}',
    statusCode: 200,
    responseHeaders: {'content-type': 'application/json'},
    responseBody: '{"token":"t"}',
    contentType: 'application/json',
    isOptions: false,
    isStatic: false,
    isStreaming: false,
    isWebSocket: false,
    truncated: false,
    timestamp: Date.now(),
  };
}

describe('MitmModule', () => {
  it('status 未启动时返回 running=false 且 capturedCount=0', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    try {
      const mod = new MitmModule(dir);
      const result = mod.status();
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.running, false);
      assert.strictEqual(result.data.capturedCount, 0);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('clear 未捕获时返回 clearedCount=0', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    try {
      const mod = new MitmModule(dir);
      const result = mod.clear();
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.clearedCount, 0);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('exportCa 把 pem 写入目标路径并返回字节数', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'mitm-out-'));
    try {
      const mod = new MitmModule(dir);
      const outPath = path.join(outDir, 'ca.pem');
      const result = await mod.exportCa({format: 'pem', outputPath: outPath});
      assert.strictEqual(result.success, true);
      assert.ok(result.data.bytes > 0);
      assert.ok(existsSync(outPath));
    } finally {
      rmSync(dir, {recursive: true, force: true});
      rmSync(outDir, {recursive: true, force: true});
    }
  });

  it('feeds exchanges to the onExchange sink in addition to the store', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    const db = new DatabaseManager(':memory:');
    try {
      const store = new SqliteSessionStore(db);
      const manager = new CaptureSessionManager(store);
      const engine = new CaptureEngine(manager, store);
      const mod = new MitmModule(dir, exchange => {
        engine.ingestRequest(fromMitmExchange(exchange));
      });

      mod.recordExchange(makeExchange());

      // 旧链路仍然在（红线：并存）
      assert.strictEqual(mod.getStore().size(), 1);
      // 新链路已接线
      const session = manager.getActiveSession();
      assert.ok(session);
      const rows = manager.getRequests(session.id);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0]!.source, 'proxy');
      assert.strictEqual(rows[0]!.url, 'https://c.dev/api/token');
      assert.strictEqual(rows[0]!.statusCode, 200);
    } finally {
      rmSync(dir, {recursive: true, force: true});
      db.close();
    }
  });

  it('keeps the legacy store intact when the sink throws', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    try {
      const mod = new MitmModule(dir, () => {
        throw new Error('boom');
      });

      assert.doesNotThrow(() => mod.recordExchange(makeExchange()));
      assert.strictEqual(
        mod.getStore().size(),
        1,
        'spec §4/R3：水槽失败不得影响 ProxyStore 与 MITM server 回调',
      );
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('works with no sink configured', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    try {
      const mod = new MitmModule(dir);
      assert.doesNotThrow(() => mod.recordExchange(makeExchange()));
      assert.strictEqual(mod.getStore().size(), 1);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
