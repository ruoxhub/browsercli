/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {type Frame, zod} from '../third_party/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';
import type {ToolContextProvider} from '../worker/ToolContext.js';

import {ToolCategory} from './categories.js';
import type {DomainManifest} from './manifest.js';
import {definePageTool} from './ToolDefinition.js';

// ─── types.ts ────────────────────────────────────────────

/** Frame 条目信息 */
export interface FrameInfo {
  /** 在 page.frames() 中的索引 */
  index: number;
  /** Frame URL */
  url: string;
  /** Frame name（可能为空） */
  name?: string;
  /** 嵌套深度（0 = 主 frame） */
  depth: number;
  /** 是否为当前选中的 Frame */
  selected?: boolean;
}

/** list_frames 返回的 data 结构 */
export interface ListFramesData {
  frameInfos: FrameInfo[];
  selectedIndex: number;
}

/** select_frame 返回的 data 结构 */
export interface SelectFrameData {
  selectedIndex: number;
  selectedName?: string;
}

// ─── listFrames.ts ───────────────────────────────────────

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
export const listFrames = definePageTool({
  name: 'list_frames',
  description:
    '以树形结构列出当前页面中的所有 Frame（含 iframe），显示索引、名称与 URL。使用 select_frame 可将执行上下文切换到指定 Frame。',
  annotations: {
    title: '列出 Frame',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    const runtime = context as unknown as ToolContextProvider;

    const page = request.page?.rawPage ?? runtime.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '没有可用的页面，请先导航到目标页面',
        {toolName: 'list_frames'},
      );
    }

    try {
      const frames = page.frames();
      const currentFrame =
        request.page?.getSelectedFrame() ?? runtime.getSelectedFrame();

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

// ─── selectFrame.ts ──────────────────────────────────────

/**
 * 按索引选择页面中的 Frame，将执行上下文切换到该 Frame。
 */
export const selectFrame = definePageTool({
  name: 'select_frame',
  description:
    '选择一个 Frame（索引来自 list_frames）作为 evaluate_script、create_hook、inspect_object 等页面内 JavaScript 执行工具的运行上下文。',
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

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'frames',
  description: 'Frame listing and selection tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './frames.js', handlerName: 'listFrames'},
    {modulePath: './frames.js', handlerName: 'selectFrame'},
  ],
} satisfies DomainManifest;
