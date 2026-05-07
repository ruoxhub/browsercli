/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

/**
 * 通过 CDP 设置文件输入框的文件列表。
 */
export const setFiles = defineTool({
  name: 'set_files',
  description:
    'Set files on a file input element using CDP DOM.setFileInputFiles. Useful when Playwright setInputFiles is blocked.',
  annotations: {
    title: '设置文件',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('CSS 选择器（file input 元素）。'),
    filePaths: zod
      .array(zod.string())
      .describe('文件绝对路径列表。'),
  },
  handler: async (request, response, context) => {
    const {selector, filePaths} = request.params;
    const frame = (context as Context).getSelectedFrame();
    const page = frame.page();

    try {
      const client = await page.context().newCDPSession(page);

      await client.send('DOM.enable', {});

      const doc = await client.send('DOM.getDocument', {});

      const node = await client.send('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector,
      });

      if (!node.nodeId) {
        response.setStructuredContent({
          success: false,
          message: `Element not found: ${selector}`,
          tooltype: 'set_files',
          data: {files: 0},
        });
        return;
      }

      await client.send('DOM.setFileInputFiles', {
        nodeId: node.nodeId,
        files: filePaths,
      });

      response.setStructuredContent({
        success: true,
        message: `Set ${filePaths.length} file(s) to ${selector}`,
        tooltype: 'set_files',
        data: {files: filePaths.length, filePaths},
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: error instanceof Error ? error.message : String(error),
        tooltype: 'set_files',
        data: {files: 0},
      });
    }
  },
});
