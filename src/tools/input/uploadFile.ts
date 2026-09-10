/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {
  classifyElementError,
  toElementError,
} from '../shared/elementLocator.js';
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
    selector: zod
      .string()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
      ),
    filePath: zod.string().describe('文件绝对路径。'),
  },
  handler: async (request, response, context) => {
    const {selector, filePath} = request.params;
    const frame = (context as Context).getSelectedFrame();
    const page = frame.page();

    const loc = page.locator(selector);
    try {
      try {
        await loc.setInputFiles(filePath);
        response.setStructuredContent({
          success: true,
          message: `File uploaded from ${filePath}`,
          tooltype: 'upload_file',
          data: {selector, filePath},
        });
      } catch (innerError) {
        const classification = classifyElementError(innerError);
        if (classification.code === ErrorCodes.ELEMENT_LOCATOR_AMBIGUOUS) {
          throw innerError;
        }

        // Fallback: try filechooser event pattern
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', {timeout: 3000}),
          loc.click(),
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
      throw toElementError(error, {
        toolName: 'upload_file',
        selector,
        filePath,
      });
    }
  },
});
