/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

/**
 * 上传文件到 file input 元素，支持 Playwright 原生和 filechooser 回退。
 */
export const uploadFile = defineTool({
  name: 'upload_file',
  description:
    'Upload a file to a file input element. Tries Playwright setInputFiles first, then falls back to filechooser event pattern.',
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
        response.appendResponseLine(`Element not found: ${selector}`);
        return;
      }

      try {
        await element.setInputFiles(filePath);
        response.appendResponseLine(`File uploaded from ${filePath}`);
      } catch {
        // Fallback: try filechooser event pattern
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', {timeout: 3000}),
          element.click(),
        ]);
        await fileChooser.setFiles(filePath);
        response.appendResponseLine(`File uploaded from ${filePath}`);
      }
    } catch (error) {
      response.appendResponseLine(
        `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
