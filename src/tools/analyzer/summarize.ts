/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import type {CodeFile} from '../../types/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import {executeAnalysis} from './analysisExecution.js';

const SUMMARIZE_TIMEOUT_MS = 15_000;

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
    const safeFiles = (files ?? []) as CodeFile[];

    if (mode === 'project') {
      const result = await executeAnalysis({
        toolName: 'summarize_code',
        timeoutMs: SUMMARIZE_TIMEOUT_MS,
        localAnalysis: () => runtime.summarizer.basicProjectSummary(safeFiles),
        aiEnrichment: () => runtime.summarizer.summarizeProject(safeFiles),
      });

      response.setStructuredContent({
        success: true,
        message: 'Project summarization completed',
        tooltype: 'summarize',
        meta: result.meta,
        data: result.data,
      });
      return;
    }

    if (mode === 'batch') {
      const result = await executeAnalysis({
        toolName: 'summarize_code',
        timeoutMs: SUMMARIZE_TIMEOUT_MS,
        localAnalysis: () =>
          safeFiles.map(file => runtime.summarizer.basicAnalysis(file)),
        aiEnrichment: () => runtime.summarizer.summarizeBatch(safeFiles),
      });

      response.setStructuredContent({
        success: true,
        message: 'Batch summarization completed',
        tooltype: 'summarize',
        logFormat: 'json',
        meta: result.meta,
        data: result.data,
      });
      return;
    }

    const file: CodeFile = {
      url: url ?? 'inline-input.js',
      content: code ?? '',
      size: (code ?? '').length,
      type: 'inline',
    };

    const result = await executeAnalysis({
      toolName: 'summarize_code',
      timeoutMs: SUMMARIZE_TIMEOUT_MS,
      localAnalysis: () => runtime.summarizer.basicAnalysis(file),
      aiEnrichment: () => runtime.summarizer.summarizeFile(file),
    });

    response.setStructuredContent({
      success: true,
      message: 'File summarization completed',
      tooltype: 'summarize',
      logFormat: 'json',
      meta: result.meta,
      data: result.data,
    });
  },
});
