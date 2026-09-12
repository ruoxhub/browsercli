/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DatabaseManager} from '../../../../src/database/DatabaseManager.js';
import {SqliteSessionStore} from '../../../../src/modules/session/SqliteSessionStore.js';
import type {
  AiReportRow,
  CapturedRequestRow,
  HookRecordRow,
  RequestFilter,
  StorageSnapshotRow,
} from '../../../../src/modules/session/types.js';

function makeStore(): {store: SqliteSessionStore; manager: DatabaseManager} {
  const manager = new DatabaseManager(':memory:');
  return {store: new SqliteSessionStore(manager), manager};
}

function makeRequestRow(
  id: string,
  sessionId: string,
  sequence: number,
  url: string,
): CapturedRequestRow {
  return {
    id,
    sessionId,
    sequence,
    timestamp: 100 + sequence,
    method: 'GET',
    url,
    source: 'proxy',
    requestHeaders: '{}',
    requestBody: 'x'.repeat(2048),
    statusCode: 200,
    responseHeaders: '{}',
    responseBody: 'y'.repeat(2048),
    contentType: 'application/json',
    initiator: null,
    durationMs: 0,
    isStreaming: 0,
    isWebSocket: 0,
    truncated: 1,
  };
}

describe('SqliteSessionStore', () => {
  it('creates, lists, and updates a session', () => {
    const {store, manager} = makeStore();
    try {
      const row = store.createSession({
        id: 's1',
        name: 'demo',
        targetUrl: 'https://a.dev',
      });
      assert.strictEqual(row.id, 's1');
      assert.strictEqual(row.status, 'capturing');
      assert.strictEqual(store.listSessions().length, 1);

      store.updateSessionStatus('s1', 'stopped');
      assert.strictEqual(store.getSession('s1')?.status, 'stopped');
    } finally {
      manager.close();
    }
  });

  it('appends and filters captured requests', () => {
    const {store, manager} = makeStore();
    try {
      store.createSession({id: 's1', name: 'demo'});
      const req: CapturedRequestRow = {
        id: 's1-1',
        sessionId: 's1',
        sequence: 1,
        timestamp: 100,
        method: 'POST',
        url: 'https://a.dev/api/sign',
        source: 'proxy',
        requestHeaders: '{"content-type":"application/json"}',
        requestBody: '{"q":1}',
        statusCode: 200,
        responseHeaders: null,
        responseBody: '{"ok":true}',
        contentType: 'application/json',
        initiator: null,
        durationMs: 12,
        isStreaming: 0,
        isWebSocket: 0,
        truncated: 0,
      };
      store.appendRequest(req);

      const all = store.getRequests('s1');
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]?.url, req.url);

      assert.strictEqual(
        store.getRequests('s1', {urlFilter: 'SIGN'}).length,
        1,
      );
      assert.strictEqual(
        store.getRequests('s1', {urlFilter: 'missing'}).length,
        0,
      );
      assert.strictEqual(store.getRequests('s1', {sources: ['cdp']}).length, 0);
      assert.strictEqual(
        store.getRequests('s1', {sources: ['proxy']}).length,
        1,
      );
    } finally {
      manager.close();
    }
  });

  it('appends hooks and snapshots', () => {
    const {store, manager} = makeStore();
    try {
      store.createSession({id: 's1', name: 'demo'});
      const hook: HookRecordRow = {
        sessionId: 's1',
        timestamp: 101,
        hookType: 'crypto',
        functionName: 'subtle.encrypt',
        arguments: '["aes-gcm"]',
        result: '{"iv":"...","data":"..."}',
        callStack: 'at sign (app.js:1:1)',
      };
      store.appendHook(hook);
      assert.strictEqual(store.getHooks('s1').length, 1);

      const snap: StorageSnapshotRow = {
        sessionId: 's1',
        timestamp: 102,
        kind: 'cookie',
        origin: 'https://a.dev',
        key: 'session',
        value: 'MASKED',
      };
      store.appendSnapshot(snap);
      assert.strictEqual(store.getSnapshots('s1').length, 1);
    } finally {
      manager.close();
    }
  });

  it('saves and retrieves ai reports', () => {
    const {store, manager} = makeStore();
    try {
      store.createSession({id: 's1', name: 'demo'});
      const r1: AiReportRow = {
        id: 'rep-1',
        sessionId: 's1',
        mode: 'full',
        sceneHints: 'login flow',
        purifiedSummary: '{"endpoints":["/api/login"]}',
        reportMarkdown: '# Analysis Report',
        messages: JSON.stringify([{role: 'user', content: 'analyze'}]),
        createdAt: 1000,
      };
      const r2: AiReportRow = {
        id: 'rep-2',
        sessionId: 's1',
        mode: 'quick',
        sceneHints: null,
        purifiedSummary: null,
        reportMarkdown: '# Quick Report',
        messages: '[]',
        createdAt: 2000,
      };

      store.saveReport(r1);
      store.saveReport(r2);

      const fetched1 = store.getReport('rep-1');
      assert.deepStrictEqual(fetched1, r1);

      const nonExistent = store.getReport('rep-none');
      assert.strictEqual(nonExistent, null);

      const reports = store.getReports('s1');
      assert.strictEqual(reports.length, 2);
      // Ordered by created_at DESC
      assert.strictEqual(reports[0]?.id, 'rep-2');
      assert.strictEqual(reports[1]?.id, 'rep-1');
      assert.deepStrictEqual(reports[0], r2);
      assert.deepStrictEqual(reports[1], r1);
    } finally {
      manager.close();
    }
  });

  it('reads a single request by id', () => {
    const {store, manager} = makeStore();
    try {
      store.createSession({id: 's1', name: 'demo'});
      store.appendRequest(makeRequestRow('s1-1', 's1', 1, 'https://a.dev/one'));
      store.appendRequest(makeRequestRow('s1-2', 's1', 2, 'https://a.dev/two'));

      assert.strictEqual(store.getRequest('s1-2')?.url, 'https://a.dev/two');
      assert.strictEqual(store.getRequest('missing'), null);
    } finally {
      manager.close();
    }
  });

  it('lists summaries newest-first without body columns', () => {
    const {store, manager} = makeStore();
    try {
      store.createSession({id: 's1', name: 'demo'});
      for (let i = 1; i <= 5; i++) {
        store.appendRequest(
          makeRequestRow(`s1-${i}`, 's1', i, `https://a.dev/${i}`),
        );
      }

      const page = store.listRequestSummaries('s1', undefined, {
        limit: 3,
        offset: 1,
      });
      assert.deepStrictEqual(
        page.map(r => r.sequence),
        [4, 3, 2],
        'ORDER BY sequence DESC + LIMIT/OFFSET',
      );
      assert.strictEqual('requestBody' in (page[0] as object), false);
      assert.strictEqual('responseBody' in (page[0] as object), false);
      assert.strictEqual('requestHeaders' in (page[0] as object), false);
      assert.strictEqual('responseHeaders' in (page[0] as object), false);
      assert.strictEqual(page[0]?.truncated, 1, 'flag preserved as 0/1 number');

      const filtered = store.listRequestSummaries('s1', {
        sources: ['proxy'],
        urlFilter: 'DEV/3',
      });
      assert.deepStrictEqual(
        filtered.map(r => r.url),
        ['https://a.dev/3'],
        'sources + case-insensitive urlFilter',
      );

      const other = store.listRequestSummaries('other-session');
      assert.deepStrictEqual(other, []);
    } finally {
      manager.close();
    }
  });

  it('filters requests and summaries using flowFilter expressions', () => {
    const {store, manager} = makeStore();
    try {
      store.createSession({id: 's1', name: 'demo'});

      // 构造两行数据：一行响应体包含 Postgres，另一行包含 MySQL
      const row1 = makeRequestRow(
        's1-1',
        's1',
        1,
        'https://api.bilibili.com/x/web-interface/view',
      );
      row1.responseBody = JSON.stringify({
        data: {
          title: '为什么PostgreSQL能超越MySQL',
          desc: '为什么Postgres能超越Mysql登顶最受欢迎的数据库',
        },
      });
      row1.method = 'GET';
      row1.statusCode = 200;
      store.appendRequest(row1);

      const row2 = makeRequestRow(
        's1-2',
        's1',
        2,
        'https://api.bilibili.com/x/player/v2',
      );
      row2.responseBody = JSON.stringify({
        data: {
          title: 'Redis 进阶课程',
          desc: '内存数据库深度解析',
        },
      });
      row2.method = 'POST';
      row2.statusCode = 200;
      store.appendRequest(row2);

      // 1. 测试 ~bs Postgres (响应正文匹配)
      const bsMatch = store.listRequestSummaries('s1', {
        filter: '~bs Postgres',
      });
      assert.strictEqual(bsMatch.length, 1);
      assert.strictEqual(bsMatch[0]?.id, 's1-1');

      // 2. 测试 getRequests 带 filter 的口径对齐
      const getMatch = store.getRequests('s1', {filter: '~bs Postgres'});
      assert.strictEqual(getMatch.length, 1);
      assert.strictEqual(getMatch[0]?.id, 's1-1');

      // 3. 测试复合流过滤 ~m POST & ~c 200
      const postMatch = store.listRequestSummaries('s1', {
        filter: '~m POST & ~c 200',
      });
      assert.strictEqual(postMatch.length, 1);
      assert.strictEqual(postMatch[0]?.id, 's1-2');

      // 4. 测试排除匹配 !~bs Redis
      const notRedis = store.listRequestSummaries('s1', {filter: '!~bs Redis'});
      assert.strictEqual(notRedis.length, 1);
      assert.strictEqual(notRedis[0]?.id, 's1-1');

      // 5. countRequests 与 getRequests/listRequestSummaries 口径一致
      const parityFilters: RequestFilter[] = [
        {},
        {sources: ['proxy']},
        {filter: '~bs Postgres'},
        {filter: '~m POST & ~c 200'},
      ];
      for (const filter of parityFilters) {
        assert.strictEqual(
          store.countRequests('s1', filter),
          store.getRequests('s1', filter).length,
          `countRequests 应与 getRequests 一致：${JSON.stringify(filter)}`,
        );
      }
    } finally {
      manager.close();
    }
  });

  it('trims to the newest keepLast rows and is a no-op below quota', () => {
    const {store, manager} = makeStore();
    try {
      store.createSession({id: 's1', name: 'demo'});
      for (let i = 1; i <= 7; i++) {
        store.appendRequest(
          makeRequestRow(`s1-${i}`, 's1', i, `https://a.dev/${i}`),
        );
      }

      assert.strictEqual(store.trimRequests('s1', 5), 2, 'deleted two oldest');
      assert.deepStrictEqual(
        store.getRequests('s1').map(r => r.sequence),
        [3, 4, 5, 6, 7],
      );

      assert.strictEqual(store.trimRequests('s1', 5), 0, 'below quota: no-op');
      assert.strictEqual(store.trimRequests('s1', 1), 4);
      assert.deepStrictEqual(
        store.getRequests('s1').map(r => r.sequence),
        [7],
        'keepLast=1 keeps only the newest',
      );
    } finally {
      manager.close();
    }
  });
});
