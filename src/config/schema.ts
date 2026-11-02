/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 *
 * Runtime configuration schemas.
 */

import type {zod as zodType} from '../third_party/index.js';
import {zod} from '../third_party/index.js';

const optionalStringSchema = zod.string();

const booleanSchema = zod.preprocess(value => {
  if (typeof value !== 'string') return value;
  const normalized = value.toLowerCase().trim();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return value;
}, zod.boolean());

const positiveIntSchema = zod.coerce.number().int().positive();

const portSchema = zod.coerce
  .number()
  .int()
  .min(1024, 'Invalid REMOTE_DEBUGGING_PORT')
  .max(65535, 'Invalid REMOTE_DEBUGGING_PORT');

const nonNegativeIntSchema = zod.coerce.number().int().nonnegative();

const stringArraySchema = zod.preprocess(value => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    if (value.startsWith('[') && value.endsWith(']')) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        // fallback to split
      }
    }
    return value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }
  return value;
}, zod.array(zod.string()));

const screenshotFormatSchema = zod.enum(['jpeg', 'png', 'webp']);

const ViewportSchema: zodType.ZodType<{width: number; height: number}> = zod
  .object({
    width: positiveIntSchema,
    height: positiveIntSchema,
  })
  .strip() as zodType.ZodType<{width: number; height: number}>;

export const BrowserConfigSchema = zod
  .object({
    headless: booleanSchema.optional(),
    isolated: booleanSchema.optional(),
    executablePath: optionalStringSchema.optional(),
    channel: zod
      .enum([
        // Chromium (CDP)
        'stable',
        'beta',
        'dev',
        'canary',
        'chrome',
        'chrome-beta',
        'chrome-dev',
        'chrome-canary',
        'chromium',
        // Chromium (WebDriver BiDi) — patchright routes channel.startsWith('bidi-') to BidiChromium
        'bidi-chromium',
        'bidi-chrome',
        'bidi-chrome-beta',
        'bidi-chrome-dev',
        'bidi-chrome-canary',
        // Firefox — patchright routes channel.startsWith('moz-') to Firefox launcher
        'firefox',
        'moz-firefox',
      ])
      .transform(channel => {
        // Only Chrome CDP aliases collapse to short forms; bidi-* and moz-* pass through unchanged
        // because patchright dispatches on their prefixes.
        const aliases = {
          chrome: 'stable',
          'chrome-beta': 'beta',
          'chrome-dev': 'dev',
          'chrome-canary': 'canary',
        } as const;
        return channel in aliases
          ? aliases[channel as keyof typeof aliases]
          : channel;
      })
      .optional(),
    useStealthScripts: booleanSchema.optional(),
    /** Opt-in 注入 StealthScripts2025 JS 反检测脚本（覆盖 navigator/canvas/WebGL/audio）。默认 false（jshookmcp 哲学：零 JS 注入）。 */
    jsStealth: booleanSchema.optional(),
    /** 启用 CloakBrowser 二进制 + 49 个 C++ 源码层指纹 patch；profile 目录切到 `cloak-profile`。 */
    cloak: booleanSchema.optional(),
    /** 使用历史 60+ 启动参数集（`FULL_STEALTH_ARGS`）。默认 false：其中多个 flag 已是反爬检测信号。 */
    fullStealthArgs: booleanSchema.optional(),
    /** 启用最小启动参数集（`MINIMAL_STEALTH_ARGS`：`--test-type` + `--hide-crash-restore-bubble`）。默认 true。 */
    minimalStealth: booleanSchema.optional(),
    autoConnect: booleanSchema.optional(),
    viewport: ViewportSchema.optional(),
    browserURL: optionalStringSchema.optional(),
    wsEndpoint: optionalStringSchema.optional(),
    remoteDebuggingUrl: optionalStringSchema.optional(),
    remoteDebuggingPort: portSchema.optional(),
    wsHeaders: zod.record(zod.string()).optional(),
    acceptInsecureCerts: booleanSchema.optional(),
    userDataDir: optionalStringSchema.optional(),
    args: zod.array(zod.string()).optional(),
    devtools: booleanSchema.optional(),
    autoLaunch: booleanSchema.optional(),
    browserPath: optionalStringSchema.optional(),
    waitForBrowserTimeoutMs: nonNegativeIntSchema.optional(),
    waitForBrowserPollMs: positiveIntSchema.optional(),
    timeout: nonNegativeIntSchema.optional(),
    maxCollectedUrls: positiveIntSchema.optional(),
    maxFilesPerCollect: positiveIntSchema.optional(),
    maxTotalContentSize: positiveIntSchema.optional(),
    maxSingleFileSize: positiveIntSchema.optional(),
    userAgent: optionalStringSchema.optional(),

    // chrome-devtools-mcp 对齐配置项
    proxyServer: optionalStringSchema.optional(),
    chromeArg: stringArraySchema.optional(),
    ignoreDefaultChromeArg: stringArraySchema.optional(),
    blockedUrlPattern: stringArraySchema.optional(),
    allowedUrlPattern: stringArraySchema.optional(),
    redactNetworkHeaders: booleanSchema.optional(),
    maxNavigationSaved: zod.coerce.number().int().min(1).max(25).optional(),

    screenshotFormat: screenshotFormatSchema.optional(),
    screenshotQuality: zod.coerce.number().min(0).max(100).optional(),
    screenshotMaxWidth: positiveIntSchema.optional(),
    screenshotMaxHeight: positiveIntSchema.optional(),

    logFile: optionalStringSchema.optional(),
    experimentalDevtools: booleanSchema.optional(),
    experimentalVision: booleanSchema.optional(),
    memoryDebugging: booleanSchema.optional(),
    experimentalMemory: booleanSchema.optional(),
    experimentalIncludeAllPages: booleanSchema.optional(),
    experimentalScreencast: booleanSchema.optional(),
    experimentalFfmpegPath: optionalStringSchema.optional(),
    screencastFps: positiveIntSchema.optional(),
    experimentalScreencastFps: positiveIntSchema.optional(),
    performanceCrux: booleanSchema.optional(),
    usageStatistics: booleanSchema.optional(),
    javascriptEvaluation: booleanSchema.optional(),
    fileNavigations: booleanSchema.optional(),
    sourceMaps: booleanSchema.optional(),
    allowUnrestrictedPaths: booleanSchema.optional(),
    workspace: stringArraySchema.optional(),
    filesystemRoot: stringArraySchema.optional(),
  })
  .strip();

