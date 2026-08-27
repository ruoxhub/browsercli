/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DatabaseManager} from '../../../src/database/DatabaseManager.js';
import {CryptoScriptExtractor} from '../../../src/modules/analyzer/ai/CryptoScriptExtractor.js';
import {PromptBuilder} from '../../../src/modules/analyzer/ai/PromptBuilder.js';
import {SceneDetector} from '../../../src/modules/analyzer/ai/SceneDetector.js';
import {TrafficPurifier} from '../../../src/modules/analyzer/ai/TrafficPurifier.js';
import type {AnalysisMode} from '../../../src/modules/analyzer/ai/types.js';
import {CaptureEngine} from '../../../src/modules/session/CaptureEngine.js';
import {CaptureSessionManager} from '../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../src/modules/session/SqliteSessionStore.js';
import {setRuntime} from '../../../src/runtime.js';
import type {Runtime} from '../../../src/runtime.js';
import {sessionGenerateReport} from '../../../src/tools/session/session_generate_report.js';

function makeRuntime(): {manager: CaptureSessionManager; db: DatabaseManager} {
  const db = new DatabaseManager(':memory:');
  const store = new SqliteSessionStore(db);
  const manager = new CaptureSessionManager(store);
  return {manager, db};
}

const SCRIPT_SOURCE = [
  'function sign(payload, secret) {',
  '  // line 2 placeholder',
  '  // line 3 placeholder',
  '  // line 4 placeholder',
  '  // line 5 placeholder',
  '  // line 6 placeholder',
  '  // line 7 placeholder',
  '  // line 8 placeholder',
  '  // line 9 placeholder',
  '  // line 10 placeholder',
  '  return CryptoJS.HmacSHA256(payload, secret).toString();',
  '}',
].join('\n');

