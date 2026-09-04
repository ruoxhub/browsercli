/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AIConfig} from '../config/schema.js';
import {getAIConfig} from '../config/servicesConfig.js';

import {type RetryConfig, AIService} from './AIService.js';
import {OpenAIProvider} from './OpenAIProvider.js';

/**
 * 创建 AI Service 实例
 *
 * @param config AI 配置，缺省走 getAIConfig()
 * @param retryConfig 重试策略覆盖；连接测试等场景传 {maxRetries: 0} 快速失败
 */
export function createAIService(
  config?: AIConfig,
  retryConfig?: Partial<RetryConfig>,
): AIService | undefined {
  const aiConfig = config !== undefined ? config : getAIConfig();

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
        retryConfig,
      );
    }

    default: {
      throw new Error(`Unknown provider: ${provider}`);
    }
  }
}
