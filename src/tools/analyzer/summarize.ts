/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import type {CodeFile} from '../../types/index.js';
import {ToolCategory} from '../categories.js';
import {withOperationTimeout} from '../shared/browserRuntime.js';
import {defineTool} from '../ToolDefinition.js';

import type {SummarizeFileResult} from './types.js';

const SUMMARIZE_TIMEOUT_MS = 15_000;

const FUNCTION_NAME_REGEX = /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;

function buildEmptyFileSummary(code: string, url: string) {
  const lines = code.split('\n');
  const averageLineLength = code.length / Math.max(lines.length, 1);
  const complexity: 'low' | 'medium' | 'high' =
    averageLineLength > 100
      ? 'high'
      : averageLineLength > 50
        ? 'medium'
        : 'low';
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

function buildEmptyProjectSummary(files: Array<{size?: number}>) {
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

export const summarizeCode = defineTool({
  name: 'summarize_code',
  description: '对单个代码文件、多个文件或项目级上下文进行总结。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    mode: zod.enum(['single', 'batch', 'project']).default('single'),
    code: zod.string().optional(),
    url: zod.string().optional(),
    files: zod
      .array(
        zod.object({
          url: zod.string(),
          content: zod.string(),
          size: zod.number().int().nonnegative(),
          type: zod.enum([
            'inline',
            'external',
            'dynamic',
            'service-worker',
            'web-worker',
          ]),
        }),
      )
      .optional(),
  },
  handler: async (request, response) => {
    const runtime = getRuntime();
    const {mode, code, url, files} = request.params;
    const safeFiles = files ?? [];

    try {
      if (mode === 'project') {
        const data = await withOperationTimeout(
          runtime.summarizer.summarizeProject(safeFiles as any),
          'summarize project',
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
        const data = await withOperationTimeout(
          runtime.summarizer.summarizeBatch(safeFiles as any),
          'summarize batch',
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
      const data = await withOperationTimeout(
        runtime.summarizer.summarizeFile(file),
        'summarize file',
        SUMMARIZE_TIMEOUT_MS,
      );
      response.setStructuredContent<SummarizeFileResult>({
        success: true,
        message: 'File summarization completed',
        tooltype: 'summarize',
        logFormat: 'json',
        data,
      });
    } catch {
      let fallback;
      if (mode === 'project') {
        fallback = buildEmptyProjectSummary(safeFiles);
      } else if (mode === 'batch') {
        fallback = safeFiles.map(file =>
          buildEmptyFileSummary(file.content, file.url),
        );
      } else {
        fallback = buildEmptyFileSummary(code ?? '', url ?? 'inline-input.js');
      }

      response.setStructuredContent({
        success: true,
        message:
          'Summarization completed (fallback: AI unavailable or timed out)',
        tooltype: 'summarize',
        logFormat: 'json',
        data: fallback,
      });
    }
  },
});
