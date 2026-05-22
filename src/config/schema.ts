/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 *
 * Runtime configuration schemas.
 */

import type {zod as zodType} from '../third_party/index.js';
import {zod} from '../third_party/index.js';

const nonEmptyStringSchema = zod.string().min(1);

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

export const LLMProviderSchema = zod.enum(['openai', 'gemini', 'anthropic'], {
  errorMap: () => ({message: 'must be one of: openai, gemini, anthropic'}),
});

export const OpenAIConfigSchema = zod
  .object({
    apiKey: optionalStringSchema.optional(),
    baseURL: optionalStringSchema.optional(),
    model: optionalStringSchema.optional(),
  })
  .strip();

export const BrowserConfigSchema = zod
  .object({
    headless: booleanSchema.optional(),
    isolated: booleanSchema.optional(),
    executablePath: optionalStringSchema.optional(),
    channel: zod
      .enum([
        'stable',
        'beta',
        'dev',
        'canary',
        'chrome',
        'chrome-beta',
        'chrome-dev',
        'chrome-canary',
      ])
      .transform(channel => {
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
    rpcHost: optionalStringSchema.optional(),
    group: optionalStringSchema.optional(),
    browserUrl: optionalStringSchema.optional(),
    wsEndpoint: optionalStringSchema.optional(),
    headless: booleanSchema.optional(),
    executablePath: optionalStringSchema.optional(),
    databaseUrl: optionalStringSchema.optional(),
    runtimeDirName: optionalStringSchema.optional(),
    llmProvider: LLMProviderSchema.optional(),
    openai: OpenAIConfigSchema.optional(),
    browser: BrowserConfigSchema.optional(),
    debug: booleanSchema.optional(),
    logLevel: optionalStringSchema.optional(),
    outputDir: optionalStringSchema.optional(),
    toolResultRecording: ToolResultRecordingConfigSchema.optional(),
    sessionStateTtlMs: positiveIntSchema.optional(),
    sessionStateCleanupIntervalMs: positiveIntSchema.optional(),
    sessionStateEncryptionKey: optionalStringSchema.optional(),
  })
  .strip()
  .superRefine((config, ctx) => {
    if (config.llmProvider === 'openai' && config.openai?.apiKey === '') {
      ctx.addIssue({
        code: zod.ZodIssueCode.custom,
        path: ['openai', 'apiKey'],
        message: 'must not be empty when llmProvider is openai',
      });
    }
  });

export type GlobalConfig = zodType.infer<typeof GlobalConfigSchema>;

export const AIConfigSchema = zod
  .object({
    provider: LLMProviderSchema,
    openai: zod
      .object({
        apiKey: nonEmptyStringSchema,
        baseURL: optionalStringSchema.optional(),
        model: optionalStringSchema.optional(),
      })
      .strip()
      .optional(),
  })
  .strip()
  .superRefine((config, ctx) => {
    if (config.provider === 'openai' && !config.openai) {
      ctx.addIssue({
        code: zod.ZodIssueCode.custom,
        path: ['openai'],
        message: 'is required when provider is openai',
      });
    }
  });

export type AIConfig = zodType.infer<typeof AIConfigSchema>;

export const SystemConfigSchema = zod
  .object({
    ai: AIConfigSchema.optional(),
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
