/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import type {ToolContextProvider} from '../../worker/ToolContextProvider.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 按索引选择页面中的 Frame，将执行上下文切换到该 Frame。
 */
export const selectFrame = defineTool({
  name: 'select_frame',
  description:
    'Selects a frame (by index from list_frames) as the execution context for evaluate_script, hook_function, inspect_object, and other tools that run JavaScript in the page.',
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
    const runtime = context as unknown as ToolContextProvider;
    const {frameIdx} = request.params;

    try {
      const page = runtime.getSelectedPage();
      if (!page) {
        response.setStructuredContent({
          success: false,
          message: '没有可用的页面，请先导航到目标页面',
          toolType: 'select_frame',
          data: {},
        });
        return;
      }

      const frames = page.frames();

      if (frameIdx >= frames.length) {
        response.setStructuredContent({
          success: false,
          message: `Invalid frame index ${frameIdx}. Use list_frames to see available frames (0-${frames.length - 1}).`,
          toolType: 'select_frame',
          data: {},
        });
        return;
      }

      const frame = frames[frameIdx];
      if (frameIdx === 0) {
        runtime.setSelectedFrame(null);
        response.setStructuredContent({
          success: true,
          message: 'Switched to main frame.',
          toolType: 'select_frame',
          data: {selectedIndex: 0, selectedName: undefined},
        });
        return;
      }

      runtime.setSelectedFrame(frame);
      const name = frame.name() || undefined;
      response.setStructuredContent({
        success: true,
        message: `Switched to frame ${frameIdx}: ${frame.url()}${name ? ` (name: "${name}")` : ''}`,
        toolType: 'select_frame',
        data: {selectedIndex: frameIdx, selectedName: name},
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `选择 Frame 失败：${error instanceof Error ? error.message : String(error)}`,
        toolType: 'select_frame',
        data: {},
      });
    }
  },
});
