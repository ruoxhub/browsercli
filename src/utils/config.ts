/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Configuration management for jshook-integration
 * Handles environment variables and system configuration
 */

import {existsSync} from 'node:fs';

import {config as dotenvConfig} from 'dotenv';

import {AIService} from '../services/AIService.js';
import {AnthropicProvider} from '../services/AnthropicProvider.js';
import {GeminiProvider} from '../services/GeminiProvider.js';
import {OpenAIProvider} from '../services/OpenAIProvider.js';

import {resolveDefaultEnvPath} from './projectPaths.js';

// Load .env file if it exists
const envPath = resolveDefaultEnvPath(import.meta.url);
if (existsSync(envPath)) {
  dotenvConfig({path: envPath});
}

/**
 * LLM Provider types
 */
export type LLMProvider = 'openai' | 'anthropic' | 'gemini';

/**
 * AI Service Configuration
 */
export interface AIConfig {
  provider: LLMProvider;
  openai?: {
    apiKey: string;
    baseURL?: string;
    model?: string;
  };
  anthropic?: {
    apiKey: string;
    baseURL?: string;
    model?: string;
  };
  gemini?: {
    apiKey?: string;
    cliPath?: string;
    useAPI?: boolean;
    model?: string;
  };
}

/**
 * Browser Configuration
 */
export interface BrowserConfig {
  headless?: boolean;
  executablePath?: string;
  channel?:
    | 'chrome'
    | 'chrome-beta'
    | 'chrome-dev'
    | 'chrome-canary'
    | 'msedge';
  isolated?: boolean;
  remoteDebuggingUrl?: string;
  remoteDebuggingPort?: number;
  useStealthScripts?: boolean;
  viewport?: {width: number; height: number};
}

/**
 * System Configuration
 */
export interface SystemConfig {
  ai?: AIConfig;
  browser: BrowserConfig;
  debug?: boolean;
}

/**
 * Get the default LLM provider from environment
 */
export function getDefaultLLMProvider(): LLMProvider {
  const provider = process.env.DEFAULT_LLM_PROVIDER?.toLowerCase();
  if (
    provider === 'openai' ||
    provider === 'anthropic' ||
    provider === 'gemini'
  )
    return provider;
  return 'gemini';
}

/**
 * Get AI configuration from environment variables
 */
export function getAIConfig(): AIConfig | undefined {
  const provider = getDefaultLLMProvider();

  const config: AIConfig = {
    provider,
  };

  if (process.env.OPENAI_API_KEY) {
    config.openai = {
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL || 'gpt-4o',
    };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    config.anthropic = {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL,
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
    };
  }

  config.gemini = {
    apiKey: process.env.GEMINI_API_KEY,
    cliPath: process.env.GEMINI_CLI_PATH || 'gemini-cli',
    useAPI: !!process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
  };

  const hasAnyProvider = config.openai || config.anthropic || config.gemini;

  return hasAnyProvider ? config : undefined;
}

/**
 * Get browser configuration from environment variables
 */
export function getBrowserConfig(): BrowserConfig {
  const config: BrowserConfig = {
    headless: process.env.BROWSER_HEADLESS !== 'false',
    isolated: process.env.BROWSER_ISOLATED !== 'false',
    useStealthScripts: process.env.USE_STEALTH_SCRIPTS === 'true',
  };

  if (process.env.BROWSER_EXECUTABLE_PATH) {
    config.executablePath = process.env.BROWSER_EXECUTABLE_PATH;
  }

  if (process.env.BROWSER_CHANNEL) {
    config.channel = process.env.BROWSER_CHANNEL as BrowserConfig['channel'];
  }

  if (process.env.REMOTE_DEBUGGING_URL) {
    config.remoteDebuggingUrl = process.env.REMOTE_DEBUGGING_URL;
  }

  if (process.env.REMOTE_DEBUGGING_PORT) {
    config.remoteDebuggingPort = parseInt(
      process.env.REMOTE_DEBUGGING_PORT,
      10,
    );
  }

  return config;
}

/**
 * Get complete system configuration
 */
export function getSystemConfig(): SystemConfig {
  return {
    ai: getAIConfig(),
    browser: getBrowserConfig(),
    debug: isDebugEnabled(),
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: SystemConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (config.browser.remoteDebuggingPort !== undefined) {
    const port = config.browser.remoteDebuggingPort;
    if (port < 1 || port > 65535) {
      errors.push(
        `Invalid REMOTE_DEBUGGING_PORT: ${port}. Must be between 1 and 65535.`,
      );
    }
  }

  if (config.ai) {
    const {provider} = config.ai;

    if (provider === 'openai' && !config.ai.openai) {
      errors.push('OpenAI provider selected but OPENAI_API_KEY not configured');
    }

    if (provider === 'anthropic' && !config.ai.anthropic) {
      errors.push(
        'Anthropic provider selected but ANTHROPIC_API_KEY not configured',
      );
    }

    if (provider === 'gemini' && !config.ai.gemini) {
      errors.push('Gemini provider selected but no configuration found');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get environment variable with fallback
 */
export function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || defaultValue;
}

/**
 * Check if debug mode is enabled
 */
export function isDebugEnabled(): boolean {
  return (
    process.env.DEBUG === 'true' || process.env.DEBUG?.includes('mcp') || false
  );
}

export function createAIService(config?: AIConfig): AIService | undefined {
  const aiConfig = config || getAIConfig();

  if (!aiConfig) {
    return undefined;
  }

  const {provider} = aiConfig;

  switch (provider) {
    case 'openai': {
      if (!aiConfig.openai) {
        throw new Error('OpenAI configuration not found');
      }
      return new AIService(
        new OpenAIProvider({
          apiKey: aiConfig.openai.apiKey,
          baseURL: aiConfig.openai.baseURL,
          model: aiConfig.openai.model,
        }),
      );
    }

    case 'anthropic': {
      if (!aiConfig.anthropic) {
        throw new Error('Anthropic configuration not found');
      }
      return new AIService(
        new AnthropicProvider({
          apiKey: aiConfig.anthropic.apiKey,
          baseURL: aiConfig.anthropic.baseURL,
          model: aiConfig.anthropic.model,
        }),
      );
    }

    case 'gemini': {
      if (!aiConfig.gemini) {
        throw new Error('Gemini configuration not found');
      }
      return new AIService(
        new GeminiProvider({
          apiKey: aiConfig.gemini.apiKey,
          cliPath: aiConfig.gemini.cliPath,
          useAPI: aiConfig.gemini.useAPI,
          model: aiConfig.gemini.model,
        }),
      );
    }

    default: {
      throw new Error(`Unknown provider: ${provider}`);
    }
  }
}
