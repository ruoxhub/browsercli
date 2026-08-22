/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import type {ToolContextProvider} from '../../worker/ToolContext.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 计算 Frame 的嵌套深度。
 */
function getFrameDepth(frame: Frame): number {
  let depth = 0;
  let parent = frame.parentFrame();
  while (parent) {
    depth += 1;
    parent = parent.parentFrame();
  }
  return depth;
}

/**
 * 列出页面中所有 Frame（包括 iframe）。
 */
export const listFrames = defineTool({
  name: 'list_frames',
  description:
    '以树形结构列出当前页面中的所有 Frame（含 iframe），显示索引、名称与 URL。使用 select_frame 可将执行上下文切换到指定 Frame。',
  annotations: {
    title: '列出 Frame',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response, context) => {
    const runtime = context as unknown as ToolContextProvider;

    const page = runtime.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '没有可用的页面，请先导航到目标页面',
        {toolName: 'list_frames'},
      );
    }

    try {
      const frames = page.frames();
      const currentFrame = runtime.getSelectedFrame();

      if (frames.length === 0) {
        response.setStructuredContent({
          success: true,
          message: 'No frames found.',
          toolType: 'list_frames',
          data: {frameInfos: [], selectedIndex: -1},
        });
        return;
      }

      const selectedIndex = currentFrame ? frames.indexOf(currentFrame) : -1;

      const frameInfos = frames.map((frame, i) => ({
        index: i,
        url: frame.url() || '',
        name: frame.name() || undefined,
        depth: getFrameDepth(frame),
        selected: i === selectedIndex,
      }));

      response.setStructuredContent({
        success: true,
        message: `Frames (${frames.length} total)`,
        toolType: 'list_frames',
        data: {frameInfos, selectedIndex},
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `列出 Frame 失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'list_frames'},
      );
    }
  },
});
