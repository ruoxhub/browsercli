/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StealthInjectionOptions,
  StealthPreset,
  StealthReport,
} from '../../modules/stealth/StealthScripts2025.js';
import {StealthScripts2025} from '../../modules/stealth/StealthScripts2025.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 注入反检测隐身脚本。
 */
export const injectStealth = defineTool({
  name: 'inject_stealth',
  description:
    '注入反检测隐身脚本（隐藏 webdriver、伪装 chrome、canvas 噪点等）',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    preset: zod.string().optional().describe('隐身预设名称'),
  },
  handler: async (request, response, context) => {
    const preset = request.params.preset as StealthPreset | undefined;
    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '未选中页面，请先使用 select_page 选择目标页面。',
        {toolName: 'inject_stealth'},
      );
    }
    try {
      const report = await StealthScripts2025.injectAll(page, {preset});
      const featureCount = report?.injectedFeatures?.length ?? 0;
      response.setStructuredContent({
        success: true,
        message: `Stealth scripts injected: ${featureCount} features`,
        tooltype: 'inject_stealth',
        data: report,
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `注入失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'inject_stealth'},
      );
    }
  },
});

/**
 * 列出可用的隐身预设。
 */
export const listStealthPresets = defineTool({
  name: 'list_stealth_presets',
  description: '列出可用的隐身预设',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {},
  handler: async (_request, response, _context) => {
    response.setStructuredContent({
      success: true,
      message: 'Available stealth presets',
      tooltype: 'list_stealth_presets',
      data: {presets: StealthScripts2025.getPresets()},
    });
  },
});

/**
 * 列出可用的隐身特性开关。
 */
export const listStealthFeatures = defineTool({
  name: 'list_stealth_features',
  description: '列出可用的隐身特性开关',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {},
  handler: async (_request, response, _context) => {
    response.setStructuredContent({
      success: true,
      message: 'Available stealth features',
      tooltype: 'list_stealth_features',
      data: {
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
      },
    });
  },
});

/**
 * 设置自定义 User-Agent。
 */
export const setUserAgent = defineTool({
  name: 'set_user_agent',
  description: '通过 CDP 为当前页面设置自定义 User-Agent',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    userAgent: zod.string().describe('自定义 User-Agent 字符串'),
  },
  handler: async (request, response, context) => {
    const {userAgent} = request.params;
    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '未选中页面，请先使用 select_page 选择目标页面。',
        {toolName: 'set_user_agent'},
      );
    }
    try {
      const client = await page.context().newCDPSession(page);
      await client.send('Network.setUserAgentOverride', {userAgent});
      response.setStructuredContent({
        success: true,
        message: 'User-Agent updated.',
        tooltype: 'set_user_agent',
        data: {userAgent},
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `设置失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'set_user_agent'},
      );
    }
  },
});

/** 重新导出类型 */
export type {StealthInjectionOptions, StealthPreset, StealthReport};
