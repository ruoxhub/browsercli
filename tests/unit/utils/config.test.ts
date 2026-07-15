/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Unit tests for configuration management
 * Tests configuration loading, validation, and environment variable parsing
 *
 * Requirements: 11.3, 11.4, 11.5
 */

import assert from 'node:assert';
import os from 'node:os';
import {describe, it, beforeEach, afterEach, mock} from 'node:test';

import {
  getDefaultLLMProvider,
  getAIConfig,
  getBrowserConfig,
  getSystemConfig,
  validateConfig,
  getEnv,
  isDebugEnabled,
  createAIService,
  type SystemConfig,
  type AIConfig,
} from '../../../src/config.js';
import {
  getRuntimeConfigStore,
  resetRuntimeConfigStore,
} from '../../../src/config/RuntimeConfigStore.js';

describe('Configuration Management', () => {
  // Store original environment variables
  const originalEnv = {...process.env};

  beforeEach(() => {
    // Isolate tests from local global configurations
    mock.method(os, 'homedir', () => '/nonexistent-homedir');
    mock.method(process, 'cwd', () => '/nonexistent-cwd');

    // Clear environment variables before each test
    delete process.env.DEFAULT_LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_CLI_PATH;
    delete process.env.GEMINI_MODEL;
    delete process.env.BROWSER_HEADLESS;
    delete process.env.BROWSER_ISOLATED;
    delete process.env.BROWSER_EXECUTABLE_PATH;
    delete process.env.BROWSER_CHANNEL;
    delete process.env.REMOTE_DEBUGGING_URL;
    delete process.env.REMOTE_DEBUGGING_PORT;
    delete process.env.USE_STEALTH_SCRIPTS;
    delete process.env.DEBUG;

    // Reset RuntimeConfigStore so it re-seeds from the (now clean) env
    resetRuntimeConfigStore();
  });

  afterEach(() => {
    // Reset mocks
    mock.reset();

    // Restore original environment variables
    process.env = {...originalEnv};
    resetRuntimeConfigStore();
  });

  describe('getDefaultLLMProvider', () => {
    it('should return gemini as default when no provider is set', () => {
      const provider = getDefaultLLMProvider();
      assert.strictEqual(provider, 'gemini');
    });

    it('should return openai when DEFAULT_LLM_PROVIDER is openai', () => {
      process.env.DEFAULT_LLM_PROVIDER = 'openai';
      const provider = getDefaultLLMProvider();
      assert.strictEqual(provider, 'openai');
    });

    it('should return anthropic when DEFAULT_LLM_PROVIDER is anthropic', () => {
      process.env.DEFAULT_LLM_PROVIDER = 'anthropic';
      const provider = getDefaultLLMProvider();
      assert.strictEqual(provider, 'anthropic');
    });

    it('should return gemini when DEFAULT_LLM_PROVIDER is gemini', () => {
      process.env.DEFAULT_LLM_PROVIDER = 'gemini';
      const provider = getDefaultLLMProvider();
      assert.strictEqual(provider, 'gemini');
    });

    it('should handle case-insensitive provider names', () => {
      process.env.DEFAULT_LLM_PROVIDER = 'OPENAI';
      const provider = getDefaultLLMProvider();
      assert.strictEqual(provider, 'openai');
    });

    it('should return gemini for invalid provider names', () => {
      process.env.DEFAULT_LLM_PROVIDER = 'invalid-provider';
      const provider = getDefaultLLMProvider();
      assert.strictEqual(provider, 'gemini');
    });

    it('should reflect RuntimeConfigStore updates', () => {
      resetRuntimeConfigStore({llmProvider: 'anthropic'});

      assert.strictEqual(getDefaultLLMProvider(), 'anthropic');

      getRuntimeConfigStore().update({llmProvider: 'openai'});
      assert.strictEqual(getDefaultLLMProvider(), 'openai');
    });
  });

  describe('getAIConfig', () => {
    it('should configure OpenAI when OPENAI_API_KEY is set', () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
      const config = getAIConfig();

      assert.ok(config);
      assert.ok(config.openai);
      assert.strictEqual(config.openai.apiKey, 'sk-test-key');
      assert.strictEqual(config.openai.model, 'gpt-4o');
    });

    it('should use custom OpenAI base URL when set', () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
      process.env.OPENAI_BASE_URL = 'https://custom.openai.com/v1';
      const config = getAIConfig();

      assert.ok(config?.openai);
      assert.strictEqual(config.openai.baseURL, 'https://custom.openai.com/v1');
    });

    it('should use custom OpenAI model when set', () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
      process.env.OPENAI_MODEL = 'gpt-3.5-turbo';
      const config = getAIConfig();

      assert.ok(config?.openai);
      assert.strictEqual(config.openai.model, 'gpt-3.5-turbo');
    });

    it('should set correct provider based on DEFAULT_LLM_PROVIDER', () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
      process.env.DEFAULT_LLM_PROVIDER = 'openai';
      const config = getAIConfig();

      assert.ok(config);
      assert.strictEqual(config.provider, 'openai');
    });
  });

  describe('getBrowserConfig', () => {
    it('should return default browser configuration', () => {
      const config = getBrowserConfig();

      assert.strictEqual(config.headless, true);
      assert.strictEqual(config.isolated, true);
      assert.strictEqual(config.useStealthScripts, false);
    });

    it('should set headless to false when BROWSER_HEADLESS is false', () => {
      process.env.BROWSER_HEADLESS = 'false';
      const config = getBrowserConfig();

      assert.strictEqual(config.headless, false);
    });

    it('should set isolated to false when BROWSER_ISOLATED is false', () => {
      process.env.BROWSER_ISOLATED = 'false';
      const config = getBrowserConfig();

      assert.strictEqual(config.isolated, false);
    });

    it('should enable stealth scripts when USE_STEALTH_SCRIPTS is true', () => {
      process.env.USE_STEALTH_SCRIPTS = 'true';
      const config = getBrowserConfig();

      assert.strictEqual(config.useStealthScripts, true);
    });

    it('should set executable path when BROWSER_EXECUTABLE_PATH is set', () => {
      process.env.BROWSER_EXECUTABLE_PATH = '/path/to/chrome';
      const config = getBrowserConfig();

      assert.strictEqual(config.executablePath, '/path/to/chrome');
    });

    it('should set channel when BROWSER_CHANNEL is set', () => {
      process.env.BROWSER_CHANNEL = 'chrome-beta';
      const config = getBrowserConfig();

      assert.strictEqual(config.channel, 'chrome-beta');
    });

    it('should set remote debugging URL when REMOTE_DEBUGGING_URL is set', () => {
      process.env.REMOTE_DEBUGGING_URL = 'http://localhost:9222';
      const config = getBrowserConfig();

      assert.strictEqual(config.remoteDebuggingUrl, 'http://localhost:9222');
    });

    it('should parse remote debugging port when REMOTE_DEBUGGING_PORT is set', () => {
      process.env.REMOTE_DEBUGGING_PORT = '9222';
      const config = getBrowserConfig();

      assert.strictEqual(config.remoteDebuggingPort, 9222);
    });

    it('should handle all browser configuration options together', () => {
      process.env.BROWSER_HEADLESS = 'false';
      process.env.BROWSER_ISOLATED = 'false';
      process.env.USE_STEALTH_SCRIPTS = 'true';
      process.env.BROWSER_EXECUTABLE_PATH = '/path/to/chrome';
      process.env.BROWSER_CHANNEL = 'chrome-dev';
      process.env.REMOTE_DEBUGGING_URL = 'http://localhost:9222';
      process.env.REMOTE_DEBUGGING_PORT = '9222';

      const config = getBrowserConfig();

      assert.strictEqual(config.headless, false);
      assert.strictEqual(config.isolated, false);
      assert.strictEqual(config.useStealthScripts, true);
      assert.strictEqual(config.executablePath, '/path/to/chrome');
      assert.strictEqual(config.channel, 'chrome-dev');
      assert.strictEqual(config.remoteDebuggingUrl, 'http://localhost:9222');
      assert.strictEqual(config.remoteDebuggingPort, 9222);
    });
  });

  describe('getSystemConfig', () => {
    it('should return complete system configuration', () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
      process.env.DEBUG = 'true';

      const config = getSystemConfig();

      assert.ok(config);
      assert.ok(config.ai);
      assert.ok(config.browser);
      assert.strictEqual(config.debug, true);
    });

    it('should return system config with Gemini CLI when no API keys configured', () => {
      const config = getSystemConfig();

      assert.ok(config);
      // Gemini CLI is always available as fallback
      assert.ok(config.ai);
      assert.strictEqual(config.ai.provider, 'gemini');
      assert.ok(config.browser);
      assert.strictEqual(config.debug, false);
    });

    it('should detect debug mode from DEBUG=true', () => {
      process.env.DEBUG = 'true';
      const config = getSystemConfig();

      assert.strictEqual(config.debug, true);
    });

    it('should detect debug mode from DEBUG=mcp:*', () => {
      process.env.DEBUG = 'mcp:*';
      const config = getSystemConfig();

      assert.strictEqual(config.debug, true);
    });
  });

  describe('validateConfig', () => {
    it('should validate valid configuration', () => {
      const config: SystemConfig = {
        browser: {
          headless: true,
          isolated: true,
        },
      };

      const result = validateConfig(config);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should reject invalid remote debugging port (too low)', () => {
      const config: SystemConfig = {
        browser: {
          remoteDebuggingPort: 0,
        },
      };

      const result = validateConfig(config);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors[0].includes('Invalid REMOTE_DEBUGGING_PORT'));
    });

    it('should reject invalid remote debugging port (too high)', () => {
      const config: SystemConfig = {
        browser: {
          remoteDebuggingPort: 70000,
        },
      };

      const result = validateConfig(config);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors[0].includes('Invalid REMOTE_DEBUGGING_PORT'));
    });

    it('should accept valid remote debugging port', () => {
      const config: SystemConfig = {
        browser: {
          remoteDebuggingPort: 9222,
        },
      };

      const result = validateConfig(config);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should reject OpenAI provider without configuration', () => {
      const config: SystemConfig = {
        ai: {
          provider: 'openai',
        },
        browser: {},
      };

      const result = validateConfig(config);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('OpenAI')));
    });

    it('should accept valid OpenAI configuration', () => {
      const config: SystemConfig = {
        ai: {
          provider: 'openai',
          openai: {
            apiKey: 'sk-test-key',
            model: 'gpt-4o',
          },
        },
        browser: {},
      };

      const result = validateConfig(config);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should collect multiple validation errors', () => {
      const config: SystemConfig = {
        ai: {
          provider: 'openai',
        },
        browser: {
          remoteDebuggingPort: 0,
        },
      };

      const result = validateConfig(config);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.length, 2);
    });
  });

  describe('getEnv', () => {
    it('should return environment variable value when set', () => {
      process.env.TEST_VAR = 'test-value';
      const value = getEnv('TEST_VAR');

      assert.strictEqual(value, 'test-value');
    });

    it('should return undefined when environment variable is not set', () => {
      const value = getEnv('NON_EXISTENT_VAR');

      assert.strictEqual(value, undefined);
    });

    it('should return default value when environment variable is not set', () => {
      const value = getEnv('NON_EXISTENT_VAR', 'default-value');

      assert.strictEqual(value, 'default-value');
    });

    it('should prefer environment variable over default value', () => {
      process.env.TEST_VAR = 'env-value';
      const value = getEnv('TEST_VAR', 'default-value');

      assert.strictEqual(value, 'env-value');
    });
  });

  describe('isDebugEnabled', () => {
    it('should return false when DEBUG is not set', () => {
      const enabled = isDebugEnabled();

      assert.strictEqual(enabled, false);
    });

    it('should return true when DEBUG is true', () => {
      process.env.DEBUG = 'true';
      const enabled = isDebugEnabled();

      assert.strictEqual(enabled, true);
    });

    it('should return true when DEBUG contains mcp', () => {
      process.env.DEBUG = 'mcp:*';
      const enabled = isDebugEnabled();

      assert.strictEqual(enabled, true);
    });

    it('should return false when DEBUG is set to other values', () => {
      process.env.DEBUG = 'other:*';
      const enabled = isDebugEnabled();

      assert.strictEqual(enabled, false);
    });
  });

  describe('createAIService', () => {
    it('should return Gemini CLI service when no AI configuration is provided', () => {
      const service = createAIService();

      // Gemini CLI is always available as fallback
      assert.ok(service);
    });

    it('should create OpenAI service when configured', () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
      process.env.DEFAULT_LLM_PROVIDER = 'openai';

      const service = createAIService();

      assert.ok(service);
    });

    it('should create Anthropic service when configured', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      process.env.DEFAULT_LLM_PROVIDER = 'anthropic';

      const service = createAIService();

      assert.ok(service);
    });

    it('should create Gemini service when configured', () => {
      process.env.GEMINI_API_KEY = 'gemini-test-key';
      process.env.DEFAULT_LLM_PROVIDER = 'gemini';

      const service = createAIService();

      assert.ok(service);
    });

    it('should throw error when provider is configured but missing credentials', () => {
      const config: AIConfig = {
        provider: 'openai',
      };

      assert.throws(() => createAIService(config), {
        message: /Failed to create AI service/,
      });
    });

    it('should create service with custom configuration', () => {
      const config: AIConfig = {
        provider: 'openai',
        openai: {
          apiKey: 'sk-custom-key',
          model: 'gpt-3.5-turbo',
        },
      };

      const service = createAIService(config);

      assert.ok(service);
    });
  });
});
