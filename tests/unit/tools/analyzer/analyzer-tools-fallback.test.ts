/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';

import {setRuntime} from '../../../../src/runtime.js';
import type {LLMService} from '../../../../src/services/LLMService.js';
import {
  understandCode,
  summarizeCode,
  analyze_target,
  riskPanel,
} from '../../../../src/tools/analyzer/index.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

function createMockUnconfiguredLLM(): LLMService {
  return {
    isConfigured: () => false,
    getAvailability: () => ({
      available: false,
      reason: 'not_configured',
    }),
    chat: async () => {
      throw new Error('No AI provider configured');
    },
    generateCodeAnalysisPrompt: () => [],
    generateCryptoDetectionPrompt: () => [],
    generateDeobfuscationPrompt: () => [],
    generateTaintAnalysisPrompt: () => [],
  } as unknown as LLMService;
}

afterEach(() => setRuntime(undefined));

describe('Analyzer tools local fallback with unconfigured AI', () => {
  it('understand_code returns local analysis within 2s with analysisMode local and fallbackReason not_configured', async () => {
    const unconfiguredLLM = createMockUnconfiguredLLM();
    setRuntime({
      llmService: unconfiguredLLM,
      analyzer: {
        understand: async (input: {
          code: string;
          focus?: string;
          useAI?: boolean;
        }) => {
          if (input.useAI) {
            throw new Error('No AI provider configured');
          }
          return {
            structure: {
              functions: [],
              classes: [],
              modules: [],
              callGraph: {nodes: [], edges: []},
            },
            techStack: {other: []},
            businessLogic: {
              mainFeatures: [],
              entities: [],
              rules: [],
              dataModel: {},
            },
            dataFlow: {
              graph: {nodes: [], edges: []},
              sources: [],
              sinks: [],
              taintPaths: [],
            },
            securityRisks: [],
            qualityScore: 85,
          };
        },
      },
    } as never);

    const response = new ToolResponseAccumulator();
    const start = Date.now();

    await understandCode.handler(
      {
        params: {
          code: 'function test() { return 1; }',
          focus: 'all',
        },
      },
      response,
      {} as never,
    );

    const elapsed = Date.now() - start;
    assert.ok(
      elapsed < 2000,
      `Execution should be under 2s, took ${elapsed}ms`,
    );

    const json = response.toJSON();
    const structured = json.structuredContent as {
      success: boolean;
      meta?: {analysisMode: string; fallbackReason?: string};
      data?: {qualityScore?: number};
    };

    assert.equal(structured.success, true);
    assert.ok(structured.meta);
    assert.equal(structured.meta.analysisMode, 'local');
    assert.equal(structured.meta.fallbackReason, 'not_configured');
    assert.equal(structured.data?.qualityScore, 85);
  });

  it('summarize_code (single) returns local summary with analysisMode local and fallbackReason not_configured', async () => {
    const unconfiguredLLM = createMockUnconfiguredLLM();
    setRuntime({
      llmService: unconfiguredLLM,
      summarizer: {
        basicAnalysis: (file: {url: string; content: string}) => ({
          url: file.url,
          type: 'inline',
          size: file.content.length,
          summary: 'Basic analysis (AI unavailable)',
          purpose: 'Unknown',
          keyFunctions: ['calc'],
          dependencies: [],
          hasEncryption: false,
          hasAPI: false,
          hasObfuscation: false,
          complexity: 'low',
          linesOfCode: 1,
        }),
        summarizeFile: async () => {
          throw new Error('No AI provider configured');
        },
      },
    } as never);

    const response = new ToolResponseAccumulator();
    const start = Date.now();

    await summarizeCode.handler(
      {
        params: {
          mode: 'single',
          code: 'function calc() { return 42; }',
        },
      },
      response,
      {} as never,
    );

    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000);

    const json = response.toJSON();
    const structured = json.structuredContent as {
      success: boolean;
      meta?: {analysisMode: string; fallbackReason?: string};
      data?: {keyFunctions?: string[]};
    };

    assert.equal(structured.success, true);
    assert.ok(structured.meta);
    assert.equal(structured.meta.analysisMode, 'local');
    assert.equal(structured.meta.fallbackReason, 'not_configured');
    assert.deepEqual(structured.data?.keyFunctions, ['calc']);
  });

  it('summarize_code (batch) returns local batch summary with analysisMode local', async () => {
    const unconfiguredLLM = createMockUnconfiguredLLM();
    setRuntime({
      llmService: unconfiguredLLM,
      summarizer: {
        basicAnalysis: (file: {url: string; content: string}) => ({
          url: file.url,
          type: 'external',
          size: file.content.length,
          summary: 'Basic',
          purpose: 'Unknown',
          keyFunctions: [],
          dependencies: [],
          hasEncryption: false,
          hasAPI: false,
          hasObfuscation: false,
          complexity: 'low',
          linesOfCode: 1,
        }),
        summarizeBatch: async () => {
          throw new Error('No AI provider configured');
        },
      },
    } as never);

    const response = new ToolResponseAccumulator();
    await summarizeCode.handler(
      {
        params: {
          mode: 'batch',
          files: [
            {url: 'a.js', content: 'const a = 1;', size: 12, type: 'external'},
          ],
        },
      },
      response,
      {} as never,
    );

    const structured = response.toJSON().structuredContent as {
      success: boolean;
      meta?: {analysisMode: string; fallbackReason?: string};
      data?: Array<{url: string}>;
    };

    assert.equal(structured.success, true);
    assert.equal(structured.meta?.analysisMode, 'local');
    assert.equal(structured.meta?.fallbackReason, 'not_configured');
    assert.equal(structured.data?.length, 1);
  });

  it('summarize_code (project) returns local project summary with analysisMode local', async () => {
    const unconfiguredLLM = createMockUnconfiguredLLM();
    setRuntime({
      llmService: unconfiguredLLM,
      summarizer: {
        basicProjectSummary: (files: Array<{size?: number}>) => ({
          totalFiles: files.length,
          totalSize: files.reduce((sum, f) => sum + (f.size ?? 0), 0),
          mainPurpose: 'Basic project analysis',
          architecture: 'Unknown',
          technologies: [],
          securityConcerns: [],
          recommendations: [],
        }),
        summarizeProject: async () => {
          throw new Error('No AI provider configured');
        },
      },
    } as never);

    const response = new ToolResponseAccumulator();
    await summarizeCode.handler(
      {
        params: {
          mode: 'project',
          files: [{url: 'app.js', content: 'app', size: 3, type: 'external'}],
        },
      },
      response,
      {} as never,
    );

    const structured = response.toJSON().structuredContent as {
      success: boolean;
      meta?: {analysisMode: string; fallbackReason?: string};
      data?: {totalFiles: number};
    };

    assert.equal(structured.success, true);
    assert.equal(structured.meta?.analysisMode, 'local');
    assert.equal(structured.meta?.fallbackReason, 'not_configured');
    assert.equal(structured.data?.totalFiles, 1);
  });

  it('analyze_target returns valid analysis with analysisMode local and fallbackReason not_configured', async () => {
    const unconfiguredLLM = createMockUnconfiguredLLM();
    setRuntime({
      llmService: unconfiguredLLM,
      collector: {
        collect: async () => ({
          files: [
            {
              url: 'https://example.com/main.js',
              content: 'function sign(){}',
              size: 20,
              type: 'external',
            },
          ],
          dependencies: {nodes: [], edges: []},
          totalSize: 20,
          collectTime: 1,
        }),
        getTopPriorityFiles: () => ({
          files: [
            {
              url: 'https://example.com/main.js',
              content: 'function sign(){}',
              size: 20,
              type: 'external',
            },
          ],
          totalSize: 20,
          totalFiles: 1,
        }),
      },
      cryptoDetector: {
        detect: async () => ({algorithms: [], libraries: [], confidence: 0.9}),
      },
      analyzer: {
        understand: async (opts: {useAI?: boolean}) => {
          if (opts.useAI) {
            throw new Error('No AI provider configured');
          }
          return {qualityScore: 90, securityRisks: []};
        },
      },
      hookManager: {
        create: ({type}: {type: string}) => ({hookId: `h-${type}`, script: ''}),
        getRecords: () => [],
      },
      pageController: {
        injectScript: async () => undefined,
        replayActions: async () => [],
      },
    } as never);

    const response = new ToolResponseAccumulator();
    const start = Date.now();

    await analyze_target.handler(
      {
        params: {
          url: 'https://example.com',
          hookPreset: 'none',
          autoInjectHooks: false,
        },
      },
      response,
      {} as never,
    );

    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000);

    const structured = response.toJSON().structuredContent as {
      success: boolean;
      meta?: {analysisMode: string; fallbackReason?: string};
      data?: {target: string; analysis?: {qualityScore: number}};
    };

    assert.equal(structured.success, true);
    assert.ok(structured.meta);
    assert.equal(structured.meta.analysisMode, 'local');
    assert.equal(structured.meta.fallbackReason, 'not_configured');
    assert.equal(structured.data?.target, 'https://example.com');
    assert.equal(structured.data?.analysis?.qualityScore, 90);
  });

  it('risk_panel returns score with analysisMode local and fallbackReason not_configured', async () => {
    const unconfiguredLLM = createMockUnconfiguredLLM();
    setRuntime({
      llmService: unconfiguredLLM,
      analyzer: {
        understand: async (opts: {useAI?: boolean}) => {
          if (opts.useAI) {
            throw new Error('No AI provider configured');
          }
          return {
            securityRisks: [{severity: 'high', description: 'XSS pattern'}],
          };
        },
      },
      cryptoDetector: {
        detect: async () => ({
          algorithms: [{name: 'md5'}],
          securityIssues: [{issue: 'weak_hash'}],
        }),
      },
      hookManager: {
        getAllKnownHookIds: () => [],
        getRecords: () => [],
      },
    } as never);

    const response = new ToolResponseAccumulator();
    const start = Date.now();

    await riskPanel.handler(
      {
        params: {
          code: 'const a = md5("test");',
          includeHookSignals: false,
        },
      },
      response,
      {} as never,
    );

    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000);

    const structured = response.toJSON().structuredContent as {
      success: boolean;
      meta?: {analysisMode: string; fallbackReason?: string};
      data?: {score: number; level: string};
    };

    assert.equal(structured.success, true);
    assert.ok(structured.meta);
    assert.equal(structured.meta.analysisMode, 'local');
    assert.equal(structured.meta.fallbackReason, 'not_configured');
    assert.ok((structured.data?.score ?? 0) > 0);
  });
});
