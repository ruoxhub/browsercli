/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {globalPageSnapshotManager} from '../../modules/snapshot/PageSnapshotManager.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

export const takeSnapshot = defineTool({
  name: 'take_snapshot',
  description:
    '获取当前页面的紧凑无障碍语义快照（TextSnapshot）。为每个交互控件分配数字 UID（如 1_4），可直接用于 click、fill、hover 等操作，Token 开销极低且免疫动态 Class 混淆。',
  annotations: {
    title: '获取页面语义快照',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
    requirements: {
      browser: 'connected',
      page: 'selected',
    },
  },
  schema: {
    verbose: zod
      .boolean()
      .optional()
      .describe('是否输出详细节点属性（如 description 等），默认 false。'),
    interestingOnly: zod
      .boolean()
      .optional()
      .describe('是否仅包含有可访问性或交互价值的节点，默认 true。'),
  },
  handler: async (request, response, context) => {
    const {verbose = false, interestingOnly = true} = request.params;
    const page = (context as Context).getSelectedPage();

    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '当前没有活动的页面，请先调用 new_page 或 select_page。',
        {toolName: 'take_snapshot'},
      );
    }

    try {
      const snapshot = await globalPageSnapshotManager.capture(page, {
        verbose,
        interestingOnly,
      });

      response.appendResponseLine(
        `页面快照捕获成功（快照 ID: ${snapshot.snapshotId}，共 ${snapshot.nodeCount} 个节点）：`,
      );
      response.appendResponseLine(snapshot.formattedText);

      response.setStructuredContent({
        success: true,
        snapshotId: snapshot.snapshotId,
        nodeCount: snapshot.nodeCount,
        textOutline: snapshot.formattedText,
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `获取页面语义快照失败: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'take_snapshot'},
      );
    }
  },
});
