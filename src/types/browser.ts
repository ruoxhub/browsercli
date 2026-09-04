/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type Channel =
  // Chromium (CDP) — schema collapses chrome/chrome-* aliases into stable/beta/dev/canary
  | 'stable'
  | 'beta'
  | 'dev'
  | 'canary'
  | 'chromium'
  // Chromium (WebDriver BiDi)
  | 'bidi-chromium'
  | 'bidi-chrome'
  | 'bidi-chrome-beta'
  | 'bidi-chrome-dev'
  | 'bidi-chrome-canary'
  // Firefox
  | 'firefox'
  | 'moz-firefox';

/**
 * Configuration options for BrowserManager
 */
export interface BrowserManagerConfig {
  headless?: boolean;
  executablePath?: string;
  channel?: Channel;
  isolated?: boolean;
  browserURL?: string;
  wsEndpoint?: string;
  remoteDebuggingUrl?: string;
  remoteDebuggingPort?: number;
  wsHeaders?: Record<string, string>;
  useStealthScripts?: boolean;
  /**
   * 启用 CloakBrowser 二进制 + 49 个 C++ 源码层指纹 patch（替代系统 Chrome）。
   * 强反爬站点（Cloudflare Turnstile / DataDome / FingerprintJS）的逃生通道。
   * 开启时 profile 目录自动切到 `cloak-profile`（与默认 `chrome-profile`
   * 物理隔离，避免两个 Chromium 二进制的 state 互踩）。
   */
  cloak?: boolean;
  /**
   * Opt-in 注入 StealthScripts2025（覆盖 navigator/canvas/WebGL/audio 等）。
   * 默认不开：与 jshookmcp 的"零 JS 注入"哲学对齐 —— `Object.defineProperty`
   * hack 本身就是检测信号。需要显式 opt-in 才注入。
   */
  jsStealth?: boolean;
  /**
   * 使用历史 60+ 启动参数集（`FULL_STEALTH_ARGS`）。默认不开：其中多个 flag
   * 已是反爬系统的已知检测信号。回退开关，给依赖旧行为的部署用。
   */
  fullStealthArgs?: boolean;
  /**
   * 启用最小启动参数集（`MINIMAL_STEALTH_ARGS`：`--test-type` banner 抑制
   * + `--hide-crash-restore-bubble`）。默认 false 保持向后兼容；顶层
   * launch() 与新的 CLI 默认路径传 true。
   */
  minimalStealth?: boolean;
  acceptInsecureCerts?: boolean;
  userDataDir?: string;
  viewport?: {
    width: number;
    height: number;
  };
  args?: string[];
  devtools?: boolean;
  // 新增：自动启动浏览器能力（合并自 BrowserModeManager）
  autoLaunch?: boolean;
  browserPath?: string;
  waitForBrowserTimeoutMs?: number;
  waitForBrowserPollMs?: number;
  timeout?: number;
  maxCollectedUrls?: number;
  maxFilesPerCollect?: number;
  maxTotalContentSize?: number;
  maxSingleFileSize?: number;
  userAgent?: string;
}
