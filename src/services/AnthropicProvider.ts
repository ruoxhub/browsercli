/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import Anthropic from '@anthropic-ai/sdk';

import type {AIProvider, AIMessage, AIResponse, ChatOptions} from './AIService.js';
import {
  decodeImageInput,
  formatProviderError,
  type FormattedProviderError,
} from './image-helpers.js';

export interface AnthropicConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

export class AnthropicProvider implements AIProvider {
  private readonly client: Anthropic;
  private readonly defaultModel: string;

  constructor(config: AnthropicConfig) {
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required');
    }

    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseURL && {baseURL: config.baseURL}),
    });

    this.defaultModel = config.model || 'claude-3-5-sonnet-20241022';
  }

  async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    try {
      // Anthropic requires system messages to be separate from the messages array
      const systemMessage = messages.find(msg => msg.role === 'system');
      const conversationMessages = messages.filter(msg => msg.role !== 'system');

      const response = await this.client.messages.create({
        model: options?.model || this.defaultModel,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature,
        system: systemMessage?.content,
        messages: conversationMessages.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
      });

      const textContent = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('');

      return {
        content: textContent,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async analyzeImage(
    imageInput: string,
    prompt: string,
    isFilePath = false,
  ): Promise<string> {
    try {
      const {mediaType, data: imageData} = decodeImageInput(imageInput, isFilePath);

      const response = await this.client.messages.create({
        model: this.defaultModel,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {type: 'base64', media_type: mediaType, data: imageData},
              },
              {type: 'text', text: prompt},
            ],
          },
        ],
      });

      const textContent = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('');

      return textContent;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private handleError(error: unknown): FormattedProviderError {
    if (error instanceof Anthropic.APIError) {
      const formatted = formatProviderError(
        `Anthropic API error (${error.status})`,
        error,
      );
      formatted.status = error.status;
      return formatted;
    }

    if (error instanceof Error) {
      return error as FormattedProviderError;
    }

    return new Error(`Unknown error: ${String(error)}`);
  }
}
