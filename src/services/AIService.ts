/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AI 服务统一入口，按 provider 配置分发请求。
 *
 * @see {@link src/services/LLMService.ts} — 底层 LLM 调用封装
 * @see {@link src/services/OpenAIProvider.ts} — OpenAI provider
 * @see {@link src/runtime/RuntimeServices.ts} — lazy 初始化 AIService
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
  signal?: AbortSignal;
  timeoutMs?: number;
  totalBudgetMs?: number;
}

export interface AIProvider {
  chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse>;

  analyzeImage(
    imageInput: string,
    prompt: string,
    isFilePath?: boolean,
    options?: ChatOptions,
  ): Promise<string>;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  timeoutMs?: number;
  totalBudgetMs?: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
};

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
]);

const RETRYABLE_MESSAGE_FRAGMENTS = [
  'Connection error',
  'connect',
  'ECONNREFUSED',
];

export type AIFallbackReason = 'not_configured' | 'unavailable' | 'timeout';

export type AIAvailability =
  | {available: true}
  | {available: false; reason: 'not_configured'};

export class AIServiceError extends Error {
  readonly reason: AIFallbackReason;
  readonly cause?: unknown;

  constructor(reason: AIFallbackReason, message: string, cause?: unknown) {
    super(message);
    this.name = 'AIServiceError';
    this.reason = reason;
    this.cause = cause;
  }
}

export function classifyAIError(error: unknown): AIFallbackReason {
  if (!error) return 'unavailable';

  if (error instanceof AIServiceError) {
    return error.reason;
  }

  if (typeof error === 'object') {
    const err = error as {
      name?: string;
      code?: string;
      message?: string;
      reason?: string;
    };

    if (
      err.reason === 'not_configured' ||
      err.reason === 'timeout' ||
      err.reason === 'unavailable'
    ) {
      return err.reason;
    }

    if (err.code === 'AI_NOT_CONFIGURED') {
      return 'not_configured';
    }

    const message = err.message || '';
    const name = err.name || '';

    if (
      message.includes('not configured') ||
      message.includes('not_configured') ||
      message.includes('No AI provider configured') ||
      message.includes('OPENAI_API_KEY')
    ) {
      return 'not_configured';
    }

    if (
      name === 'AbortError' ||
      name === 'TimeoutError' ||
      err.code === 'ETIMEDOUT' ||
      err.code === 'TIMEOUT' ||
      message.includes('timed out') ||
      message.includes('Timeout') ||
      message.includes('timeout') ||
      message.includes('超时') ||
      message.includes('aborted') ||
      message.includes('Aborted')
    ) {
      return 'timeout';
    }
  }

  if (typeof error === 'string') {
    if (
      error.includes('not configured') ||
      error.includes('not_configured') ||
      error.includes('No AI provider configured')
    ) {
      return 'not_configured';
    }
    if (
      error.includes('timeout') ||
      error.includes('timed out') ||
      error.includes('超时') ||
      error.includes('aborted')
    ) {
      return 'timeout';
    }
  }

  return 'unavailable';
}

export class AIService {
  private readonly provider: AIProvider;
  private readonly retryConfig: RetryConfig;
  private readonly configured: boolean;

  constructor(
    provider: AIProvider,
    retryConfig?: Partial<RetryConfig>,
    configured = true,
  ) {
    this.provider = provider;
    this.retryConfig = {...DEFAULT_RETRY_CONFIG, ...retryConfig};
    this.configured = configured;
  }

  isAvailable(): boolean {
    return this.configured;
  }

  getAvailability(): AIAvailability {
    return this.configured
      ? {available: true}
      : {available: false, reason: 'not_configured'};
  }

  chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    if (!this.configured) {
      return Promise.reject(
        new AIServiceError(
          'not_configured',
          'AI service is not configured. Set OPENAI_API_KEY or configure an AI provider.',
        ),
      );
    }
    return this.withRetry(opts => this.provider.chat(messages, opts), options);
  }

  analyzeImage(
    imageInput: string,
    prompt: string,
    isFilePath?: boolean,
    options?: ChatOptions,
  ): Promise<string> {
    if (!this.configured) {
      return Promise.reject(
        new AIServiceError(
          'not_configured',
          'AI service is not configured. Set OPENAI_API_KEY or configure an AI provider.',
        ),
      );
    }
    return this.withRetry(
      opts => this.provider.analyzeImage(imageInput, prompt, isFilePath, opts),
      options,
    );
  }

  private async withRetry<T>(
    fn: (options?: ChatOptions) => Promise<T>,
    options?: ChatOptions,
  ): Promise<T> {
    if (!this.configured) {
      throw new AIServiceError(
        'not_configured',
        'AI service is not configured.',
      );
    }

    const callerSignal = options?.signal;
    if (callerSignal?.aborted) {
      throw new AIServiceError(
        'timeout',
        'AI service request was aborted before execution.',
        callerSignal.reason,
      );
    }

    const totalBudgetMs =
      options?.totalBudgetMs ?? this.retryConfig.totalBudgetMs;
    const timeoutMs = options?.timeoutMs ?? this.retryConfig.timeoutMs;
    const startTime = Date.now();
    const deadline = totalBudgetMs ? startTime + totalBudgetMs : undefined;

    let lastError: Error | undefined;
    let delay = this.retryConfig.initialDelay;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      if (callerSignal?.aborted) {
        throw new AIServiceError(
          'timeout',
          'AI service request was aborted.',
          callerSignal.reason,
        );
      }

      if (deadline !== undefined) {
        const remainingBudget = deadline - Date.now();
        if (remainingBudget <= 0) {
          throw new AIServiceError(
            'timeout',
            `AI service request total budget of ${totalBudgetMs}ms expired`,
            lastError,
          );
        }
      }

      const attemptTimeoutMs = this.calculateAttemptTimeout(
        timeoutMs,
        deadline,
      );
      const attemptController = new AbortController();
      let attemptTimer: NodeJS.Timeout | undefined;

      if (attemptTimeoutMs !== undefined && attemptTimeoutMs > 0) {
        attemptTimer = setTimeout(() => {
          attemptController.abort(
            new Error(`Operation timed out after ${attemptTimeoutMs}ms`),
          );
        }, attemptTimeoutMs);
      }

      const onCallerAbort = () => {
        attemptController.abort(callerSignal?.reason);
      };

      if (callerSignal) {
        callerSignal.addEventListener('abort', onCallerAbort, {once: true});
      }

      try {
        const hasActiveSignal =
          callerSignal !== undefined || attemptTimeoutMs !== undefined;
        let attemptOptions: ChatOptions | undefined = options;
        if (hasActiveSignal || attemptTimeoutMs !== undefined) {
          attemptOptions = {
            ...options,
          };
          if (hasActiveSignal) {
            attemptOptions.signal = attemptController.signal;
          }
          if (attemptTimeoutMs !== undefined) {
            attemptOptions.timeoutMs = attemptTimeoutMs;
          }
        }

        return await fn(attemptOptions);
      } catch (error) {
        lastError = error as Error;

        if (callerSignal?.aborted) {
          throw new AIServiceError(
            'timeout',
            'AI request aborted by caller.',
            error,
          );
        }

        if (attemptController.signal.aborted) {
          throw new AIServiceError(
            'timeout',
            `AI request timed out after ${attemptTimeoutMs}ms: ${(error as Error)?.message}`,
            error,
          );
        }

        const isRetryable = this.isRetryableError(error);
        if (attempt === this.retryConfig.maxRetries || !isRetryable) {
          // 非重试错误，或重试被禁用（maxRetries 0，如连接测试）时
          // 直接抛原始 provider 错误，避免 "failed after 0 retries" 包装噪音。
          if (
            (!isRetryable || this.retryConfig.maxRetries === 0) &&
            lastError instanceof Error
          ) {
            throw lastError;
          }
          break;
        }

        if (deadline !== undefined) {
          const remainingBudget = deadline - Date.now();
          if (remainingBudget <= 0 || remainingBudget <= delay) {
            throw new AIServiceError(
              'timeout',
              `AI service request total budget of ${totalBudgetMs}ms expired before retry delay of ${delay}ms`,
              lastError,
            );
          }
        }

        await this.sleep(delay, callerSignal, deadline);

        delay = Math.min(
          delay * this.retryConfig.backoffMultiplier,
          this.retryConfig.maxDelay,
        );
      } finally {
        if (attemptTimer) {
          clearTimeout(attemptTimer);
        }
        if (callerSignal) {
          callerSignal.removeEventListener('abort', onCallerAbort);
        }
      }
    }

    const classified = classifyAIError(lastError);
    if (classified === 'timeout') {
      throw new AIServiceError(
        'timeout',
        `AI service request timed out: ${lastError?.message}`,
        lastError,
      );
    }

    throw new Error(
      `AI service request failed after ${this.retryConfig.maxRetries} retries: ${lastError?.message}`,
    );
  }

  private calculateAttemptTimeout(
    timeoutMs?: number,
    deadline?: number,
  ): number | undefined {
    if (timeoutMs !== undefined && deadline !== undefined) {
      const remainingBudget = deadline - Date.now();
      return Math.max(1, Math.min(timeoutMs, remainingBudget));
    }
    if (timeoutMs !== undefined) {
      return timeoutMs;
    }
    if (deadline !== undefined) {
      return Math.max(1, deadline - Date.now());
    }
    return undefined;
  }

  private isRetryableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const err = error as {
      code?: string;
      message?: string;
      status?: number;
      statusCode?: number;
    };

    if (err.code && RETRYABLE_NETWORK_CODES.has(err.code)) {
      return true;
    }

    if (
      err.message &&
      RETRYABLE_MESSAGE_FRAGMENTS.some(fragment =>
        err.message!.includes(fragment),
      )
    ) {
      return true;
    }

    const status = err.status ?? err.statusCode;
    if (status === 429 || (typeof status === 'number' && status >= 500)) {
      return true;
    }

    return false;
  }

  private sleep(
    ms: number,
    signal?: AbortSignal,
    deadline?: number,
  ): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(
        new AIServiceError(
          'timeout',
          'Sleep aborted by caller signal.',
          signal.reason,
        ),
      );
    }

    const effectiveMs =
      deadline !== undefined
        ? Math.max(0, Math.min(ms, deadline - Date.now()))
        : ms;

    if (effectiveMs <= 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(
          new AIServiceError(
            'timeout',
            'Sleep aborted by caller signal.',
            signal?.reason,
          ),
        );
      };

      const timer = setTimeout(() => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        resolve();
      }, effectiveMs);

      if (signal) {
        signal.addEventListener('abort', onAbort, {once: true});
      }
    });
  }
}
