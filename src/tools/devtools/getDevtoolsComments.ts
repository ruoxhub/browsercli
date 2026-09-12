/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

const CD4A_BRIDGE_MISSING_MESSAGE =
  '当前 DevTools 前端不支持 CD4A 评论桥接（window.universe.cd4aBridge 不可用）。需要定制版 devtools-frontend 提供该 API 后此工具才会生效。';

/**
 * 读取 DevTools 窗口中的 CD4A 评论线程 — 契约占位实现。
 *
 * 上游 chrome-devtools-mcp 依赖定制 DevTools 前端注入的
 * window.universe.cd4aBridge（实测原版 DevTools 窗口中为 undefined）。
 * 本工具保留 schema/annotations 契约；桥接不可用时按仓库失败语义抛
 * NATIVE_TOOL_MISSING（src/tools 禁止以失败内容伪装成功响应），等
 * Chrome 上游提供桥接 API 后补齐实现。
 */
export const getDevtoolsComments = defineTool({
  name: 'get_devtools_comments',
  description:
    '读取 DevTools 窗口中针对当前页面的用户评论线程（CD4A）。当前 DevTools 前端未内置 CD4A 桥接，返回不支持提示。',
  annotations: {
    title: '读取DevTools评论',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, _response) => {
    throw createToolError(
      ErrorCodes.NATIVE_TOOL_MISSING,
      CD4A_BRIDGE_MISSING_MESSAGE,
      {
        toolName: 'get_devtools_comments',
      },
    );
  },
});
