/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {PromptBuilder} from '../../../../../src/modules/analyzer/ai/PromptBuilder.js';
import type {
  AnalysisMode,
  CryptoSnippet,
  PurifiedRequest,
  SceneHint,
} from '../../../../../src/modules/analyzer/ai/types.js';

const MODES: AnalysisMode[] = [
  'auto',
  'api_reverse',
  'security',
  'perf',
  'js_crypto',
];

function createSceneHints(): SceneHint[] {
  return [
    {
      scene: 'auth-token',
      confidence: 'high',
      evidence: 'Found Bearer JWT Authorization header',
      matchedUrls: ['https://api.example.com/user/profile'],
    },
    {
      scene: 'signature-hash',
      confidence: 'medium',
      evidence: 'Detected signature / hash parameters: [sign, _ts]',
    },
  ];
}

function createPurifiedRequests(): PurifiedRequest[] {
  return [
    {
      sequence: 3,
      method: 'POST',
      url: 'https://api.example.com/v1/order/create',
      source: 'cdp',
      statusCode: 200,
      durationMs: 137,
      contentType: 'application/json',
      keyHeaders: {
        authorization: 'Bearer eyJhbGciOi',
        'x-sign': 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      },
      bodyPreview: '{"order":"T-1","sign":"a1b2c3"}',
      responsePreview: '{"code":0}',
      isStreaming: 0,
      isWebSocket: 0,
    },
    {
      sequence: 7,
      method: 'GET',
      url: 'https://api.example.com/v1/config',
      source: 'proxy',
      statusCode: 204,
      durationMs: 42,
      contentType: null,
      keyHeaders: {},
      bodyPreview: null,
      responsePreview: null,
      isStreaming: 0,
      isWebSocket: 0,
    },
  ];
}

function createCryptoSnippets(): CryptoSnippet[] {
  return [
    {
      functionName: 'generateSignature',
      hookType: 'crypto',
      file: 'https://cdn.example.com/app.5f3a.js',
      line: 1024,
      column: 12,
      sourceSnippet: 'function generateSignature(t){return md5(t+SECRET)}',
      argsPreview: '["T-1"]',
      resultPreview: '"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"',
    },
  ];
}

