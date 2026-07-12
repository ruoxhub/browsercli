/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 最小隐蔽启动参数集。默认启用，仅含 --test-type 和 --hide-crash-restore-bubble。
 *
 * @see {@link src/browser/browser.ts} — BrowserManager 在启动时消费此常量
 * @see {@link src/browser/cloak.ts} — CloakBrowser 有独立的参数集
 * @see AGENTS.md — 反检测分层第 3 层：启动参数
 */

/**
 * Harmful args that Puppeteer/Playwright adds by default.
 * These leak automation signals and must be removed via ignoreDefaultArgs.
 */
export const HARMFUL_ARGS = [
  '--enable-automation',
  '--disable-popup-blocking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-extensions',
];

/**
 * Basic args used in all modes.
 */
export const DEFAULT_ARGS = [
  '--no-pings',
  '--no-first-run',
  '--disable-infobars',
  '--disable-breakpad',
  '--no-service-autorun',
  '--homepage=about:blank',
  '--password-store=basic',
  '--disable-hang-monitor',
  '--no-default-browser-check',
  '--disable-session-crashed-bubble',
  '--disable-search-engine-choice-screen',
];

/**
 * 最小隐身参数集。
 *
 * 与 jshookmcp 的默认 args 对齐：只下两个 UX 向 flag，不做任何浏览器指纹
 * 篡改。这两个 flag 都不会被主流反爬系统（Cloudflare Turnstile / DataDome /
 * FingerprintJS）作为检测信号：
 *
 * - `--test-type`：告诉 Chrome 自己正跑在自动化 harness 下，**只为**压制
 *   Patchright / cloak 额外 args 带来的 "unsupported command-line flag"
 *   黄条。纯粹是 banner 抑制器，不是配置级指纹信号（jshookmcp
 *   browser.ts:110 注释已说明）。
 * - `--hide-crash-restore-bubble`：压制 MCP/Worker 被 kill 后下次启动的
 *   "Chrome didn't shut down correctly" 气泡。纯 UX。
 *
 * 强反检测能力由协议层（Patchright）+ 源码层（`--cloak` 启用 CloakBrowser
 * 49 个 C++ patch）提供，不在 args 里堆 60 个 flag。
 */
export const MINIMAL_STEALTH_ARGS = [
  '--test-type',
  '--hide-crash-restore-bubble',
];

/**
 * 完整（历史）隐身参数集：60+ 个 flag，覆盖自动化特征、GPU、网络、音频、
 * 行为特征等。保留供 `--full-stealth-args` 回退使用；默认不再启用，因为
 * 其中多个 flag 本身已是反爬系统的检测信号。
 */
export const FULL_STEALTH_ARGS = [
  // Automation feature removal
  '--disable-blink-features=AutomationControlled',
  '--test-type',

  // Headless detection bypass
  '--start-maximized',
  '--window-position=0,0',
  '--window-size=1920,1080',

  // Localization
  '--lang=en-US',
  '--accept-lang=en-US',

  // Device fingerprint spoofing
  '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',

  // GPU & rendering
  '--ignore-gpu-blocklist',
  '--force-color-profile=srgb',
  '--font-render-hinting=none',

  // Network features
  '--enable-features=NetworkService,NetworkServiceInProcess,TrustTokens,TrustTokensAlwaysAllowIssuance',
  '--disable-features=AudioServiceOutOfProcess,TranslateUI,BlinkGenPropertyTrees',
  '--enable-async-dns',
  '--enable-tcp-fast-open',
  '--enable-web-bluetooth',

  // Audio/media
  '--mute-audio',

  // Sync & data
  '--disable-sync',
  '--use-mock-keychain',
  '--disable-translate',
  '--disable-voice-input',

  // UI elements
  '--hide-scrollbars',

  // Behavioral trait hiding
  '--autoplay-policy=user-gesture-required',
  '--disable-ipc-flooding-protection',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',

  // Privacy & security
  '--disable-client-side-phishing-detection',
  '--safebrowsing-disable-auto-update',
  '--disable-domain-reliability',
  '--metrics-recording-only',
  '--disable-cookie-encryption',

  // Performance & caching
  '--disable-logging',
  '--disable-dev-shm-usage',
  '--disable-crash-reporter',
  '--disable-partial-raster',
  '--disable-gesture-typing',
  '--disable-checker-imaging',
  '--disable-prompt-on-repost',
  '--aggressive-cache-discard',
  '--disable-threaded-animation',
  '--disable-threaded-scrolling',
  '--enable-simple-cache-backend',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-new-content-rendering-timeout',
  '--disable-image-animation-resync',
  '--disable-offer-upload-credit-cards',
  '--disable-offer-store-unmasked-wallet-cards',

  // Rendering & sync
  '--enable-surface-synchronization',
  '--run-all-compositor-stages-before-draw',

  // Other
  '--cloud-import',
  '--disable-print-preview',
  '--prerender-from-omnibox=disabled',
  '--disable-layer-tree-host-memory-pressure',
  '--disable-component-extensions-with-background-pages',
];

/**
 * Backward-compat alias：外部模块（browser-helpers.ts、browser/index.ts）
 * 历史上按 `STEALTH_ARGS` 引用完整集。重命名后保留该别名，避免破坏现有
 * 导入；新代码应优先 `MINIMAL_STEALTH_ARGS`（默认）或显式
 * `FULL_STEALTH_ARGS`（`--full-stealth-args` 回退）。
 */
export const STEALTH_ARGS = FULL_STEALTH_ARGS;
