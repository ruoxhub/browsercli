/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {withCdpSession} from '../../modules/browser/cdpUtils.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 通过 CDP 设置文件输入框的文件列表。
 */
export const setFiles = defineTool({
  name: 'set_files',
  description:
    '使用 CDP DOM.setFileInputFiles 为 file input 元素设置文件，适用于 Playwright setInputFiles 被拦截的场景。',
  annotations: {
    title: '设置文件',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe('仅支持 CSS 选择器（CDP DOM.querySelector 限制，不支持 role=/text=/xpath=）。'),
    filePaths: zod.array(zod.string()).describe('文件绝对路径列表。'),
  },
  handler: async (request, response, context) => {
    const {selector, filePaths} = request.params;
    const frame = (context as Context).getSelectedFrame();
    const page = frame.page();

    try {
      await withCdpSession(page, async client => {
        await client.send('DOM.enable', {});

        const doc = await client.send('DOM.getDocument', {});

        const node = await client.send('DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector,
        });

        if (!node.nodeId) {
          throw createToolError(
            ErrorCodes.NOT_FOUND,
            `Element not found: ${selector}`,
            {toolName: 'set_files', selector},
          );
        }

        await client.send('DOM.setFileInputFiles', {
          nodeId: node.nodeId,
          files: filePaths,
        });
      });

      response.setStructuredContent({
        success: true,
        message: `Set ${filePaths.length} file(s) to ${selector}`,
        tooltype: 'set_files',
        data: {files: filePaths.length, filePaths},
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        error instanceof Error ? error.message : String(error),
        {toolName: 'set_files', selector},
      );
    }
  },
});
