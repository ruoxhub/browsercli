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
   * 使用正在运行的 ego lite 浏览器（经 `EgoBridgeManager` 发布的本地 CDP 桥接）。
   *
   * 与 `cloak` / `isolated` 同类：一个互斥的浏览器来源开关，而不是 `channel`
   * 那样的启动策略值 —— `channel` 会原样传给 Patchright 的 `launch({channel})`
   * 和配置 schema 的枚举，把 `'ego'` 混进去会污染每一处按 channel 分支的逻辑。
   * 开启时跳过本地启动：先由桥接进程发布 ws 端点，再走既有的远程连接路径。
   */
  ego?: boolean;
  /**
   * ego 任务空间的保留策略（`--keep-page` / `BROWSER_KEEP_PAGE`）。
   *
   * 只在 `ego: true` 下有意义，并且必须随 `EgoBridgeManager.start({keepPage})`
   * 传入：策略被烘进桥接进程的启动 bootstrap，运行期无法更改（对不同的
   * keepPage 重复 `start()` 会被拒绝，而不是静默沿用旧值）。
   *
   * true = 桥接停止时执行 `task.finish({keep: 'all'})`，把 agent 的分析标签页
   * 留在 ego 里供人工复核；false/缺省 = `finish({keep: []})`，任务空间关闭、
   * 标签页一并消失。
   */
  keepPage?: boolean;
  /**
   * ego 任务空间使用的 Profile（`--profile <id>` / `BROWSER_EGO_PROFILE`）。
   *
   * 决定新建任务空间继承哪个身份（cookies、登录态、storage）。只在**新建**
   * 空间时生效：复用或认领已有空间会保留它原本的 profile，此时桥接进程会在
   * 诊断日志里明说该 flag 被忽略——静默切换会让用户以为换了身份，而眼前的
   * 标签页其实还登录在旧身份下。
   *
   * 取值来自 `ego.listProfiles()` 的 `id`（如 `Profile 1`），不是 `name`
   * （name 可能重复，不能作定位符）。
   */
  egoProfile?: string;
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
