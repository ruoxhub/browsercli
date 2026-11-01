/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {withCdpSession} from '../../modules/browser/cdpUtils.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {NO_ACTIVE_PAGE_MESSAGE} from '../shared/activePageResolver.js';
import {
  classifyElementError,
  toElementError,
} from '../shared/elementLocator.js';
import {defineTool, type Context} from '../ToolDefinition.js';

const PROBE_ATTR = 'data-pcli-upload-probe';
/** 等待 filechooser 事件的超时时间（毫秒）。 */
const FILECHOOSER_TIMEOUT_MS = 3000;

/**
 * 上传文件到 file input 元素，依次尝试 Playwright 原生 setInputFiles、filechooser 事件模式及 CDP DOM.setFileInputFiles 三级降级。
 */
export const uploadFile = defineTool({
  name: 'upload_file',
  description:
    '向 file input 元素上传文件，依次尝试 Playwright 原生 setInputFiles、filechooser 事件模式及 CDP DOM.setFileInputFiles 三级降级。',
  annotations: {
    title: '上传文件',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe(
        '定位器：支持完整定位器语法，包括 CSS（#id、.cls）、role=、text=、xpath= 及 >> nth=N 消歧。',
      ),
    filePath: zod.string().describe('文件绝对路径。'),
  },
  handler: async (request, response, context) => {
    const {selector, filePath} = request.params;
    const frame = (context as Context).getSelectedFrame();
    if (!frame) {
      throw createToolError(ErrorCodes.FRAME_REQUIRED, NO_ACTIVE_PAGE_MESSAGE, {
        toolName: 'upload_file',
      });
    }
    const page = frame.page();

    const loc = frame.locator(selector);
    let nativeError: string | undefined;
    let fileChooserError: string | undefined;

    try {
      // 1. Playwright native setInputFiles
      try {
        await loc.setInputFiles(filePath);
        response.setStructuredContent({
          success: true,
          message: `File uploaded from ${filePath}`,
          tooltype: 'upload_file',
          data: {selector, filePath, strategy: 'native'},
        });
        return;
      } catch (innerError) {
        const classification = classifyElementError(innerError);
        if (classification.code === ErrorCodes.ELEMENT_LOCATOR_AMBIGUOUS) {
          throw innerError;
        }
        nativeError =
          innerError instanceof Error ? innerError.message : String(innerError);
      }

      // 2. Fallback: filechooser event pattern
      try {
        const chooserPromise = page.waitForEvent('filechooser', {
          timeout: FILECHOOSER_TIMEOUT_MS,
        });
        chooserPromise.catch(() => undefined);
        const [fileChooser] = await Promise.all([chooserPromise, loc.click()]);
        await fileChooser.setFiles(filePath);
        response.setStructuredContent({
          success: true,
          message: `File uploaded from ${filePath}`,
          tooltype: 'upload_file',
          data: {selector, filePath, fallback: true, strategy: 'filechooser'},
        });
        return;
      } catch (innerError) {
        const classification = classifyElementError(innerError);
        if (classification.code === ErrorCodes.ELEMENT_LOCATOR_AMBIGUOUS) {
          throw innerError;
        }
        fileChooserError =
          innerError instanceof Error ? innerError.message : String(innerError);
      }

      // 3. Fallback: CDP DOM.setFileInputFiles via probe-attribute bridge
      const probe = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const target = loc.first();
      try {
        await target.evaluate(
          (node: unknown, [attr, value]: unknown[]) => {
            (node as Element).setAttribute(attr as string, value as string);
          },
          [PROBE_ATTR, probe],
        );

        await withCdpSession(page, async client => {
          await client.send('DOM.enable');
          const doc = (await client.send('DOM.getDocument', {depth: 0})) as {
            root?: {nodeId: number};
          };
          const rootNodeId = doc?.root?.nodeId;
          const {nodeId} = (await client.send('DOM.querySelector', {
            nodeId: rootNodeId,
            selector: `[${PROBE_ATTR}="${probe}"]`,
          })) as {nodeId: number};

          if (!nodeId) {
            throw createToolError(
              ErrorCodes.NOT_FOUND,
              `Element not found via CDP probe: ${selector}`,
              {toolName: 'upload_file', selector},
            );
          }

          await client.send('DOM.setFileInputFiles', {
            nodeId,
            files: [filePath],
          });
        });

        response.setStructuredContent({
          success: true,
          message: `File uploaded from ${filePath}`,
          tooltype: 'upload_file',
          data: {selector, filePath, fallback: true, strategy: 'cdp'},
        });
      } finally {
        try {
          await target.evaluate((node: unknown, attr: unknown) => {
            (node as Element).removeAttribute(attr as string);
          }, PROBE_ATTR);
        } catch {
          // 忽略元素移除/已销毁时的清理错误
        }
      }
    } catch (error) {
      const toolError = toElementError(error, {
        toolName: 'upload_file',
        selector,
        filePath,
      });
      if (nativeError !== undefined || fileChooserError !== undefined) {
        const cdpError =
          error instanceof Error ? error.message : String(error);
        throw createToolError(
          toolError.code,
          toolError.message,
          toolError.context,
          {
            retryable: toolError.retryable,
            recovery: toolError.recovery,
            details: {
              native: nativeError,
              filechooser: fileChooserError,
              cdp: cdpError,
            },
          },
        );
      }
      throw toolError;
    }
  },
});
