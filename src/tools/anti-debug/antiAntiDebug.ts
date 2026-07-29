/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {buildAntiAntiDebugScript} from './hooks.js';
import {runHook} from './result.js';
import {
  antiAntiDebugFeatureSchema,
  ANTI_ANTI_DEBUG_TOOLTYPE,
} from './schema.js';
import type {AntiAntiDebugFeature} from './types.js';

/** 默认启用全部反反调试特性（在 features 未显式传入时使用）。 */
const ALL_ANTI_ANTI_DEBUG_FEATURES: AntiAntiDebugFeature[] = [
  'fixedWindowSize',
  'fixedTime',
  'preventClose',
  'preventHistoryBack',
  'preventConsoleClear',
  'hideWebdriver',
];

/**
 * 反反调试工具集：窗口尺寸/时间函数/页面关闭/历史跳转/控制台清除/隐藏 webdriver。
 */
export const antiAntiDebug = defineTool({
  name: 'anti_anti_debug',
  description:
    '反反调试工具集：固定窗口尺寸、冻结时间、阻止页面关闭、阻止历史导航、阻止控制台清除、隐藏 webdriver 标记。',
  annotations: {
    title: 'Anti Anti-Debug',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    features: zod
      .array(antiAntiDebugFeatureSchema)
      .optional()
      .describe(
        '要启用的功能。可选：fixedWindowSize、fixedTime、preventClose、preventHistoryBack、preventConsoleClear、hideWebdriver。省略时启用全部。',
      ),
  },
  handler: async (request, response, context) => {
    const features = request.params.features ?? ALL_ANTI_ANTI_DEBUG_FEATURES;

    await runHook(response, ANTI_ANTI_DEBUG_TOOLTYPE, async () => {
      const frame = (context as Context).getSelectedFrame();
      await frame.evaluate(buildAntiAntiDebugScript(features));
      return `Anti-Anti-Debug 已安装，启用功能：${features.join(', ')}（共 ${features.length} 项）`;
    });
  },
});