describe('session AI analysis pipeline (integration)', () => {
  it('runs the full analyze + report pipeline end to end', async () => {
    const {manager, db} = makeRuntime();
    try {
      const engine = new CaptureEngine(manager, new SqliteSessionStore(db));

      // 1. Create and activate a session
      const session = manager.createSession({
        name: 'integration',
        targetUrl: 'https://example.com',
      });
      assert.strictEqual(session.status, 'capturing');

      // 2. Ingest requests (with auth / signature / stream / noise)
      engine.ingestRequest({
        timestamp: 1,
        method: 'POST',
        url: 'https://api.example.com/v1/login',
        source: 'cdp',
        requestHeaders: JSON.stringify({
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
        }),
        requestBody: '{"username":"u","password":"p"}',
        statusCode: 200,
        responseHeaders: null,
        responseBody: '{"ok":true}',
        contentType: 'application/json',
        initiator: null,
        durationMs: 80,
        isStreaming: 0,
        isWebSocket: 0,
        truncated: 0,
      });
      engine.ingestRequest({
        timestamp: 2,
        method: 'GET',
        url: 'https://api.example.com/v1/data?sign=abcdef0123456789abcdef0123456789abcdef01&timestamp=1700000000&nonce=abc',
        source: 'proxy',
        requestHeaders: '{}',
        requestBody: null,
        statusCode: 200,
        responseHeaders: null,
        responseBody: '{"data":[]}',
        contentType: 'application/json',
        initiator: null,
        durationMs: 30,
        isStreaming: 0,
        isWebSocket: 0,
        truncated: 0,
      });
      engine.ingestRequest({
        timestamp: 3,
        method: 'POST',
        url: 'https://api.example.com/v1/chat/completions',
        source: 'cdp',
        requestHeaders: '{}',
        requestBody: '{"messages":[]}',
        statusCode: 200,
        responseHeaders: null,
        responseBody: null,
        contentType: 'text/event-stream',
        initiator: null,
        durationMs: 100,
        isStreaming: 1,
        isWebSocket: 0,
        truncated: 0,
      });
      engine.ingestRequest({
        timestamp: 4,
        method: 'GET',
        url: 'https://example.com/static/logo.png',
        source: 'cdp',
        requestHeaders: '{}',
        requestBody: null,
        statusCode: 200,
        responseHeaders: null,
        responseBody: null,
        contentType: 'image/png',
        initiator: null,
        durationMs: 10,
        isStreaming: 0,
        isWebSocket: 0,
        truncated: 0,
      });

      // 3. Ingest a crypto hook + snapshot
      engine.ingestHook({
        timestamp: 5,
        hookType: 'crypto',
        functionName: 'CryptoJS.HmacSHA256',
        arguments: '["payload","secret"]',
        result: '"abcdef"',
        callStack: `Error\n    at sign (https://example.com/app.js:1:15)\n    at <anonymous>:1:1`,
      });
      engine.ingestSnapshot({
        timestamp: 6,
        kind: 'local',
        origin: 'https://example.com',
        key: 'token',
        value: 'MASKED',
      });

      const requests = manager.getRequests(session.id);
      const hooks = manager.getHooks(session.id);

      // 4. SceneDetector
      const sceneHints = new SceneDetector().detect(requests, hooks);
      const scenes = sceneHints.map(h => h.scene);
      assert.ok(scenes.includes('auth-token'), 'auth-token scene detected');
      assert.ok(scenes.includes('signature-hash'), 'signature scene detected');
      assert.ok(scenes.includes('ai-sse'), 'ai-sse scene detected');
      assert.ok(scenes.includes('crypto-cipher'), 'crypto scene detected');

      // 5. TrafficPurifier filters noise, keeps key requests
      const purified = new TrafficPurifier().purify(requests);
      const purifiedUrls = purified.map(r => r.url);
      assert.ok(!purifiedUrls.some(u => u.includes('logo.png')));
      assert.ok(purifiedUrls.some(u => u.includes('/v1/login')));
      const loginRequest = purified.find(r => r.url.includes('/v1/login'));
      assert.ok(loginRequest);
      assert.ok(loginRequest.keyHeaders['Authorization']);

      // 6. CryptoScriptExtractor slices from the scriptGetter
      const extractor = new CryptoScriptExtractor();
      const snippets = extractor.extractSnippets(hooks, url =>
        url === 'https://example.com/app.js' ? SCRIPT_SOURCE : null,
      );
      assert.strictEqual(snippets.length, 1);
      assert.strictEqual(snippets[0].functionName, 'sign');
      assert.strictEqual(snippets[0].line, 1);
      assert.ok(snippets[0].sourceSnippet.includes('function sign'));

      // 7. PromptBuilder produces distinct prompts + offline fallback
      const builder = new PromptBuilder();
      const seen = new Set<string>();
      const modes: AnalysisMode[] = [
        'auto',
        'api_reverse',
        'security',
        'perf',
        'js_crypto',
      ];
      for (const mode of modes) {
        const built = builder.buildPrompt({
          mode,
          sceneHints,
          purifiedRequests: purified,
          cryptoSnippets: snippets,
          targetUrl: session.targetUrl,
        });
        seen.add(built.systemPrompt);
        assert.ok(built.fallbackReport.includes('# AI 分析报告'));
        assert.ok(built.fallbackReport.includes('## 场景推断'));
        assert.ok(built.fallbackReport.includes('## 高价值请求'));
      }
      assert.strictEqual(seen.size, 5, '5 distinct system prompts');

      // 8. session_generate_report handler persists to ai_reports (LLM-free)
      setRuntime({
        captureSessionManager: manager,
        llmService: {isConfigured: () => false},
        collector: {
          getFileByUrl: (url: string) =>
            url === 'https://example.com/app.js'
              ? {content: SCRIPT_SOURCE}
              : null,
        },
      } as unknown as Runtime);
      try {
        let captured: unknown;
        const res = {
          setStructuredContent: (c: unknown) => {
            captured = c;
          },
        };
        await sessionGenerateReport.handler(
          {params: {sessionId: session.id, mode: 'api_reverse'}} as never,
          res as never,
          {} as never,
        );
        const content = captured as {
          reportId: string;
          llmUsed: boolean;
          reportMarkdown: string;
        };
        assert.ok(content.reportId);
        assert.strictEqual(content.llmUsed, false);
        assert.ok(content.reportMarkdown.includes('# AI 分析报告'));

        const reports = manager.getReports(session.id);
        assert.strictEqual(reports.length, 1);
        assert.strictEqual(reports[0].id, content.reportId);
        assert.strictEqual(reports[0].mode, 'api_reverse');
      } finally {
        setRuntime(undefined);
      }
    } finally {
      db.close();
    }
  });
});
