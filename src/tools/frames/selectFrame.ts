/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

import type {ToolContextProvider} from '../../worker/ToolContextProvider.js';

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
        response.appendResponseLine('没有可用的页面，请先导航到目标页面');
        return;
      }

      const frames = page.frames();

      if (frameIdx >= frames.length) {
        response.appendResponseLine(
          `Invalid frame index ${frameIdx}. Use list_frames to see available frames (0-${frames.length - 1}).`,
        );
        return;
      }

      const frame = frames[frameIdx];
      if (frameIdx === 0) {
        runtime.setSelectedFrame(null);
        response.appendResponseLine('Switched to main frame.');
        return;
      }

      runtime.setSelectedFrame(frame);
      const name = frame.name() ? ` (name: "${frame.name()}")` : '';
      response.appendResponseLine(
        `Switched to frame ${frameIdx}: ${frame.url()}${name}`,
      );
    } catch (error) {
      response.appendResponseLine(
        `选择 Frame 失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
