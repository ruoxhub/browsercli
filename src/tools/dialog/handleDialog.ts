/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from '../../third_party/index.js';
import type {DialogAction, DialogResult, HandleDialogParams} from './types.js';

/**
 * 处理浏览器弹窗（alert/confirm/prompt）。
 *
 * 在 Puppeteer Page 上监听 dialog 事件，自动捕获弹窗对象后执行 accept 或 dismiss。
 * 调用方需要在触发弹窗的页面操作之前注册此函数，
 * 或在弹窗已存在时直接传入已捕获的 Dialog 对象。
 *
 * @param page - Puppeteer Page 对象
 * @param params - 处理参数 { action, promptText? }
 * @returns 结构化结果对象
 */
export async function handleDialog(
  page: Page,
  params: HandleDialogParams,
): Promise<DialogResult> {
  const {action, promptText} = params;
  const tooltype = 'handle_dialog';

  const dialog = await waitForDialog(page);
  if (!dialog) {
    return {
      success: false,
      message:
        'No open dialog found. Use an action that triggers a dialog first, then call this function.',
      tooltype,
    };
  }

  try {
    if (action === 'accept') {
      await dialog.accept(promptText);
      return {
        success: true,
        message: promptText
          ? `Successfully accepted the dialog with text: ${promptText}`
          : 'Successfully accepted the dialog',
        tooltype,
      };
    }
    await dialog.dismiss();
    return {
      success: true,
      message: 'Successfully dismissed the dialog',
      tooltype,
    };
  } catch {
    return {
      success: false,
      message: 'Dialog may have already been handled externally',
      tooltype,
    };
  }
}

/**
 * 等待并获取页面上当前打开的 dialog。
 * Dialog 事件在 JS 执行 alert/confirm/prompt 时同步触发，
 * Puppeteer 会在 page.on('dialog') 回调中捕获 Dialog 对象。
 *
 * 此函数设置一次性监听器，等待最多 5 秒获取 dialog；
 * 如果页面已有 dialog 上下文则立即返回。
 */
async function waitForDialog(page: Page, timeoutMs = 5000): Promise<import('puppeteer-core').Dialog | null> {
  return new Promise((resolve) => {
    let settled = false;

    const handler = (dialog: import('puppeteer-core').Dialog) => {
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

export type {DialogAction, DialogResult, HandleDialogParams} from './types.js';