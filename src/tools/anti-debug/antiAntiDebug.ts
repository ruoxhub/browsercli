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

/**
 * 反反调试工具集：窗口尺寸/时间函数/页面关闭/历史跳转/控制台清除/隐藏 webdriver。
 */
export const antiAntiDebug = defineTool({
  name: 'anti_anti_debug',
  description:
    'Anti-anti-debug toolkit: fix window size, freeze time, block page close, block history navigation, block console clear, hide webdriver flag.',
  annotations: {
    title: 'Anti Anti-Debug',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    features: zod
      .array(antiAntiDebugFeatureSchema)
      .min(1)
      .describe(
        'Features to enable. Options: fixedWindowSize, fixedTime, preventClose, preventHistoryBack, preventConsoleClear, hideWebdriver',
      ),
  },
  handler: async (request, response, context) => {
    const {features} = request.params;

    if (features.length === 0) {
      response.setStructuredContent({
        success: false,
        message:
          'anti_anti_debug requires a non-empty "features" array (e.g. ["fixedWindowSize", "hideWebdriver"])',
        tooltype: ANTI_ANTI_DEBUG_TOOLTYPE,
        data: null,
      });
      return;
    }

    await runHook(response, ANTI_ANTI_DEBUG_TOOLTYPE, async () => {
      const frame = (context as Context).getSelectedFrame();
      await frame.evaluate(buildAntiAntiDebugScript(features));
      return `Anti-Anti-Debug 已安装，启用功能：${features.join(', ')}（共 ${features.length} 项）`;
    });
  },
});