export type BrowserConfig = zodType.infer<typeof BrowserConfigSchema>;

export const ToolResultRecordingConfigSchema = zod
  .object({
    enabled: booleanSchema.optional(),
    outputDir: optionalStringSchema.optional(),
  })
  .strip();

export type ToolResultRecordingConfig = zodType.infer<
  typeof ToolResultRecordingConfigSchema
>;

export const GlobalConfigSchema = zod
  .object({
    autoConnect: booleanSchema.optional(),
    browserUrl: optionalStringSchema.optional(),
    wsEndpoint: optionalStringSchema.optional(),
    headless: booleanSchema.optional(),
    executablePath: optionalStringSchema.optional(),
    userDataDir: optionalStringSchema.optional(),
    /** `--cloak` CLI flag：启用 CloakBrowser + 49 C++ patch + cloak-profile。 */
    cloak: booleanSchema.optional(),
    /** `--js-stealth` CLI flag：opt-in StealthScripts2025 JS 注入。 */
    jsStealth: booleanSchema.optional(),
    /** `--full-stealth-args` CLI flag：回退到历史 60+ 启动参数集。 */
    fullStealthArgs: booleanSchema.optional(),
    minimalStealth: booleanSchema.optional(),
    runtimeDirName: optionalStringSchema.optional(),
    browser: BrowserConfigSchema.optional(),
    debug: booleanSchema.optional(),
    logLevel: optionalStringSchema.optional(),
    outputDir: optionalStringSchema.optional(),
    toolResultRecording: ToolResultRecordingConfigSchema.optional(),

    // 工具分类开关 (Category flags)
    categoryInput: booleanSchema.optional(),
    categoryNavigation: booleanSchema.optional(),
    categoryEmulation: booleanSchema.optional(),
    categoryPerformance: booleanSchema.optional(),
    categoryNetwork: booleanSchema.optional(),
    categoryDebugging: booleanSchema.optional(),
    categoryExtensions: booleanSchema.optional(),
    categoryExperimentalThirdParty: booleanSchema.optional(),
    categoryMemory: booleanSchema.optional(),
    categoryExperimentalWebmcp: booleanSchema.optional(),
    categoryPwa: booleanSchema.optional(),

    // 浏览器启动与网络连接扩展
    channel: optionalStringSchema.optional(),
    isolated: booleanSchema.optional(),
    acceptInsecureCerts: booleanSchema.optional(),
    wsHeaders: zod.preprocess(value => {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
    }, zod.record(zod.string()).optional()),
    proxyServer: optionalStringSchema.optional(),
    chromeArg: stringArraySchema.optional(),
    ignoreDefaultChromeArg: stringArraySchema.optional(),
    blockedUrlPattern: stringArraySchema.optional(),
    allowedUrlPattern: stringArraySchema.optional(),
    redactNetworkHeaders: booleanSchema.optional(),
    maxNavigationSaved: zod.coerce.number().int().min(1).max(25).optional(),

    // 截图与视觉
    screenshotFormat: screenshotFormatSchema.optional(),
    screenshotQuality: zod.coerce.number().min(0).max(100).optional(),
    screenshotMaxWidth: positiveIntSchema.optional(),
    screenshotMaxHeight: positiveIntSchema.optional(),
    experimentalVision: booleanSchema.optional(),

    // 调试、日志与实验特性
    logFile: optionalStringSchema.optional(),
    experimentalDevtools: booleanSchema.optional(),
    memoryDebugging: booleanSchema.optional(),
    experimentalMemory: booleanSchema.optional(),
    experimentalIncludeAllPages: booleanSchema.optional(),
    experimentalScreencast: booleanSchema.optional(),
    experimentalFfmpegPath: optionalStringSchema.optional(),
    screencastFps: positiveIntSchema.optional(),
    experimentalScreencastFps: positiveIntSchema.optional(),
    performanceCrux: booleanSchema.optional(),
    usageStatistics: booleanSchema.optional(),
    javascriptEvaluation: booleanSchema.optional(),
    fileNavigations: booleanSchema.optional(),
    sourceMaps: booleanSchema.optional(),

    // 文件系统与工作区
    allowUnrestrictedPaths: booleanSchema.optional(),
    workspace: stringArraySchema.optional(),
    filesystemRoot: stringArraySchema.optional(),

    // 配置文件与监听
    config: optionalStringSchema.optional(),
    watchConfig: booleanSchema.optional(),
  })
  .strip();

export type GlobalConfig = zodType.infer<typeof GlobalConfigSchema>;

export const SystemConfigSchema = zod
  .object({
    browser: BrowserConfigSchema,
    debug: zod.boolean().optional(),
  })
  .strip();

export type SystemConfig = zodType.infer<typeof SystemConfigSchema>;

export function formatConfigValidationError(error: zodType.ZodError): string {
  const details = error.issues
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    })
    .join('; ');

  return `Invalid configuration: ${details}`;
}

export function validateGlobalConfig(config: unknown): GlobalConfig {
  const result = GlobalConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(formatConfigValidationError(result.error));
  }
  return result.data;
}

export function validateSystemConfig(config: unknown): SystemConfig {
  const result = SystemConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(formatConfigValidationError(result.error));
  }
  return result.data;
}
