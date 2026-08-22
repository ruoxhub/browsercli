/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 按索引选择页面中的 Frame，将执行上下文切换到该 Frame。
 */
export const selectFrame = defineTool({
  name: 'select_frame',
  description:
    '选择一个 Frame（索引来自 list_frames）作为 evaluate_script、hook_function、inspect_object 等页面内 JavaScript 执行工具的运行上下文。',
  annotations: {
    title: '选择 Frame',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    frameIdx: zod
      .number()
      .int()
      .min(0)
      .describe('The frame index from list_frames. 0 = main frame.'),
  },
  handler: async (request, response, context) => {
    const {frameIdx} = request.params;

    // Context.getSelectedPage() 在未选中页面时返回 null（不抛异常），
    // 这里统一归一化为 null 以给出友好的“无页面”提示。
    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '没有可用的页面，请先导航到目标页面',
        {toolName: 'select_frame'},
      );
    }

    try {
      const frames = page.frames();

      if (frameIdx >= frames.length) {
        throw createToolError(
          ErrorCodes.VALIDATION,
          `Invalid frame index ${frameIdx}. Use list_frames to see available frames (0-${frames.length - 1}).`,
          {toolName: 'select_frame', frameIdx},
        );
      }

      const frame = frames[frameIdx];
      if (frameIdx === 0) {
        context.resetSelectedFrame();
        response.setStructuredContent({
          success: true,
          message: 'Switched to main frame.',
          toolType: 'select_frame',
          data: {selectedIndex: 0, selectedName: undefined},
        });
        return;
      }

      context.selectFrame(frame);
      const name = frame.name() || undefined;
      response.setStructuredContent({
        success: true,
        message: `Switched to frame ${frameIdx}: ${frame.url()}${name ? ` (name: "${name}")` : ''}`,
        toolType: 'select_frame',
        data: {selectedIndex: frameIdx, selectedName: name},
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `选择 Frame 失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'select_frame', frameIdx},
      );
    }
  },
});
