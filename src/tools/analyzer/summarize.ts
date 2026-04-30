/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CodeFile} from '../../types/index.js';

import type {
  AnalyzerRuntimeServices,
  SummarizeFileResult,
  SummarizeBatchResult,
  SummarizeProjectResult,
} from './types.js';

export async function summarizeFile(
  runtime: AnalyzerRuntimeServices,
  file: CodeFile,
): Promise<SummarizeFileResult> {
  try {
    const data = await runtime.summarizer.summarizeFile(file);
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
  runtime: AnalyzerRuntimeServices,
  files: CodeFile[],
  maxConcurrent?: number,
): Promise<SummarizeBatchResult> {
  try {
    const data = await runtime.summarizer.summarizeBatch(files, maxConcurrent);
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
  runtime: AnalyzerRuntimeServices,
  files: CodeFile[],
): Promise<SummarizeProjectResult> {
  try {
    const data = await runtime.summarizer.summarizeProject(files);
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

export async function summarizeCode(
  runtime: AnalyzerRuntimeServices,
  params: {
    mode?: 'single' | 'batch' | 'project';
    code?: string;
    url?: string;
    files?: CodeFile[];
  },
): Promise<SummarizeFileResult | SummarizeBatchResult | SummarizeProjectResult> {
  const mode = params.mode ?? 'single';

  if (mode === 'project') {
    return summarizeProject(runtime, params.files ?? []);
  }

  if (mode === 'batch') {
    return summarizeBatch(runtime, params.files ?? []);
  }

  const file: CodeFile = {
    url: params.url ?? 'inline-input.js',
    content: params.code ?? '',
    size: (params.code ?? '').length,
    type: 'inline',
  };
  return summarizeFile(runtime, file);
}