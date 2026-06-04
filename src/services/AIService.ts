/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type MessageRole = 'system' | 'user' | 'assistant';

export interface AIMessage {
  role: MessageRole;
  content: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AIResponse {
  content: string;
  usage?: TokenUsage;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface AIProvider {
  chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse>;

  analyzeImage(
    imageInput: string,
    prompt: string,
    isFilePath?: boolean,
  ): Promise<string>;
}

interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
};

/**
 * HTTP/network error codes that should trigger a retry attempt.
 */
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
]);

const RETRYABLE_MESSAGE_FRAGMENTS = ['Connection error', 'connect', 'ECONNREFUSED'];

export class AIService {
  private readonly provider: AIProvider;
  private readonly retryConfig: RetryConfig;

  constructor(provider: AIProvider, retryConfig?: Partial<RetryConfig>) {
    this.provider = provider;
    this.retryConfig = {...DEFAULT_RETRY_CONFIG, ...retryConfig};
  }

  chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    return this.withRetry(() => this.provider.chat(messages, options));
  }

  analyzeImage(
    imageInput: string,
    prompt: string,
    isFilePath?: boolean,
  ): Promise<string> {
    return this.withRetry(() => this.provider.analyzeImage(imageInput, prompt, isFilePath));
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    let delay = this.retryConfig.initialDelay;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt === this.retryConfig.maxRetries || !this.isRetryableError(error)) {
          break;
        }

        await this.sleep(delay);
        delay = Math.min(
          delay * this.retryConfig.backoffMultiplier,
          this.retryConfig.maxDelay,
        );
      }
    }

    throw new Error(
      `AI service request failed after ${this.retryConfig.maxRetries} retries: ${lastError?.message}`,
    );
  }

  private isRetryableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const err = error as {code?: string; message?: string; status?: number; statusCode?: number};

    if (err.code && RETRYABLE_NETWORK_CODES.has(err.code)) {
      return true;
    }

    if (err.message && RETRYABLE_MESSAGE_FRAGMENTS.some(fragment => err.message!.includes(fragment))) {
      return true;
    }

    const status = err.status ?? err.statusCode;
    if (status === 429 || (typeof status === 'number' && status >= 500)) {
      return true;
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
