/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from 'puppeteer';

import type {StealthInjectionOptions, StealthPreset, StealthReport} from '../../modules/stealth/StealthScripts2025.js';
import {StealthScripts2025} from '../../modules/stealth/StealthScripts2025.js';

/** Stealth 操作统一返回结构 */
export interface StealthResult {
  success: boolean;
  message: string;
  tooltype: string;
  logFormat?: string;
}

/** 注入隐身脚本结果 */
export interface InjectStealthResult extends StealthResult {
  tooltype: 'inject_stealth';
  report?: StealthReport;
}

/** 列出预设结果 */
export interface ListPresetsResult extends StealthResult {
  tooltype: 'list_stealth_presets';
  presets: Array<{name: StealthPreset; userAgent: string; platform: string}>;
}

/** 列出特性结果 */
export interface ListFeaturesResult extends StealthResult {
  tooltype: 'list_stealth_features';
  features: string[];
}

/** 设置 UA 结果 */
export interface SetUserAgentResult extends StealthResult {
  tooltype: 'set_user_agent';
}

/**
 * 注入反检测隐身脚本。
 *
 * @param page - Puppeteer Page 对象
 * @param preset - 平台预设名称
 * @returns 结构化结果对象
 */
export async function injectStealth(
  page: Page,
  preset?: StealthPreset,
): Promise<InjectStealthResult> {
  try {
    const report = await StealthScripts2025.injectAll(page, {preset});
    return {
      success: true,
      message: `Stealth scripts injected: ${report.injectedFeatures.length} features`,
      tooltype: 'inject_stealth',
      report,
    };
  } catch (error) {
    return {
      success: false,
      message: `注入失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'inject_stealth',
    };
  }
}

/**
 * 列出可用的隐身预设。
 *
 * 纯函数：不依赖 Puppeteer，可直接在 Node.js 调用。
 */
export function listStealthPresets(): ListPresetsResult {
  return {
    success: true,
    message: 'Available stealth presets',
    tooltype: 'list_stealth_presets',
    presets: StealthScripts2025.getPresets(),
  };
}

/**
 * 列出可用的隐身特性开关。
 *
 * 纯函数：不依赖 Puppeteer，可直接在 Node.js 调用。
 */
export function listStealthFeatures(): ListFeaturesResult {
  return {
    success: true,
    message: 'Available stealth features',
    tooltype: 'list_stealth_features',
    features: [
      'hideWebDriver',
      'mockChrome',
      'setUserAgent',
      'fixPermissions',
      'mockPlugins',
      'canvasNoise',
      'webglOverride',
      'audioContextNoise',
      'fixLanguages',
      'mockBattery',
      'mockMediaDevices',
      'mockNotifications',
      'mockConnection',
      'focusOverride',
      'performanceNoise',
      'overrideScreen',
    ],
  };
}

/**
 * 设置自定义 User-Agent。
 *
 * @param page - Puppeteer Page 对象
 * @param userAgent - 自定义 UA 字符串
 * @returns 结构化结果对象
 */
export async function setUserAgent(
  page: Page,
  userAgent: string,
): Promise<SetUserAgentResult> {
  try {
    await page.setUserAgent(userAgent);
    return {
      success: true,
      message: 'User-Agent updated.',
      tooltype: 'set_user_agent',
    };
  } catch (error) {
    return {
      success: false,
      message: `设置失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'set_user_agent',
    };
  }
}

/** 重新导出类型 */
export type {StealthInjectionOptions, StealthPreset, StealthReport};
