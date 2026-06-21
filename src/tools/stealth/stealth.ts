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
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 注入反检测隐身脚本。
 */
export const injectStealth = defineTool({
  name: 'inject_stealth',
  description:
    'Inject anti-detection stealth scripts (hide webdriver, mock chrome, canvas noise, etc.)',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    preset: zod.string().optional().describe('Stealth preset name'),
  },
  handler: async (request, response, context) => {
    const preset = request.params.preset as StealthPreset | undefined;
    try {
      const page = context.getSelectedPage();
      const report = await StealthScripts2025.injectAll(page, {preset});
      response.setStructuredContent({
        success: true,
        message: `Stealth scripts injected: ${report.injectedFeatures.length} features`,
        tooltype: 'inject_stealth',
        data: report,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `注入失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'inject_stealth',
      });
    }
  },
});

/**
 * 列出可用的隐身预设。
 */
export const listStealthPresets = defineTool({
  name: 'list_stealth_presets',
  description: 'List available stealth presets',
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
  description: 'List available stealth features',
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
  description: 'Set custom User-Agent for the current page via CDP',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    userAgent: zod.string().describe('Custom User-Agent string'),
  },
  handler: async (request, response, context) => {
    const {userAgent} = request.params;
    try {
      const page = context.getSelectedPage();
      const client = await page.context().newCDPSession(page);
      await client.send('Network.setUserAgentOverride', {userAgent});
      response.setStructuredContent({
        success: true,
        message: 'User-Agent updated.',
        tooltype: 'set_user_agent',
        data: {userAgent},
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `设置失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'set_user_agent',
      });
    }
  },
});

/** 重新导出类型 */
export type {StealthInjectionOptions, StealthPreset, StealthReport};
