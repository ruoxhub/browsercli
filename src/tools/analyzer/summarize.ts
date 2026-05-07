/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {getRuntime} from '../../runtime.js';
import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';
import type {CodeFile} from '../../types/index.js';

import type {
  SummarizeFileResult,
  SummarizeBatchResult,
  SummarizeProjectResult,
} from './types.js';

export async function summarizeFile(
  file: CodeFile,
): Promise<SummarizeFileResult> {
  try {
    const data = await getRuntime().summarizer.summarizeFile(file);
    return {
      success: true,
      message: 'File summarization completed',
      tooltype: 'summarize',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `File summarization failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'summarize',
      data: {} as SummarizeFileResult['data'],
    };
  }
}

export async function summarizeBatch(
  files: CodeFile[],
  maxConcurrent?: number,
): Promise<SummarizeBatchResult> {
  try {
    const data = await getRuntime().summarizer.summarizeBatch(files, maxConcurrent);
    return {
      success: true,
      message: 'Batch summarization completed',
      tooltype: 'summarize',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `Batch summarization failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'summarize',
      data: [],
    };
  }
}

export async function summarizeProject(
  files: CodeFile[],
): Promise<SummarizeProjectResult> {
  try {
    const data = await getRuntime().summarizer.summarizeProject(files);
    return {
      success: true,
      message: 'Project summarization completed',
      tooltype: 'summarize',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `Project summarization failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'summarize',
      data: {} as SummarizeProjectResult['data'],
    };
  }
}

export const summarizeCode = defineTool({
  name: 'summarize_code',
  description: 'Summarize one code file, multiple files, or project-level context.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    mode: zod.enum(['single', 'batch', 'project']).default('single'),
    code: zod.string().optional(),
    url: zod.string().optional(),
    files: zod.array(zod.object({
      url: zod.string(),
      content: zod.string(),
      size: zod.number().int().nonnegative(),
      type: zod.enum(['inline', 'external', 'dynamic', 'service-worker', 'web-worker']),
    })).optional(),
  },
  handler: async (request, response) => {
    const runtime = getRuntime();
    const SUMMARIZE_TIMEOUT_MS = 15_000;

    function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error('Summarization timed out')), ms),
        ),
      ]);
    }

    function basicFileSummary(code: string, url: string) {
      const lines = code.split('\n');
      const hasEncryption = /encrypt|decrypt|crypto|cipher|aes|rsa/i.test(code);
      const hasAPI = /fetch|xhr|ajax|axios|request/i.test(code);
      const hasObfuscation = /eval\(|\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/i.test(code);
      const fnMatches = [...code.matchAll(/function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g)];
      const keyFunctions = fnMatches.map(m => m[1]).slice(0, 10);
      return {
        url,
        type: 'inline',
        size: code.length,
        summary: 'Basic analysis (AI unavailable or timed out)',
        purpose: 'Unknown',
        keyFunctions,
        dependencies: [] as string[],
        hasEncryption,
        hasAPI,
        hasObfuscation,
        complexity: (code.length / lines.length > 100 ? 'high' : code.length / lines.length > 50 ? 'medium' : 'low') as 'low' | 'medium' | 'high',
        linesOfCode: lines.length,
      };
    }

    try {
      if (request.params.mode === 'project') {
        const result = await withTimeout(
          runtime.summarizer.summarizeProject(request.params.files ?? []),
          SUMMARIZE_TIMEOUT_MS,
        );
        response.setStructuredContent({
        success: true,
        message: 'Project summarization completed',
        tooltype: 'summarize',
        logFormat: 'json',
        data: result,
      });
        return;
      }

      if (request.params.mode === 'batch') {
        const result = await withTimeout(
          runtime.summarizer.summarizeBatch(request.params.files ?? []),
          SUMMARIZE_TIMEOUT_MS,
        );
        response.setStructuredContent({
        success: true,
        message: 'Batch summarization completed',
        tooltype: 'summarize',
        logFormat: 'json',
        data: result,
      });
        return;
      }

      const file = {
        url: request.params.url ?? 'inline-input.js',
        content: request.params.code ?? '',
        size: (request.params.code ?? '').length,
        type: 'inline' as const,
      };
      const result = await withTimeout(
        runtime.summarizer.summarizeFile(file),
        SUMMARIZE_TIMEOUT_MS,
      );
      response.setStructuredContent({
        success: true,
        message: 'File summarization completed',
        tooltype: 'summarize',
        logFormat: 'json',
        data: result,
      });
    } catch (error) {
      // Fallback to basic analysis on timeout or LLM failure
      const code = request.params.code ?? '';
      const url = request.params.url ?? 'inline-input.js';
      const fallback = request.params.mode === 'project'
        ? {
            totalFiles: (request.params.files ?? []).length,
            totalSize: (request.params.files ?? []).reduce((s, f) => s + f.size, 0),
            mainPurpose: 'Analysis timed out or failed',
            architecture: 'Unknown',
            technologies: [] as string[],
            securityConcerns: [] as string[],
            recommendations: [] as string[],
          }
        : request.params.mode === 'batch'
          ? (request.params.files ?? []).map(f => basicFileSummary(f.content, f.url))
          : basicFileSummary(code, url);

      response.setStructuredContent({
        success: true,
        message: 'Summarization completed (fallback: AI unavailable or timed out)',
        tooltype: 'summarize',
        logFormat: 'json',
        data: fallback,
      });
    }
  },
});