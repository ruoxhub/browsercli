/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {globalInteractionRecorder} from '../../modules/recorder/InteractionRecorder.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

export const recordStart = defineTool({
  name: 'record_start',
  description:
    '启动用户交互轨迹录制器。在当前活动页面注入监听，实时捕获点击、输入、改动等行为，准备与网络请求关联沉淀 Operation Evidence。',
  annotations: {
    title: '开始轨迹录制',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
    requirements: {
      browser: 'connected',
      page: 'selected',
    },
  },
  schema: {},
  handler: async (_request, response, context) => {
    const page = (context as Context).getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '当前没有活动的页面，请先调用 new_page 或 select_page。',
        {toolName: 'record_start'},
      );
    }

    try {
      const recordingId = await globalInteractionRecorder.start(page);
      response.appendResponseLine(
        `交互轨迹录制已成功启动（ID: ${recordingId}）。`,
      );
      response.setStructuredContent({
        success: true,
        recordingId,
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `启动录制失败: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'record_start'},
      );
    }
  },
});

export const recordStop = defineTool({
  name: 'record_stop',
  description:
    '停止用户交互轨迹录制器，提取记录的所有用户点击/输入步骤，并与捕获的网络因果请求关联输出 Operation Evidence。',
  annotations: {
    title: '停止轨迹录制',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
    requirements: {
      browser: 'connected',
      page: 'selected',
    },
  },
  schema: {},
  handler: async (_request, response, _context) => {
    try {
      const evidence = await globalInteractionRecorder.stop();
      response.appendResponseLine(
        `录制已停止（ID: ${evidence.recordingId}，共记录 ${evidence.interactions.length} 个交互动作，关联 ${evidence.correlatedNetwork.length} 个网络请求）：`,
      );
      response.setStructuredContent({
        success: true,
        evidence,
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `停止录制失败: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'record_stop'},
      );
    }
  },
});
