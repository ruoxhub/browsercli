/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';

import type {ToolContextProvider} from '../../worker/ToolContextProvider.js';

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
    'Lists all frames (including iframes) in the current page as a tree. Shows frame index, name, and URL. Use select_frame to switch execution context to a specific frame.',
  annotations: {
    title: '列出 Frame',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response, context) => {
    const runtime = context as unknown as ToolContextProvider;

    try {
      const page = runtime.getSelectedPage();
      if (!page) {
        response.appendResponseLine('没有可用的页面，请先导航到目标页面');
        return;
      }

      const frames = page.frames();
      const currentFrame = runtime.getSelectedFrame();

      if (frames.length === 0) {
        response.appendResponseLine('No frames found.');
        return;
      }

      response.appendResponseLine(`Frames (${frames.length} total):\n`);

      for (let i = 0; i < frames.length; i += 1) {
        const frame = frames[i];
        const indent = '  '.repeat(getFrameDepth(frame));
        const marker = frame === currentFrame ? ' [selected]' : '';
        const name = frame.name() ? ` name="${frame.name()}"` : '';
        response.appendResponseLine(
          `${indent}${i}: ${frame.url() || '(empty)'}${name}${marker}`,
        );
      }
    } catch (error) {
      response.appendResponseLine(
        `列出 Frame 失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
