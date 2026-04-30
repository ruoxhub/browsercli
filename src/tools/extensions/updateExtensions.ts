/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import type {ExtensionsResult} from './types.js';

/**
 * 更新 Chrome 扩展：导航到 chrome://extensions/ 并点击更新按钮。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 JS 代码
 * @returns 结构化结果对象
 */
export async function updateExtensions(frame: Frame): Promise<ExtensionsResult> {
  const hookCode = `
  (function() {
    'use strict';
    const traverseShadowRoot = (selector, el) => {
      const found = el.querySelector(selector);
      if (found) return found;
      for (const child of el.children) {
        const sr = child.shadowRoot;
        if (sr) {
          const deep = traverseShadowRoot(selector, sr);
          if (deep) return deep;
        }
      }
      return null;
    };

    const manager = document.querySelector('extensions-manager');
    if (!manager) return { success: false, error: 'extensions-manager not found' };

    const updateButton = traverseShadowRoot('#updateNow', manager);
    if (!updateButton) return { success: false, error: '#updateNow button not found' };
    if (updateButton.disabled) return { success: false, error: 'Update button is disabled' };

    updateButton.click();
    return { success: true };
  })();
  `;

  try {
    const result = (await frame.evaluate(hookCode)) as {
      success: boolean;
      error?: string;
    };

    if (result.success) {
      return {
        success: true,
        message: 'Chrome extensions update initiated successfully.',
        tooltype: 'update_extensions',
      };
    }

    return {
      success: false,
      message: `Failed to update extensions: ${result.error ?? 'unknown error'}`,
      tooltype: 'update_extensions',
    };
  } catch (error) {
    return {
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'update_extensions',
    };
  }
}