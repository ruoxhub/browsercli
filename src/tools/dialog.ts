/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {getJSHookRuntime} from './runtime.js';
import {defineTool} from './ToolDefinition.js';

/**
 * 处理浏览器弹窗（alert/confirm/prompt）
 */
export const handleDialog = defineTool({
  name: 'handle_dialog',
  description: `If a browser dialog was opened (alert, confirm, prompt), use this command to handle it. Accepts or dismisses the dialog.`,
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    action: zod
      .enum(['accept', 'dismiss'])
      .describe('Whether to dismiss or accept the dialog'),
    promptText: zod
      .string()
      .optional()
      .describe('Optional prompt text to enter into the dialog (for prompt dialogs)'),
  },
  handler: async (request, response, context, runtime) => {
    const page = await runtime.collector.getActivePage();

    // 尝试从上下文获取 dialog，如果没有则使用最近打开的 dialog
    const dialog = context.getDialog();
    if (!dialog) {
      throw new Error('No open dialog found. Use an action that triggers a dialog first, then call this tool.');
    }

    switch (request.params.action) {
      case 'accept': {
        try {
          if (request.params.promptText !== undefined) {
            await dialog.accept(request.params.promptText);
          } else {
            await dialog.accept();
          }
          response.appendResponseLine('Successfully accepted the dialog');
        } catch (err) {
          // 可能已经被外部处理
          response.appendResponseLine('Dialog may have already been handled externally');
        }
        break;
      }
      case 'dismiss': {
        try {
          await dialog.dismiss();
          response.appendResponseLine('Successfully dismissed the dialog');
        } catch (err) {
          // 可能已经被外部处理
          response.appendResponseLine('Dialog may have already been handled externally');
        }
        break;
      }
    }

    context.clearDialog();
  },
});
