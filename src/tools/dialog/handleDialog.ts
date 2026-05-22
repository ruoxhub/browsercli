/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Dialog} from 'patchright';

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 等待并获取页面上当前打开的 dialog。
 */
async function waitForDialog(
  page: Context['getSelectedPage'] extends () => infer R ? R : never,
  timeoutMs = 5000,
): Promise<Dialog | null> {
  return new Promise(resolve => {
    let settled = false;

    const handler = (dialog: Dialog) => {
      if (!settled) {
        settled = true;
        page.off('dialog', handler);
        resolve(dialog);
      }
    };

    page.on('dialog', handler);

    setTimeout(() => {
      if (!settled) {
        settled = true;
        page.off('dialog', handler);
        resolve(null);
      }
    }, timeoutMs);
  });
}

/**
 * 处理浏览器弹窗（alert/confirm/prompt）。
 */
export const handleDialog = defineTool({
  name: 'handle_dialog',
  description: 'Handle browser dialogs (alert/confirm/prompt) - accept or dismiss',
  annotations: {category: ToolCategory.PAGES, readOnlyHint: false},
  schema: {
    action: zod
      .enum(['accept', 'dismiss'])
      .describe('Action to take on the dialog'),
    promptText: zod
      .string()
      .optional()
      .describe('Text to enter for prompt dialogs (only with accept)'),
  },
  handler: async (request, response, context) => {
    const {action, promptText} = request.params;
    const tooltype = 'handle_dialog';

    let page;
    try {
      page = context.getSelectedPage();
    } catch {
      response.setStructuredContent({
        success: false,
        message: 'No active page available. Open a page first before handling dialogs.',
        tooltype,
        data: {},
      });
      return;
    }

    const dialog = await waitForDialog(page);
    if (!dialog) {
      response.setStructuredContent({
        success: false,
        message:
          'No open dialog found. Use an action that triggers a dialog first, then call this function.',
        tooltype,
        data: {},
      });
      return;
    }

    try {
      if (action === 'accept') {
        await dialog.accept(promptText);
        response.setStructuredContent({
          success: true,
          message: promptText
            ? `Successfully accepted the dialog with text: ${promptText}`
            : 'Successfully accepted the dialog',
          tooltype,
          data: {
            action: 'accept',
            dialogType: dialog.type(),
            promptText: promptText ?? null,
          },
        });
        return;
      }
      await dialog.dismiss();
      response.setStructuredContent({
        success: true,
        message: 'Successfully dismissed the dialog',
        tooltype,
        data: {
          action: 'dismiss',
          dialogType: dialog.type(),
        },
      });
    } catch {
      response.setStructuredContent({
        success: false,
        message: 'Dialog may have already been handled externally',
        tooltype,
        data: {},
      });
    }
  },
});

export type {DialogAction, DialogResult, HandleDialogParams} from './types.js';
