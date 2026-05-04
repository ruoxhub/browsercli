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

    if (request.params.mode === 'project') {
      const result = await runtime.summarizer.summarizeProject(request.params.files ?? []);
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify({
        success: true,
        message: 'Project summarization completed',
        tooltype: 'summarize',
        data: result,
      }, null, 2));
      response.appendResponseLine('```');
      return;
    }

    if (request.params.mode === 'batch') {
      const result = await runtime.summarizer.summarizeBatch(request.params.files ?? []);
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify({
        success: true,
        message: 'Batch summarization completed',
        tooltype: 'summarize',
        data: result,
      }, null, 2));
      response.appendResponseLine('```');
      return;
    }

    const file = {
      url: request.params.url ?? 'inline-input.js',
      content: request.params.code ?? '',
      size: (request.params.code ?? '').length,
      type: 'inline' as const,
    };
    const result = await runtime.summarizer.summarizeFile(file);
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify({
      success: true,
      message: 'File summarization completed',
      tooltype: 'summarize',
      data: result,
    }, null, 2));
    response.appendResponseLine('```');
  },
});