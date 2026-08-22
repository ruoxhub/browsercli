/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 上传文件到 file input 元素，支持 Playwright 原生和 filechooser 回退。
 */
export const uploadFile = defineTool({
  name: 'upload_file',
  description:
    '向 file input 元素上传文件，优先使用 Playwright setInputFiles，失败则回退到 filechooser 事件模式。',
  annotations: {
    title: '上传文件',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('CSS 选择器（file input 元素）。'),
    filePath: zod.string().describe('文件绝对路径。'),
  },
  handler: async (request, response, context) => {
    const {selector, filePath} = request.params;
    const frame = (context as Context).getSelectedFrame();
    const page = frame.page();

    try {
      const element = await page.$(selector);
      if (!element) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `Element not found: ${selector}`,
          {toolName: 'upload_file', selector},
        );
      }

      try {
        await element.setInputFiles(filePath);
        response.setStructuredContent({
          success: true,
          message: `File uploaded from ${filePath}`,
          tooltype: 'upload_file',
          data: {selector, filePath},
        });
      } catch {
        // Fallback: try filechooser event pattern
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', {timeout: 3000}),
          element.click(),
        ]);
        await fileChooser.setFiles(filePath);
        response.setStructuredContent({
          success: true,
          message: `File uploaded from ${filePath}`,
          tooltype: 'upload_file',
          data: {selector, filePath, fallback: true},
        });
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        error instanceof Error ? error.message : String(error),
        {toolName: 'upload_file', selector, filePath},
      );
    }
  },
});
