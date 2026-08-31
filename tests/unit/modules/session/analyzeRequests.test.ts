/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DatabaseManager} from '../../../../src/database/DatabaseManager.js';
import type {AnalysisMode} from '../../../../src/modules/analyzer/ai/types.js';
import {runSessionAnalysis} from '../../../../src/modules/session/analyzeRequests.js';
import {CaptureEngine} from '../../../../src/modules/session/CaptureEngine.js';
import {CaptureSessionManager} from '../../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../../src/modules/session/SqliteSessionStore.js';
import type {CapturedRequestInput} from '../../../../src/modules/session/types.js';
import type {LLMService} from '../../../../src/services/LLMService.js';

function input(
  overrides: Partial<CapturedRequestInput> = {},
): CapturedRequestInput {
  return {
    timestamp: 1,
    method: 'GET',
    url: 'https://d.dev/api/x',
    source: 'cdp',
    requestHeaders:
      '{"authorization":"Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig"}',
    requestBody: null,
    statusCode: 200,
    responseHeaders: null,
    responseBody: '{"ok":true}',
    contentType: 'application/json',
    initiator: null,
    durationMs: 10,
    isStreaming: 0,
    isWebSocket: 0,
    truncated: 0,
    ...overrides,
  };
}

const notConfigured = {isConfigured: () => false} as unknown as LLMService;

const configured = {
  isConfigured: () => true,
  chat: async () => ({content: '# LLM 报告'}),
} as unknown as LLMService;

const throwing = {
  isConfigured: () => true,
  chat: async () => {
    throw new Error('LLM down');
  },
} as unknown as LLMService;

function fixture(): {
  manager: CaptureSessionManager;
  db: DatabaseManager;
  ids: string[];
} {
  const db = new DatabaseManager(':memory:');
  const store = new SqliteSessionStore(db);
  const manager = new CaptureSessionManager(store);
  const engine = new CaptureEngine(manager, store);
  manager.createSession({name: 't', targetUrl: 'https://d.dev'});
  engine.ingestRequest(input());
  engine.ingestRequest(
    input({url: 'https://d.dev/api/y', method: 'POST', timestamp: 2}),
  );
  engine.ingestRequest(
    input({url: 'https://d.dev/static/logo.png', timestamp: 3}),
  );
  return {
    manager,
    db,
    ids: manager.getRequests(manager.requireActiveSession().id).map(r => r.id),
  };
}

describe('runSessionAnalysis', () => {
  it('analyzes only the selected request ids', async () => {
    const {manager, db, ids} = fixture();
    try {
      const result = await runSessionAnalysis({
        requestIds: [ids[1]!],
        mode: 'api_reverse',
        manager,
        llmService: notConfigured,
      });

      assert.strictEqual(result.requestCount, 1);
      assert.strictEqual(result.mode, 'api_reverse');
      assert.strictEqual(result.llmUsed, false);
      assert.strictEqual(result.reportId, null, 'persist 缺省不落库');
      assert.ok(
        result.reportMarkdown.includes('https://d.dev/api/y'),
        '报告含选中请求',
      );
      assert.ok(
        !result.reportMarkdown.includes('https://d.dev/api/x'),
        '报告不含未选中请求',
      );
    } finally {
      db.close();
    }
  });

  it('analyzes everything when no requestIds given', async () => {
    const {manager, db} = fixture();
    try {
      const result = await runSessionAnalysis({
        manager,
        llmService: notConfigured,
      });
      assert.strictEqual(result.requestCount, 3);
    } finally {
      db.close();
    }
  });

  it('persists the report and returns its id when persist is set', async () => {
    const {manager, db, ids} = fixture();
    try {
      const sessionId = manager.requireActiveSession().id;
      const result = await runSessionAnalysis({
        requestIds: ids.slice(0, 2),
        persist: true,
        manager,
        llmService: notConfigured,
      });

      assert.ok(result.reportId);
      assert.strictEqual(manager.getReports(sessionId).length, 1);
      assert.strictEqual(manager.getReports(sessionId)[0]!.mode, 'auto');
    } finally {
      db.close();
    }
  });

  it('uses the LLM when configured', async () => {
    const {manager, db} = fixture();
    try {
      const result = await runSessionAnalysis({
        manager,
        llmService: configured,
      });
      assert.strictEqual(result.llmUsed, true);
      assert.strictEqual(result.reportMarkdown, '# LLM 报告');
    } finally {
      db.close();
    }
  });

  it('falls back to the offline report when the LLM throws', async () => {
    const {manager, db} = fixture();
    try {
      const result = await runSessionAnalysis({
        manager,
        llmService: throwing,
      });
      assert.strictEqual(result.llmUsed, false);
      assert.ok(result.reportMarkdown.includes('# AI 分析报告'));
    } finally {
      db.close();
    }
  });

  it('rejects an unknown session id', async () => {
    const {manager, db} = fixture();
    try {
      await assert.rejects(
        () =>
          runSessionAnalysis({
            sessionId: 'nope',
            manager,
            llmService: notConfigured,
          }),
        /No session found with id: nope/,
      );
    } finally {
      db.close();
    }
  });

  it('accepts every analysis mode without throwing', async () => {
    const {manager, db} = fixture();
    const modes: AnalysisMode[] = [
      'auto',
      'api_reverse',
      'security',
      'perf',
      'js_crypto',
    ];
    try {
      for (const mode of modes) {
        const result = await runSessionAnalysis({
          mode,
          manager,
          llmService: notConfigured,
        });
        assert.strictEqual(result.mode, mode);
      }
    } finally {
      db.close();
    }
  });
});
