/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * src/web-ui/src/lib/protocol.ts —— 前端协议类型。
 *
 * 重新导出后端的 src/web/types.ts 协议定义，消除双源维护成本。
 */

export * from '../../../web/types.js';

// ==================== Site Experience ====================

export interface SiteExperience {
  id: number;
  domain: string;
  name: string;
  aliases: string[];
  platformFeatures: string | null;
  validPatterns: string | null;
  knownPitfalls: string | null;
  createdAt: string;
  updatedAt: string;
}

// ==================== Runtime Config ====================

export interface BrowserConfig {
  headless?: boolean;
  isolated?: boolean;
  executablePath?: string;
  channel?: string;
  useStealthScripts?: boolean;
  jsStealth?: boolean;
  cloak?: boolean;
  fullStealthArgs?: boolean;
  minimalStealth?: boolean;
  browserURL?: string;
  wsEndpoint?: string;
  remoteDebuggingUrl?: string;
  remoteDebuggingPort?: number;
  userDataDir?: string;
  args?: string[];
  devtools?: boolean;
  autoLaunch?: boolean;
  userAgent?: string;
}

export interface OpenAIConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface GeminiConfig {
  apiKey?: string;
  cliPath?: string;
  useAPI?: boolean;
  model?: string;
}

export interface AnthropicConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface RuntimeConfig {
  rpcHost?: string;
  group?: string;
  browserUrl?: string;
  wsEndpoint?: string;
  headless?: boolean;
  executablePath?: string;
  databaseUrl?: string;
  llmProvider?: 'openai' | 'gemini' | 'anthropic';
  openai?: OpenAIConfig;
  gemini?: GeminiConfig;
  anthropic?: AnthropicConfig;
  browser?: BrowserConfig;
  debug?: boolean;
}

export interface ConnectResult {
  connected: boolean;
  mode?: string;
}
