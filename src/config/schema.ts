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
    /**
     * 使用正在运行的 ego lite 浏览器（经 `EgoBridgeManager` 的本地 CDP 桥接）。
     * 与 `cloak` 同类：一个互斥的浏览器来源开关，而不是 `channel` 值。
     * 本 schema 用 `.strip()`，不在这里声明就会被**静默丢弃**。CLI flag 与环境变量
     * 接线（`--browser ego` / `BROWSER_EGO`）仍属 Task 4。
     */
    ego: booleanSchema.optional(),
    /** 使用历史 60+ 启动参数集（`FULL_STEALTH_ARGS`）。默认 false：其中多个 flag 已是反爬检测信号。 */
    fullStealthArgs: booleanSchema.optional(),
    /** 启用最小启动参数集（`MINIMAL_STEALTH_ARGS`：`--test-type` + `--hide-crash-restore-bubble`）。默认 true。 */
    minimalStealth: booleanSchema.optional(),
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
    browserUrl: optionalStringSchema.optional(),
    wsEndpoint: optionalStringSchema.optional(),
    headless: booleanSchema.optional(),
    executablePath: optionalStringSchema.optional(),
    /** `--cloak` CLI flag：启用 CloakBrowser + 49 C++ patch + cloak-profile。 */
    cloak: booleanSchema.optional(),
    /** `--js-stealth` CLI flag：opt-in StealthScripts2025 JS 注入。 */
    jsStealth: booleanSchema.optional(),
    /** `--full-stealth-args` CLI flag：回退到历史 60+ 启动参数集。 */
    fullStealthArgs: booleanSchema.optional(),
    runtimeDirName: optionalStringSchema.optional(),
    browser: BrowserConfigSchema.optional(),
    debug: booleanSchema.optional(),
    logLevel: optionalStringSchema.optional(),
    outputDir: optionalStringSchema.optional(),
    toolResultRecording: ToolResultRecordingConfigSchema.optional(),
    sessionStateTtlMs: positiveIntSchema.optional(),
    sessionStateCleanupIntervalMs: positiveIntSchema.optional(),
    sessionStateEncryptionKey: optionalStringSchema.optional(),
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
