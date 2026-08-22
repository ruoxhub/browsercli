/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {createAIService} from '../config.js';

import {
  AIServiceError,
  type AIAvailability,
  type AIMessage,
  type AIResponse,
  type ChatOptions,
} from './AIService.js';

export interface LLMChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  totalBudgetMs?: number;
  model?: string;
}

export class LLMService {
  constructor(
    private readonly serviceFactory: typeof createAIService = createAIService,
  ) {}

  isConfigured(): boolean {
    try {
      const service = this.serviceFactory();
      return service ? service.isAvailable() : false;
    } catch {
      return false;
    }
  }

  getAvailability(): AIAvailability {
    try {
      const service = this.serviceFactory();
      return service
        ? service.getAvailability()
        : {available: false, reason: 'not_configured'};
    } catch {
      return {available: false, reason: 'not_configured'};
    }
  }

  async chat(
    messages: AIMessage[],
    options?: LLMChatOptions,
  ): Promise<AIResponse> {
    const service = this.serviceFactory();
    if (!service || !service.isAvailable()) {
      throw new AIServiceError(
        'not_configured',
        'No AI provider configured. Set OPENAI_API_KEY environment variable.',
      );
    }

    const chatOptions: ChatOptions = {
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      model: options?.model,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
      totalBudgetMs: options?.totalBudgetMs,
    };

    return service.chat(messages, chatOptions);
  }

  generateCodeAnalysisPrompt(code: string, focus: string): AIMessage[] {
    return [
      {
        role: 'system',
        content:
          'You are an expert JavaScript reverse engineer. Analyze code and return strict JSON only.',
      },
      {
        role: 'user',
        content: [
          `Focus: ${focus}`,
          'Return JSON with: techStack, businessLogic, securityRisks, summary.',
          'Code:',
          code,
        ].join('\n\n'),
      },
    ];
  }

  generateCryptoDetectionPrompt(code: string): AIMessage[] {
    return [
      {
        role: 'system',
        content:
          'You are a cryptography code auditor. Detect algorithms and return strict JSON only.',
      },
      {
        role: 'user',
        content: [
          'Return JSON with: algorithms[] where each item contains name, type, confidence, usage, parameters.',
          'Code:',
          code,
        ].join('\n\n'),
      },
    ];
  }

  generateDeobfuscationPrompt(code: string): AIMessage[] {
    return [
      {
        role: 'system',
        content:
          'You are an advanced JavaScript deobfuscation expert. Explain transformations and produce cleaned code guidance.',
      },
      {
        role: 'user',
        content: [
          'Analyze obfuscation techniques and provide a concise remediation strategy.',
          'Code:',
          code,
        ].join('\n\n'),
      },
    ];
  }

  generateTaintAnalysisPrompt(
    code: string,
    sources: string[],
    sinks: string[],
  ): AIMessage[] {
    return [
      {
        role: 'system',
        content:
          'You are a JavaScript taint-analysis assistant. Return strict JSON only.',
      },
      {
        role: 'user',
        content: [
          `Sources: ${sources.join(', ') || 'none'}`,
          `Sinks: ${sinks.join(', ') || 'none'}`,
          'Return JSON with taintPaths and highRiskFlows.',
          'Code:',
          code,
        ].join('\n\n'),
      },
    ];
  }
}
