/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  AIService,
  AIServiceError,
  classifyAIError,
  type AIProvider,
  type AIMessage,
  type ChatOptions,
} from '../../../src/services/AIService.js';

type RetryableError = Error & {
  code?: 'ECONNRESET' | 'ETIMEDOUT' | 'ENOTFOUND' | 'ECONNREFUSED';
  status?: number;
  statusCode?: number;
};

function createRetryableError(
  message: string,
  fields: Partial<Pick<RetryableError, 'code' | 'status' | 'statusCode'>>,
): RetryableError {
  return Object.assign(new Error(message), fields);
}

describe('AIService', () => {
  describe('Constructor', () => {
    it('should initialize with a provider', () => {
      const mockProvider: AIProvider = {
        chat: async () => ({content: 'test'}),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      assert.ok(service);
    });

    it('should initialize with default retry configuration', () => {
      const mockProvider: AIProvider = {
        chat: async () => ({content: 'test'}),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      assert.ok(service);
    });

    it('should initialize with custom retry configuration', () => {
      const mockProvider: AIProvider = {
        chat: async () => ({content: 'test'}),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 5,
        initialDelay: 500,
        maxDelay: 5000,
        backoffMultiplier: 3,
      });

      assert.ok(service);
    });

    it('should accept partial retry configuration', () => {
      const mockProvider: AIProvider = {
        chat: async () => ({content: 'test'}),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 2,
      });

      assert.ok(service);
    });
  });

  describe('chat method', () => {
    it('should call provider chat method with messages', async () => {
      let calledWith: AIMessage[] | undefined;

      const mockProvider: AIProvider = {
        chat: async (messages: AIMessage[]) => {
          calledWith = messages;
          return {content: 'Hello!'};
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const messages: AIMessage[] = [{role: 'user', content: 'Hello'}];

      const response = await service.chat(messages);

      assert.deepStrictEqual(calledWith, messages);
      assert.strictEqual(response.content, 'Hello!');
    });

    it('should pass chat options to provider', async () => {
      let calledOptions: ChatOptions | undefined;

      const mockProvider: AIProvider = {
        chat: async (messages: AIMessage[], options?: ChatOptions) => {
          calledOptions = options;
          return {content: 'test'};
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const options = {
        temperature: 0.7,
        maxTokens: 1000,
        model: 'gpt-4',
      };

      await service.chat([{role: 'user', content: 'test'}], options);

      assert.deepStrictEqual(calledOptions, options);
    });

    it('should return response with usage information', async () => {
      const mockProvider: AIProvider = {
        chat: async () => ({
          content: 'Response',
          usage: {
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
          },
        }),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const response = await service.chat([{role: 'user', content: 'test'}]);

      assert.strictEqual(response.content, 'Response');
      assert.ok(response.usage);
      assert.strictEqual(response.usage.promptTokens, 10);
      assert.strictEqual(response.usage.completionTokens, 20);
      assert.strictEqual(response.usage.totalTokens, 30);
    });

    it('should handle response without usage information', async () => {
      const mockProvider: AIProvider = {
        chat: async () => ({
          content: 'Response',
        }),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const response = await service.chat([{role: 'user', content: 'test'}]);

      assert.strictEqual(response.content, 'Response');
      assert.strictEqual(response.usage, undefined);
    });

    it('should handle multiple messages', async () => {
      const mockProvider: AIProvider = {
        chat: async (messages: AIMessage[]) => ({
          content: `Received ${messages.length} messages`,
        }),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const messages: AIMessage[] = [
        {role: 'system', content: 'You are helpful'},
        {role: 'user', content: 'Hello'},
        {role: 'assistant', content: 'Hi!'},
        {role: 'user', content: 'How are you?'},
      ];

      const response = await service.chat(messages);

      assert.strictEqual(response.content, 'Received 4 messages');
    });
  });

  describe('analyzeImage method', () => {
    it('should call provider analyzeImage method', async () => {
      let calledWith:
        | {imageInput: string; prompt: string; isFilePath?: boolean}
        | undefined;

      const mockProvider: AIProvider = {
        chat: async () => ({content: 'test'}),
        analyzeImage: async (
          imageInput: string,
          prompt: string,
          isFilePath?: boolean,
        ) => {
          calledWith = {imageInput, prompt, isFilePath};
          return 'Image analysis result';
        },
      };

      const service = new AIService(mockProvider);
      const result = await service.analyzeImage(
        'image.png',
        'Describe this image',
        true,
      );

      assert.ok(calledWith);
      assert.strictEqual(calledWith.imageInput, 'image.png');
      assert.strictEqual(calledWith.prompt, 'Describe this image');
      assert.strictEqual(calledWith.isFilePath, true);
      assert.strictEqual(result, 'Image analysis result');
    });

    it('should handle base64 image input', async () => {
      const mockProvider: AIProvider = {
        chat: async () => ({content: 'test'}),
        analyzeImage: async (imageInput: string) => {
          return `Analyzed base64 image: ${imageInput.substring(0, 10)}...`;
        },
      };

      const service = new AIService(mockProvider);
      const base64Image =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const result = await service.analyzeImage(
        base64Image,
        'What is this?',
        false,
      );

      assert.ok(result.includes('Analyzed base64 image'));
    });
  });

  describe('Error handling and retry mechanism', () => {
    it('should retry on network errors (ECONNRESET)', async () => {
      let attempts = 0;

      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          if (attempts < 3) {
            const error = createRetryableError('Connection reset', {
              code: 'ECONNRESET',
            });
            throw error;
          }
          return {content: 'Success after retries'};
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
        maxDelay: 100,
        backoffMultiplier: 2,
      });

      const response = await service.chat([{role: 'user', content: 'test'}]);

      assert.strictEqual(attempts, 3);
      assert.strictEqual(response.content, 'Success after retries');
    });

    it('should retry on network errors (ETIMEDOUT)', async () => {
      let attempts = 0;

      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          if (attempts < 2) {
            const error = createRetryableError('Connection timed out', {
              code: 'ETIMEDOUT',
            });
            throw error;
          }
          return {content: 'Success'};
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      const response = await service.chat([{role: 'user', content: 'test'}]);

      assert.strictEqual(attempts, 2);
      assert.strictEqual(response.content, 'Success');
    });

    it('should retry on network errors (ENOTFOUND)', async () => {
      let attempts = 0;

      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          if (attempts < 2) {
            const error = createRetryableError('Host not found', {
              code: 'ENOTFOUND',
            });
            throw error;
          }
          return {content: 'Success'};
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      await service.chat([{role: 'user', content: 'test'}]);

      assert.strictEqual(attempts, 2);
    });

    it('should retry on rate limit errors (429)', async () => {
      let attempts = 0;

      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          if (attempts < 2) {
            const error = createRetryableError('Rate limit exceeded', {
              status: 429,
            });
            throw error;
          }
          return {content: 'Success'};
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      await service.chat([{role: 'user', content: 'test'}]);

      assert.strictEqual(attempts, 2);
    });

    it('should retry on server errors (500)', async () => {
      let attempts = 0;

      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          if (attempts < 2) {
            const error = createRetryableError('Internal server error', {
              status: 500,
            });
            throw error;
          }
          return {content: 'Success'};
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      await service.chat([{role: 'user', content: 'test'}]);

      assert.strictEqual(attempts, 2);
    });

    it('should retry on server errors (503)', async () => {
      let attempts = 0;

      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          if (attempts < 2) {
            const error = createRetryableError('Service unavailable', {
              statusCode: 503,
            });
            throw error;
          }
          return {content: 'Success'};
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      await service.chat([{role: 'user', content: 'test'}]);

      assert.strictEqual(attempts, 2);
    });

    it('should not retry on client errors (400)', async () => {
      let attempts = 0;

      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          const error = createRetryableError('Bad request', {
            status: 400,
          });
          throw error;
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      await assert.rejects(
        async () => {
          await service.chat([{role: 'user', content: 'test'}]);
        },
        {
          message: /Bad request/,
        },
      );

      assert.strictEqual(attempts, 1);
    });

    it('should not retry on authentication errors (401)', async () => {
      let attempts = 0;

      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          const error = createRetryableError('Unauthorized', {
            status: 401,
          });
          throw error;
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      await assert.rejects(
        async () => {
          await service.chat([{role: 'user', content: 'test'}]);
        },
        {
          message: /Unauthorized/,
        },
      );

      assert.strictEqual(attempts, 1);
    });

    it('should throw error after max retries exhausted', async () => {
      let attempts = 0;

      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          const error = createRetryableError('Connection reset', {
            code: 'ECONNRESET',
          });
          throw error;
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 2,
        initialDelay: 10,
      });

      await assert.rejects(
        async () => {
          await service.chat([{role: 'user', content: 'test'}]);
        },
        {
          message: /AI service request failed after 2 retries/,
        },
      );

      // Should attempt initial + 2 retries = 3 total
      assert.strictEqual(attempts, 3);
    });

    it('should rethrow the raw provider error when retries are disabled', async () => {
      let attempts = 0;

      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          throw createRetryableError('OpenAI API error (503)', {status: 503});
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {maxRetries: 0});

      await assert.rejects(
        async () => {
          await service.chat([{role: 'user', content: 'test'}]);
        },
        error => {
          assert.ok(error instanceof Error);
          // 直接抛原始错误，而不是 "failed after 0 retries" 包装
          assert.strictEqual(error.message, 'OpenAI API error (503)');
          assert.doesNotMatch(error.message, /failed after/);
          return true;
        },
      );

      // 仅尝试一次，不做重试
      assert.strictEqual(attempts, 1);
    });

    it('should use exponential backoff for retries', async () => {
      const delays: number[] = [];
      let attempts = 0;
      let lastTime = Date.now();

      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          const currentTime = Date.now();
          if (attempts > 1) {
            delays.push(currentTime - lastTime);
          }
          lastTime = currentTime;

          if (attempts < 4) {
            const error = createRetryableError('Connection reset', {
              code: 'ECONNRESET',
            });
            throw error;
          }
          return {content: 'Success'};
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 50,
        maxDelay: 500,
        backoffMultiplier: 2,
      });

      await service.chat([{role: 'user', content: 'test'}]);

      // Verify exponential backoff: each delay should be roughly 2x the previous
      // Allow some tolerance for timing variations
      assert.ok(delays.length >= 2);
      assert.ok(delays[0] >= 40); // ~50ms
      assert.ok(delays[1] >= 90); // ~100ms (50 * 2)
    });

    it('should respect max delay in exponential backoff', async () => {
      const delays: number[] = [];
      let attempts = 0;
      let lastTime = Date.now();

      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          const currentTime = Date.now();
          if (attempts > 1) {
            delays.push(currentTime - lastTime);
          }
          lastTime = currentTime;

          if (attempts < 5) {
            const error = createRetryableError('Connection reset', {
              code: 'ECONNRESET',
            });
            throw error;
          }
          return {content: 'Success'};
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 4,
        initialDelay: 100,
        maxDelay: 150,
        backoffMultiplier: 2,
      });

      await service.chat([{role: 'user', content: 'test'}]);

      // All delays should be capped at maxDelay (150ms) with tolerance
      // Use generous tolerance for timing-sensitive tests in CI/WSL2
      for (const delay of delays) {
        assert.ok(
          delay <= 250,
          `delay ${delay}ms exceeded maxDelay+tolerance (250ms)`,
        );
      }
    });

    it('should retry analyzeImage on transient errors', async () => {
      let attempts = 0;

      const mockProvider: AIProvider = {
        chat: async () => ({content: 'test'}),
        analyzeImage: async () => {
          attempts++;
          if (attempts < 2) {
            const error = createRetryableError('Connection reset', {
              code: 'ECONNRESET',
            });
            throw error;
          }
          return 'Image analysis result';
        },
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      const result = await service.analyzeImage('image.png', 'Describe', true);

      assert.strictEqual(attempts, 2);
      assert.strictEqual(result, 'Image analysis result');
    });

    it('should handle non-retryable errors in analyzeImage', async () => {
      let attempts = 0;

      const mockProvider: AIProvider = {
        chat: async () => ({content: 'test'}),
        analyzeImage: async () => {
          attempts++;
          const error = createRetryableError('Invalid image format', {
            status: 400,
          });
          throw error;
        },
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      await assert.rejects(
        async () => {
          await service.analyzeImage('image.png', 'Describe', true);
        },
        {
          message: /Invalid image format/,
        },
      );

      assert.strictEqual(attempts, 1);
    });

    it('should not retry on non-Error objects', async () => {
      let attempts = 0;

      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          throw 'String error';
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 2,
        initialDelay: 10,
      });

      await assert.rejects(async () => {
        await service.chat([{role: 'user', content: 'test'}]);
      });

      // Should not retry non-Error objects
      assert.strictEqual(attempts, 1);
    });

    it('should not retry on null errors', async () => {
      let attempts = 0;

      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          throw null;
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 2,
        initialDelay: 10,
      });

      await assert.rejects(async () => {
        await service.chat([{role: 'user', content: 'test'}]);
      });

      // Should not retry null errors
      assert.strictEqual(attempts, 1);
    });
  });

  describe('Integration with different message types', () => {
    it('should handle system messages', async () => {
      const mockProvider: AIProvider = {
        chat: async (messages: AIMessage[]) => {
          const systemMsg = messages.find(m => m.role === 'system');
          return {
            content: systemMsg ? 'Has system message' : 'No system message',
          };
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const messages: AIMessage[] = [
        {role: 'system', content: 'You are helpful'},
        {role: 'user', content: 'Hello'},
      ];

      const response = await service.chat(messages);

      assert.strictEqual(response.content, 'Has system message');
    });

    it('should handle conversation history', async () => {
      const mockProvider: AIProvider = {
        chat: async (messages: AIMessage[]) => {
          return {content: `Conversation has ${messages.length} messages`};
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const messages: AIMessage[] = [
        {role: 'user', content: 'What is 2+2?'},
        {role: 'assistant', content: '4'},
        {role: 'user', content: 'What is 3+3?'},
      ];

      const response = await service.chat(messages);

      assert.strictEqual(response.content, 'Conversation has 3 messages');
    });

    it('should handle empty message content', async () => {
      const mockProvider: AIProvider = {
        chat: async () => ({content: ''}),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const response = await service.chat([{role: 'user', content: ''}]);

      assert.strictEqual(response.content, '');
    });
  });

  describe('Bounded AI behavior and error classification', () => {
    it('should fast-exit with zero provider calls and zero sleep when unconfigured', async () => {
      let callCount = 0;
      const unconfiguredProvider: AIProvider = {
        chat: async () => {
          callCount++;
          return {content: 'should not be called'};
        },
        analyzeImage: async () => {
          callCount++;
          return 'should not be called';
        },
      };

      const service = new AIService(unconfiguredProvider, {}, false);

      assert.strictEqual(service.isAvailable(), false);
      assert.deepStrictEqual(service.getAvailability(), {
        available: false,
        reason: 'not_configured',
      });

      const startTime = Date.now();
      await assert.rejects(
        async () => {
          await service.chat([{role: 'user', content: 'test'}]);
        },
        (error: unknown) => {
          assert.ok(error instanceof AIServiceError);
          assert.strictEqual(error.reason, 'not_configured');
          return true;
        },
      );

      const elapsed = Date.now() - startTime;
      assert.strictEqual(callCount, 0, 'Should make 0 provider calls');
      assert.ok(
        elapsed < 100,
        `Should exit immediately (<100ms), took ${elapsed}ms`,
      );
    });

    it('should fast-exit on analyzeImage when unconfigured', async () => {
      const service = new AIService(
        {chat: async () => ({content: ''}), analyzeImage: async () => ''},
        {},
        false,
      );

      await assert.rejects(
        async () => {
          await service.analyzeImage('img.png', 'prompt');
        },
        (error: unknown) => {
          assert.ok(error instanceof AIServiceError);
          assert.strictEqual(error.reason, 'not_configured');
          return true;
        },
      );
    });

    it('should abort provider call when timeoutMs budget is exceeded', async () => {
      const hangingProvider: AIProvider = {
        chat: async (_messages, options) => {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              resolve({content: 'done late'});
            }, 2000);

            if (options?.signal) {
              options.signal.addEventListener('abort', () => {
                clearTimeout(timer);
                const abortErr = new Error('This operation was aborted');
                abortErr.name = 'AbortError';
                reject(abortErr);
              });
            }
          });
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(hangingProvider);
      const startTime = Date.now();

      await assert.rejects(
        async () => {
          await service.chat([{role: 'user', content: 'test'}], {
            timeoutMs: 100,
          });
        },
        (error: unknown) => {
          assert.ok(error instanceof AIServiceError);
          assert.strictEqual(error.reason, 'timeout');
          return true;
        },
      );

      const elapsed = Date.now() - startTime;
      assert.ok(
        elapsed < 1000,
        `Abort should happen quickly around timeout budget (took ${elapsed}ms)`,
      );
    });

    it('should stop retrying when totalBudgetMs expires', async () => {
      let attempts = 0;
      const retryableProvider: AIProvider = {
        chat: async () => {
          attempts++;
          throw createRetryableError('Connection reset', {code: 'ECONNRESET'});
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(retryableProvider, {
        maxRetries: 10,
        initialDelay: 50,
        backoffMultiplier: 2,
      });

      const startTime = Date.now();
      await assert.rejects(
        async () => {
          await service.chat([{role: 'user', content: 'test'}], {
            totalBudgetMs: 120,
          });
        },
        (error: unknown) => {
          assert.ok(error instanceof AIServiceError);
          assert.strictEqual(error.reason, 'timeout');
          return true;
        },
      );

      const elapsed = Date.now() - startTime;
      assert.ok(
        attempts < 10,
        `Retries should be stopped before maxRetries (attempts=${attempts})`,
      );
      assert.ok(
        elapsed < 500,
        `Total time should respect budget, took ${elapsed}ms`,
      );
    });

    it('should cancel retry sleep immediately when caller AbortSignal fires', async () => {
      let attempts = 0;
      const retryableProvider: AIProvider = {
        chat: async () => {
          attempts++;
          throw createRetryableError('Connection reset', {code: 'ECONNRESET'});
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(retryableProvider, {
        maxRetries: 5,
        initialDelay: 5000,
      });

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 50);

      const startTime = Date.now();
      await assert.rejects(
        async () => {
          await service.chat([{role: 'user', content: 'test'}], {
            signal: controller.signal,
          });
        },
        (error: unknown) => {
          assert.ok(error instanceof AIServiceError);
          assert.strictEqual(error.reason, 'timeout');
          return true;
        },
      );

      const elapsed = Date.now() - startTime;
      assert.strictEqual(attempts, 1);
      assert.ok(
        elapsed < 500,
        `Sleep should abort immediately when signal fires (took ${elapsed}ms instead of 5000ms)`,
      );
    });

    describe('classifyAIError', () => {
      it('should classify AIServiceError reasons directly', () => {
        assert.strictEqual(
          classifyAIError(
            new AIServiceError('not_configured', 'not configured'),
          ),
          'not_configured',
        );
        assert.strictEqual(
          classifyAIError(new AIServiceError('timeout', 'timed out')),
          'timeout',
        );
        assert.strictEqual(
          classifyAIError(new AIServiceError('unavailable', 'service down')),
          'unavailable',
        );
      });

      it('should classify timeout-related errors as timeout', () => {
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        assert.strictEqual(classifyAIError(abortErr), 'timeout');

        const timeoutErr = new Error('Request timeout after 5000ms');
        timeoutErr.name = 'TimeoutError';
        assert.strictEqual(classifyAIError(timeoutErr), 'timeout');

        const timedoutErr = createRetryableError('Connection timed out', {
          code: 'ETIMEDOUT',
        });
        assert.strictEqual(classifyAIError(timedoutErr), 'timeout');
      });

      it('should classify unconfigured errors as not_configured', () => {
        assert.strictEqual(
          classifyAIError(
            new Error(
              'No AI provider configured. Set OPENAI_API_KEY environment variable.',
            ),
          ),
          'not_configured',
        );
        assert.strictEqual(
          classifyAIError(new Error('AI provider is not configured')),
          'not_configured',
        );
        assert.strictEqual(
          classifyAIError({code: 'AI_NOT_CONFIGURED', message: 'missing key'}),
          'not_configured',
        );
      });

      it('should classify connection/server errors as unavailable', () => {
        assert.strictEqual(
          classifyAIError(
            createRetryableError('ECONNREFUSED', {code: 'ECONNREFUSED'}),
          ),
          'unavailable',
        );
        assert.strictEqual(
          classifyAIError(
            createRetryableError('Internal server error', {status: 500}),
          ),
          'unavailable',
        );
        assert.strictEqual(
          classifyAIError(
            createRetryableError('Rate limit exceeded', {status: 429}),
          ),
          'unavailable',
        );
        assert.strictEqual(
          classifyAIError('random string error'),
          'unavailable',
        );
      });
    });
  });
});
