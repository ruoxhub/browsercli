/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
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
    title: 'Handle dialog (accept/dismiss)',
  },
  schema: {
    action: zod
      .enum(['accept', 'dismiss'])
      .describe('Whether to dismiss or accept the dialog'),
    promptText: zod
      .string()
      .optional()
      .describe(
        'Optional prompt text to enter into the dialog (for prompt dialogs)',
      ),
  },
  handler: async (request, response, context, runtime) => {
    const dialog = context.getDialog();
    if (!dialog) {
      throw new Error(
        'No open dialog found. Use an action that triggers a dialog first, then call this tool.',
      );
    }

    try {
      if (request.params.action === 'accept') {
        await dialog.accept(request.params.promptText);
        response.appendResponseLine('Successfully accepted the dialog');
      } else {
        await dialog.dismiss();
        response.appendResponseLine('Successfully dismissed the dialog');
      }
    } catch {
      response.appendResponseLine(
        'Dialog may have already been handled externally',
      );
    }

    context.clearDialog();
  },
});
