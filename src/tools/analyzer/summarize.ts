/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import type {CodeFile} from '../../types/index.js';
import type {CodeSummary} from '../../modules/analyzer/AISummarizer.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import type {
  SummarizeFileResult,
  SummarizeBatchResult,
  SummarizeProjectResult,
  SummarizeProjectData,
} from './types.js';

const SUMMARIZE_TIMEOUT_MS = 15_000;

const FUNCTION_NAME_REGEX = /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Summarization timed out')), ms),
    ),
  ]);
}

function buildEmptyFileSummary(code: string, url: string): CodeSummary {
  const lines = code.split('\n');
  const averageLineLength = code.length / Math.max(lines.length, 1);
  const complexity: 'low' | 'medium' | 'high' =
    averageLineLength > 100 ? 'high' : averageLineLength > 50 ? 'medium' : 'low';
  const keyFunctions = [...code.matchAll(FUNCTION_NAME_REGEX)]
    .map(match => match[1])
    .slice(0, 10);
  return {
    url,
    type: 'inline',
    size: code.length,
    summary: 'Basic analysis (AI unavailable or timed out)',
    purpose: 'Unknown',
    keyFunctions,
    dependencies: [],
    hasEncryption: /encrypt|decrypt|crypto|cipher|aes|rsa/i.test(code),
    hasAPI: /fetch|xhr|ajax|axios|request/i.test(code),
    hasObfuscation: /eval\(|\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/i.test(code),
    complexity,
    linesOfCode: lines.length,
  };
}

function buildEmptyProjectSummary(files: Array<{size?: number}>): SummarizeProjectData {
  return {
    totalFiles: files.length,
    totalSize: files.reduce((sum, file) => sum + (file.size ?? 0), 0),
    mainPurpose: 'Analysis timed out or failed',
    architecture: 'Unknown',
    technologies: [],
    securityConcerns: [],
    recommendations: [],
  };
}

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
    const {mode, code, url, files} = request.params;
    const safeFiles = files ?? [];

    try {
      if (mode === 'project') {
        const data = await withTimeout(
          runtime.summarizer.summarizeProject(safeFiles as any),
          SUMMARIZE_TIMEOUT_MS,
        );
        response.setStructuredContent({
          success: true,
          message: 'Project summarization completed',
          tooltype: 'summarize',
          data,
        });
        return;
      }

      if (mode === 'batch') {
        const data = await withTimeout(
          runtime.summarizer.summarizeBatch(safeFiles as any),
          SUMMARIZE_TIMEOUT_MS,
        );
        response.setStructuredContent({
          success: true,
          message: 'Batch summarization completed',
          tooltype: 'summarize',
          logFormat: 'json',
          data,
        });
        return;
      }

      const file: CodeFile = {
        url: url ?? 'inline-input.js',
        content: code ?? '',
        size: (code ?? '').length,
        type: 'inline',
      };
      const data = await withTimeout(
        runtime.summarizer.summarizeFile(file),
        SUMMARIZE_TIMEOUT_MS,
      );
      response.setStructuredContent<SummarizeFileResult>({
        success: true,
        message: 'File summarization completed',
        tooltype: 'summarize',
        logFormat: 'json',
        data,
      });
    } catch (error) {
      // Fallback to basic analysis on timeout or LLM failure.
      const fallback =
        mode === 'project'
          ? buildEmptyProjectSummary(safeFiles)
          : mode === 'batch'
            ? safeFiles.map(file => buildEmptyFileSummary(file.content, file.url))
            : buildEmptyFileSummary(code ?? '', url ?? 'inline-input.js');

      response.setStructuredContent({
        success: true,
        message: 'Summarization completed (fallback: AI unavailable or timed out)',
        tooltype: 'summarize',
        logFormat: 'json',
        data: fallback,
      });

      // Touch the error to keep types honest in the no-unused-vars sense
      // (we surface the failure via the fallback message above).
      void error;
    }
  },
});
