/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 解决 DevTools 评论线程并追加 Agent 回复 — 契约占位实现（同 get_devtools_comments）。
 *
 * 桥接不可用时按仓库失败语义抛 NATIVE_TOOL_MISSING，schema/annotations 契约保持不变。
 */
export const resolveDevtoolsComment = defineTool({
  name: 'resolve_devtools_comment',
  description:
    '向 DevTools 评论线程追加回复并标记已解决（CD4A）。当前 DevTools 前端未内置桥接，调用将抛出 NATIVE_TOOL_MISSING 提示。',
  annotations: {
    title: '解决DevTools评论',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    threadId: zod.string().describe('评论线程 ID（如 "comment-1"）。'),
    replyText: zod.string().optional().describe('可选的回复说明文本。'),
  },
  handler: async (request, _response) => {
    const {threadId} = request.params;
    throw createToolError(
      ErrorCodes.NATIVE_TOOL_MISSING,
      `当前 DevTools 前端不支持 CD4A 评论桥接，无法解决线程 ${threadId}（window.universe.cd4aBridge 不可用）。`,
      {toolName: 'resolve_devtools_comment', threadId},
    );
  },
});
