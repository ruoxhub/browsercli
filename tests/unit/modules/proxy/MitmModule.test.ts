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
function makeExchange(
  overrides: Partial<CapturedExchange> = {},
): CapturedExchange {
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
    modified: false,
    ...overrides,
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

  it('modified exchange 只进 store 不进 Session 水槽（Evidence-first）', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    const db = new DatabaseManager(':memory:');
    try {
      const store = new SqliteSessionStore(db);
      const manager = new CaptureSessionManager(store);
      const engine = new CaptureEngine(manager, store);
      const mod = new MitmModule(dir, exchange => {
        engine.ingestRequest(fromMitmExchange(exchange));
      });

      mod.recordExchange(
        makeExchange({modified: true, appliedRuleIds: ['b1']}),
      );

      assert.strictEqual(mod.getStore().size(), 1);
      // 水槽未被调用，会话不会被懒创建
      const session = manager.getActiveSession();
      assert.strictEqual(session, null);
    } finally {
      rmSync(dir, {recursive: true, force: true});
      db.close();
    }
  });

  it('listRequests 结构化过滤 method/host/bodyContains', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    try {
      const mod = new MitmModule(dir);
      mod.recordExchange(makeExchange());
      mod.recordExchange(
        makeExchange({
          method: 'GET',
          url: 'https://other.dev/static/app.js',
          requestBody: null,
          responseBody: 'console.log(1)',
          statusCode: 304,
        }),
      );

      assert.strictEqual(mod.listRequests({method: 'POST'}).data.total, 1);
      assert.strictEqual(mod.listRequests({host: 'other.dev'}).data.total, 1);
      assert.strictEqual(
        mod.listRequests({bodyContains: 'console.log'}).data.total,
        1,
      );
      assert.strictEqual(mod.listRequests({statusCode: 304}).data.total, 1);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('getRequest format=curl 生成 curl 命令并剥离运输头', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    try {
      const mod = new MitmModule(dir);
      mod.recordExchange(
        makeExchange({
          requestHeaders: {
            'content-type': 'application/json',
            'content-length': '10',
            host: 'c.dev',
          },
        }),
      );
      const result = await mod.getRequest({id: 1, format: 'curl'});
      assert.strictEqual(result.success, true);
      assert.ok(result.data.curl, '应含 curl 命令');
      assert.ok(result.data.curl.includes('curl'));
      assert.ok(result.data.curl.includes('-X POST'));
      assert.ok(!/content-length/i.test(result.data.curl), '运输头应被剥离');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('规则 add/list/remove/clear', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    try {
      const mod = new MitmModule(dir);
      const add = mod.addRule({
        action: {type: 'block', statusCode: 403},
        urlFilter: 'c.dev',
      });
      assert.strictEqual(add.success, true);
      assert.strictEqual(mod.listRules().data.rules.length, 1);

      const removed = mod.removeRule({id: add.data.rule.id});
      assert.strictEqual(removed.data.removed, true);
      assert.strictEqual(mod.listRules().data.rules.length, 0);

      mod.addRule({action: {type: 'block', statusCode: 403}});
      assert.strictEqual(mod.clearRules().data.clearedCount, 1);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('exportHar 返回 entries', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    try {
      const mod = new MitmModule(dir);
      mod.recordExchange(makeExchange());
      const result = await mod.exportHar();
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.entryCount, 1);
      const entries = (result.data.har as {log: {entries: unknown[]}}).log
        .entries;
      assert.strictEqual(entries.length, 1);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('host filter 增删查清 + shouldBypass 白/黑名单语义', () => {
    const mod = new MitmModule();

    // 两表皆空 → 不过滤
    assert.strictEqual(mod.shouldBypass('a.dev'), false);

    mod.addHostFilter({action: 'block', host: 'ads.dev'});
    assert.strictEqual(mod.shouldBypass('ads.dev'), true);
    assert.strictEqual(mod.shouldBypass('ADS.DEV'), true, '大小写不敏感');
    assert.strictEqual(mod.shouldBypass('sub.ads.dev'), true, '子串匹配');
    assert.strictEqual(mod.shouldBypass('other.dev'), false);

    // 白名单一旦非空 → 黑名单失效，不在白名单即旁路
    mod.addHostFilter({action: 'allow', host: 'api.dev'});
    assert.strictEqual(mod.shouldBypass('api.dev'), false);
    assert.strictEqual(
      mod.shouldBypass('ads.dev'),
      true,
      '白名单优先，黑名单失效',
    );
    assert.strictEqual(mod.shouldBypass('other.dev'), true);

    assert.deepStrictEqual(mod.listHostFilters().data, {
      allow: ['api.dev'],
      block: ['ads.dev'],
    });

    assert.strictEqual(
      mod.removeHostFilter({action: 'allow', host: 'api.dev'}).data.removed,
      true,
    );
    assert.strictEqual(
      mod.removeHostFilter({action: 'allow', host: 'nope.dev'}).data.removed,
      false,
    );

    assert.strictEqual(mod.clearHostFilters().data.clearedCount, 1);
    assert.strictEqual(mod.shouldBypass('ads.dev'), false, '清空后不过滤');
  });

  it('addHostFilter 拒绝空 host', () => {
    const mod = new MitmModule();
    const result = mod.addHostFilter({action: 'block', host: '  '});
    assert.strictEqual(result.success, false);
    assert.strictEqual(mod.shouldBypass('a.dev'), false, '不落 state');
  });

  it('start 传递 upstreamProxy 参数在 start 和 status 中正确反映', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-socks-'));
    const mod = new MitmModule(dir);
    try {
      const res = await mod.start(0, 'socks5://127.0.0.1:1080');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.upstreamProxy, 'socks5://127.0.0.1:1080');
      assert.match(res.message, /上游代理：socks5:\/\/127\.0\.0\.1:1080/);

      const status = mod.status();
      assert.strictEqual(status.data.running, true);
      assert.strictEqual(status.data.upstreamProxy, 'socks5://127.0.0.1:1080');

      await mod.stop();
      const stoppedStatus = mod.status();
      assert.strictEqual(stoppedStatus.data.running, false);
      assert.strictEqual(stoppedStatus.data.upstreamProxy, null);
    } finally {
      await mod.stop();
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('listRequests 支持 mitmproxy 流过滤表达式', () => {
    const mod = new MitmModule();
    mod.recordExchange(
      makeExchange({
        requestId: 'r1',
        method: 'POST',
        url: 'https://api.example.com/login',
        statusCode: 200,
      }),
    );
    mod.recordExchange(
      makeExchange({
        requestId: 'r2',
        method: 'GET',
        url: 'https://cdn.example.com/app.js',
        statusCode: 200,
        isStatic: true,
        contentType: 'application/javascript',
      }),
    );

    const rAll = mod.listRequests({});
    assert.strictEqual(rAll.data.total, 2);

    const rFilterPost = mod.listRequests({filter: '~m POST & ~c 200'});
    assert.strictEqual(rFilterPost.data.total, 1);
    assert.strictEqual(
      rFilterPost.data.requests[0].url,
      'https://api.example.com/login',
    );

    const rFilterNoAsset = mod.listRequests({filter: '!~a'});
    assert.strictEqual(rFilterNoAsset.data.total, 1);
    assert.strictEqual(
      rFilterNoAsset.data.requests[0].url,
      'https://api.example.com/login',
    );

    const rFilterAsset = mod.listRequests({filter: '~a'});
    assert.strictEqual(rFilterAsset.data.total, 1);
    assert.strictEqual(
      rFilterAsset.data.requests[0].url,
      'https://cdn.example.com/app.js',
    );
  });
});
