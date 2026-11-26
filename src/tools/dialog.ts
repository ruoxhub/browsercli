/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Dialog} from 'patchright';

import {type Page, zod} from '../third_party/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';

import {ToolCategory} from './categories.js';
import type {DomainManifest} from './manifest.js';
import type {MessagesResult} from './shared/types.js';
import {type Context, definePageTool} from './ToolDefinition.js';

// ─── types.ts ────────────────────────────────────────────

/**
 * Dialog 处理函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface DialogResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat?: string;
}

/** Dialog 处理动作 */
export type DialogAction = 'accept' | 'dismiss';

/** Dialog 处理参数 */
export interface HandleDialogParams {
  /** 接受或关闭弹窗 */
  action: DialogAction;
  /** prompt 弹窗输入的文本（仅 action=accept 时有效） */
  promptText?: string;
}

export type {Page};

// ─── handleDialog.ts ─────────────────────────────────────

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
export const handleDialog = definePageTool({
  name: 'handle_dialog',
  description: '处理浏览器弹窗（alert/confirm/prompt），可接收或取消。',
  annotations: {category: ToolCategory.INPUT, readOnlyHint: false},
  blockedByDialog: false,
  concurrency: 'none',
  schema: {
    action: zod.enum(['accept', 'dismiss']).describe('对弹窗采取的操作。'),
    promptText: zod
      .string()
      .optional()
      .describe('为 prompt 弹窗输入的文本（仅 accept 时生效）。'),
  },
  handler: async (request, response, context) => {
    const {action, promptText} = request.params;
    const tooltype = 'handle_dialog';

    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        'No active page available. Open a page first before handling dialogs.',
        {toolName: 'handle_dialog'},
      );
    }

    const dialog = context.getDialog?.() ?? (await waitForDialog(page));
    if (!dialog) {
      throw createToolError(
        ErrorCodes.NOT_FOUND,
        'No open dialog found. Use an action that triggers a dialog first, then call this function.',
        {toolName: 'handle_dialog'},
      );
    }

    try {
      if (action === 'accept') {
        await dialog.accept(promptText);
        context.clearDialog?.();
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
      context.clearDialog?.();
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
      throw createToolError(
        ErrorCodes.RUNTIME,
        'Dialog may have already been handled externally',
        {toolName: 'handle_dialog', action},
      );
    }
  },
});

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'dialog',
  description: 'Browser dialog handling tools.',
  profile: 'workflow',
  tools: [{modulePath: './dialog.js', handlerName: 'handleDialog'}],
} satisfies DomainManifest;
