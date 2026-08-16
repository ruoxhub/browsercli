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

export interface RuntimeConfig {
  rpcHost?: string;
  group?: string;
  browserUrl?: string;
  wsEndpoint?: string;
  headless?: boolean;
  executablePath?: string;
  llmProvider?: 'openai';
  openai?: OpenAIConfig;
  browser?: BrowserConfig;
  debug?: boolean;
}

export interface ConnectResult {
  connected: boolean;
  mode?: string;
}

export interface LlmTestResult {
  ok: boolean;
  provider?: 'openai';
  latencyMs?: number;
}
