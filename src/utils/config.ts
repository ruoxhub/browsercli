/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 配置管理 — 从 src/config.ts 重新导出
 *
 * @see src/config.ts — 所有配置逻辑的统一入口
 */

export {
  type LLMProvider,
  type AIConfig,
  type BrowserConfig,
  type SystemConfig,
  getDefaultLLMProvider,
  getAIConfig,
  getBrowserConfig,
  getSystemConfig,
  validateConfig,
  getEnv,
  isDebugEnabled,
  createAIService,
} from '../config.js';