describe('PromptBuilder', () => {
  const builder = new PromptBuilder();

  describe('systemPrompt', () => {
    it('produces a distinct systemPrompt for each of the 5 modes', () => {
      const prompts = MODES.map(
        mode =>
          builder.buildPrompt({
            mode,
            sceneHints: [],
            purifiedRequests: [],
            cryptoSnippets: [],
          }).systemPrompt,
      );

      assert.strictEqual(new Set(prompts).size, MODES.length);
      prompts.forEach(prompt => assert.ok(prompt.length > 0));
    });

    it('mentions the mode key inside its systemPrompt', () => {
      MODES.forEach(mode => {
        const {systemPrompt} = builder.buildPrompt({
          mode,
          sceneHints: [],
          purifiedRequests: [],
          cryptoSnippets: [],
        });
        assert.ok(
          systemPrompt.includes(mode),
          `systemPrompt for ${mode} should mention the mode`,
        );
      });
    });

    it('defaults to auto mode when mode is omitted', () => {
      const defaulted = builder.buildPrompt({
        sceneHints: [],
        purifiedRequests: [],
        cryptoSnippets: [],
      });
      const explicit = builder.buildPrompt({
        mode: 'auto',
        sceneHints: [],
        purifiedRequests: [],
        cryptoSnippets: [],
      });

      assert.strictEqual(defaulted.systemPrompt, explicit.systemPrompt);
      assert.ok(defaulted.systemPrompt.includes('auto'));
    });
  });

  describe('userPrompt', () => {
    it('embeds request URLs, methods, key headers and body previews', () => {
      const {userPrompt} = builder.buildPrompt({
        mode: 'api_reverse',
        sceneHints: createSceneHints(),
        purifiedRequests: createPurifiedRequests(),
        cryptoSnippets: createCryptoSnippets(),
        targetUrl: 'https://example.com/app',
      });

      assert.ok(userPrompt.includes('https://api.example.com/v1/order/create'));
      assert.ok(userPrompt.includes('POST'));
      assert.ok(userPrompt.includes('x-sign'));
      assert.ok(userPrompt.includes('{"order":"T-1","sign":"a1b2c3"}'));
      assert.ok(userPrompt.includes('https://example.com/app'));
    });

    it('embeds scene hint evidence and confidence', () => {
      const {userPrompt} = builder.buildPrompt({
        mode: 'security',
        sceneHints: createSceneHints(),
        purifiedRequests: [],
        cryptoSnippets: [],
      });

      assert.ok(userPrompt.includes('auth-token'));
      assert.ok(userPrompt.includes('Found Bearer JWT Authorization header'));
      assert.ok(userPrompt.includes('high'));
      assert.ok(userPrompt.includes('signature-hash'));
    });

    it('embeds crypto snippet function names, files and lines', () => {
      const {userPrompt} = builder.buildPrompt({
        mode: 'js_crypto',
        sceneHints: [],
        purifiedRequests: [],
        cryptoSnippets: createCryptoSnippets(),
      });

      assert.ok(userPrompt.includes('generateSignature'));
      assert.ok(userPrompt.includes('https://cdn.example.com/app.5f3a.js'));
      assert.ok(userPrompt.includes('1024'));
    });
  });

  describe('fallbackReport', () => {
    it('includes all required sections with mode-specific suggestions', () => {
      const {fallbackReport} = builder.buildPrompt({
        mode: 'api_reverse',
        sceneHints: createSceneHints(),
        purifiedRequests: createPurifiedRequests(),
        cryptoSnippets: createCryptoSnippets(),
      });

      assert.ok(fallbackReport.includes('## 分析模式'));
      assert.ok(fallbackReport.includes('api_reverse'));
      assert.ok(fallbackReport.includes('## 场景推断'));
      assert.ok(fallbackReport.includes('auth-token'));
      assert.ok(fallbackReport.includes('high'));
      assert.ok(fallbackReport.includes('## 高价值请求'));
      assert.ok(fallbackReport.includes('| 3 | POST |'));
      assert.ok(fallbackReport.includes('204'));
      assert.ok(fallbackReport.includes('## 加密代码切片'));
      assert.ok(fallbackReport.includes('generateSignature'));
      assert.ok(fallbackReport.includes('## 建议'));
    });

    it('renders different suggestions per mode', () => {
      const reports = MODES.map(
        mode =>
          builder.buildPrompt({
            mode,
            sceneHints: createSceneHints(),
            purifiedRequests: createPurifiedRequests(),
            cryptoSnippets: createCryptoSnippets(),
          }).fallbackReport,
      );

      const suggestionSections = reports.map(report => {
        const idx = report.indexOf('## 建议');
        assert.ok(idx >= 0);
        return report.slice(idx);
      });
      assert.strictEqual(new Set(suggestionSections).size, MODES.length);
    });

    it('is deterministic across repeated builds', () => {
      const input = {
        mode: 'js_crypto' as const,
        sceneHints: createSceneHints(),
        purifiedRequests: createPurifiedRequests(),
        cryptoSnippets: createCryptoSnippets(),
        targetUrl: 'https://example.com/app',
      };

      assert.strictEqual(
        builder.buildPrompt(input).fallbackReport,
        builder.buildPrompt(input).fallbackReport,
      );
      assert.strictEqual(
        builder.buildPrompt(input).userPrompt,
        builder.buildPrompt(input).userPrompt,
      );
    });

    it('handles empty inputs without throwing', () => {
      const {fallbackReport} = builder.buildPrompt({
        sceneHints: [],
        purifiedRequests: [],
        cryptoSnippets: [],
      });

      assert.ok(fallbackReport.includes('## 分析模式'));
      assert.ok(fallbackReport.includes('## 高价值请求'));
    });
  });
});
