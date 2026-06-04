/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import OpenAI from 'openai';

import {
  decodeImageInput,
  formatProviderError,
  toImageDataUrl,
  type FormattedProviderError,
} from './image-helpers.js';
import type {
  AIProvider,
  AIMessage,
  AIResponse,
  ChatOptions,
} from './AIService.js';

export interface OpenAIConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

const NETWORK_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT']);

export class OpenAIProvider implements AIProvider {
  private readonly client: OpenAI;
  private readonly defaultModel: string;

  constructor(config: OpenAIConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: 30000,
    });

    this.defaultModel = config.model || 'gpt-4o';
  }

  async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: options?.model || this.defaultModel,
        messages: messages.map(msg => ({role: msg.role, content: msg.content})),
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
      });

      const choice = response.choices[0];
      if (!choice?.message) {
        throw new Error('No response from OpenAI');
      }

      return {
        content: choice.message.content || '',
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
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
      const imageUrl = this.buildImageUrl(imageInput, isFilePath);

      const response = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {type: 'text', text: prompt},
              {type: 'image_url', image_url: {url: imageUrl}},
            ],
          },
        ],
      });

      const choice = response.choices[0];
      if (!choice?.message) {
        throw new Error('No response from OpenAI');
      }

      return choice.message.content || '';
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private buildImageUrl(imageInput: string, isFilePath: boolean): string {
    if (!isFilePath) {
      if (
        imageInput.startsWith('http://') ||
        imageInput.startsWith('https://') ||
        imageInput.startsWith('data:')
      ) {
        return imageInput;
      }
      return toImageDataUrl('image/png', imageInput);
    }

    const {mediaType, data} = decodeImageInput(imageInput, isFilePath);
    return toImageDataUrl(mediaType, data);
  }

  private handleError(error: unknown): FormattedProviderError {
    if (error instanceof OpenAI.APIError) {
      const status = error.status ?? 'NETWORK';
      const formatted = formatProviderError(`OpenAI API error (${status})`, error);
      formatted.status = typeof status === 'number' ? status : undefined;
      formatted.code = error.code;
      return formatted;
    }

    if (error instanceof Error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code && NETWORK_ERROR_CODES.has(code)) {
        const baseURL = this.client.baseURL || 'https://api.openai.com/v1';
        return formatProviderError(
          `OpenAI connection failed (${code}): ${error.message}. ` +
            `Troubleshooting: 1. Check network; 2. Verify base URL (${baseURL}); 3. Configure proxy if needed.`,
          error,
        );
      }
      return error as FormattedProviderError;
    }

    return new Error(`Unknown error: ${String(error)}`);
  }
}
