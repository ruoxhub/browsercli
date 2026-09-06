/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {
  classifyAIError,
  type AIFallbackReason,
} from '../../services/AIService.js';
import type {LLMService} from '../../services/LLMService.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {withOperationTimeout} from '../shared/browserRuntime.js';

export interface AnalysisExecutionMeta {
  analysisMode: 'ai' | 'local';
  fallbackReason?: 'not_configured' | 'unavailable' | 'timeout';
}

export interface ExecuteAnalysisOptions<TLocal, TAi = TLocal> {
  toolName: string;
  localAnalysis: () => Promise<TLocal> | TLocal;
  aiEnrichment?: (localResult: TLocal) => Promise<TAi>;
  useAI?: boolean;
  aiRequirement?: 'optional' | 'required';
  timeoutMs?: number;
  signal?: AbortSignal;
  llmService?: LLMService;
}

export interface AnalysisExecutionResult<T> {
  data: T;
  meta: AnalysisExecutionMeta;
}

export async function executeAnalysis<TLocal, TAi = TLocal>(
  options: ExecuteAnalysisOptions<TLocal, TAi>,
): Promise<AnalysisExecutionResult<TAi | TLocal>> {
  const llm = options.llmService ?? getRuntime()?.llmService;
  const isConfigured = llm ? llm.isConfigured() : false;

  if (options.aiRequirement === 'required' && !isConfigured) {
    throw createToolError(
      ErrorCodes.AI_REQUIRED,
      `Tool "${options.toolName}" requires AI provider configuration.`,
      {toolName: options.toolName},
      {
        retryable: true,
        recovery: {
          tool: 'config_set',
          command:
            'proxycli config set --key OPENAI_API_KEY --value <your_key>',
          reason:
            'Configure an AI provider (e.g. OPENAI_API_KEY) to use this tool.',
        },
      },
    );
  }

  const localResult = await options.localAnalysis();

  if (options.useAI === false || !options.aiEnrichment) {
    return {
      data: localResult,
      meta: {
        analysisMode: 'local',
      },
    };
  }

  if (!isConfigured) {
    return {
      data: localResult,
      meta: {
        analysisMode: 'local',
        fallbackReason: 'not_configured',
      },
    };
  }

  try {
    const aiPromise = options.aiEnrichment(localResult);
    const data =
      options.timeoutMs !== undefined && options.timeoutMs > 0
        ? await withOperationTimeout(
            aiPromise,
            `${options.toolName} AI enrichment`,
            options.timeoutMs,
          )
        : await aiPromise;

    return {
      data,
      meta: {
        analysisMode: 'ai',
      },
    };
  } catch (error) {
    const fallbackReason: AIFallbackReason = classifyAIError(error);
    return {
      data: localResult,
      meta: {
        analysisMode: 'local',
        fallbackReason,
      },
    };
  }
}
