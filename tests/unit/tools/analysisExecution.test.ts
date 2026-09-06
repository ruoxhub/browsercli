/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {LLMService} from '../../../src/services/LLMService.js';
import {executeAnalysis} from '../../../src/tools/analyzer/analysisExecution.js';
import {ToolError, ErrorCodes} from '../../../src/utils/errors.js';

function createMockLLMService(configured = true): LLMService {
  return {
    isConfigured: () => configured,
    getAvailability: () =>
      configured
        ? {available: true}
        : {available: false, reason: 'not_configured'},
    chat: async () => ({content: 'mock response'}),
    generateCodeAnalysisPrompt: () => [],
    generateCryptoDetectionPrompt: () => [],
    generateDeobfuscationPrompt: () => [],
    generateTaintAnalysisPrompt: () => [],
  } as unknown as LLMService;
}

describe('analysisExecution coordinator', () => {
  it('returns local result with analysisMode local when useAI is false', async () => {
    let localCalled = false;
    let aiCalled = false;

    const result = await executeAnalysis({
      toolName: 'test_tool',
      useAI: false,
      llmService: createMockLLMService(true),
      localAnalysis: () => {
        localCalled = true;
        return {score: 42};
      },
      aiEnrichment: async () => {
        aiCalled = true;
        return {score: 99};
      },
    });

    assert.strictEqual(localCalled, true);
    assert.strictEqual(aiCalled, false);
    assert.deepStrictEqual(result.data, {score: 42});
    assert.strictEqual(result.meta.analysisMode, 'local');
    assert.strictEqual(result.meta.fallbackReason, undefined);
  });

  it('returns local result with fallbackReason not_configured when AI is unconfigured', async () => {
    let localCalled = false;
    let aiCalled = false;

    const result = await executeAnalysis({
      toolName: 'test_tool',
      useAI: true,
      llmService: createMockLLMService(false),
      localAnalysis: () => {
        localCalled = true;
        return {data: 'local'};
      },
      aiEnrichment: async () => {
        aiCalled = true;
        return {data: 'ai'};
      },
    });

    assert.strictEqual(localCalled, true);
    assert.strictEqual(aiCalled, false);
    assert.deepStrictEqual(result.data, {data: 'local'});
    assert.strictEqual(result.meta.analysisMode, 'local');
    assert.strictEqual(result.meta.fallbackReason, 'not_configured');
  });

  it('returns enriched AI result with analysisMode ai when AI succeeds', async () => {
    const result = await executeAnalysis({
      toolName: 'test_tool',
      useAI: true,
      llmService: createMockLLMService(true),
      localAnalysis: () => ({base: 'local'}),
      aiEnrichment: async local => ({
        base: local.base,
        enriched: true,
      }),
    });

    assert.deepStrictEqual(result.data, {base: 'local', enriched: true});
    assert.strictEqual(result.meta.analysisMode, 'ai');
    assert.strictEqual(result.meta.fallbackReason, undefined);
  });

  it('falls back to local result with fallbackReason timeout when AI times out', async () => {
    const result = await executeAnalysis({
      toolName: 'test_tool',
      useAI: true,
      llmService: createMockLLMService(true),
      timeoutMs: 50,
      localAnalysis: () => ({status: 'local-ok'}),
      aiEnrichment: async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return {status: 'ai-ok'};
      },
    });

    assert.deepStrictEqual(result.data, {status: 'local-ok'});
    assert.strictEqual(result.meta.analysisMode, 'local');
    assert.strictEqual(result.meta.fallbackReason, 'timeout');
  });

  it('falls back to local result with fallbackReason unavailable when AI fails with network error', async () => {
    const result = await executeAnalysis({
      toolName: 'test_tool',
      useAI: true,
      llmService: createMockLLMService(true),
      localAnalysis: () => ({status: 'local-ok'}),
      aiEnrichment: async () => {
        throw new Error('ECONNREFUSED connect error');
      },
    });

    assert.deepStrictEqual(result.data, {status: 'local-ok'});
    assert.strictEqual(result.meta.analysisMode, 'local');
    assert.strictEqual(result.meta.fallbackReason, 'unavailable');
  });

  it('never hides local analysis exceptions', async () => {
    await assert.rejects(
      async () => {
        await executeAnalysis({
          toolName: 'test_tool',
          localAnalysis: () => {
            throw new Error('Critical local syntax failure');
          },
          aiEnrichment: async () => ({ok: true}),
        });
      },
      {
        message: /Critical local syntax failure/,
      },
    );
  });

  it('throws ToolError AI_REQUIRED with recovery command when aiRequirement is required and AI is unconfigured', async () => {
    await assert.rejects(
      async () => {
        await executeAnalysis({
          toolName: 'strict_ai_tool',
          aiRequirement: 'required',
          llmService: createMockLLMService(false),
          localAnalysis: () => ({}),
        });
      },
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.strictEqual(error.code, ErrorCodes.AI_REQUIRED);
        assert.ok(error.recovery?.command?.includes('proxycli config set'));
        return true;
      },
    );
  });
});
