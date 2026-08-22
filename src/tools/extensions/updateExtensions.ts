/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {withOperationTimeout} from '../shared/browserRuntime.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 更新 Chrome 扩展：导航到 chrome://extensions/ 并点击更新按钮。
 */
export const updateExtensions = defineTool({
  name: 'update_extensions',
  description:
    '通过点击 chrome://extensions/ 页面的更新按钮来更新 Chrome 扩展。',
  annotations: {category: ToolCategory.PAGES, readOnlyHint: false},
  schema: {},
  handler: async (_request, response, context) => {
    const frame = context.getSelectedFrame();

    const hookCode = `
  (function() {
    'use strict';
    const traverseShadowRoot = (selector, el) => {
      const found = el.querySelector(selector);
      if (found) return found;
      const root = el.shadowRoot;
      if (root) {
        const deep = traverseShadowRoot(selector, root);
        if (deep) return deep;
      }
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
    if (!manager) return { ok: false, error: 'extensions-manager not found' };

    const updateButton = traverseShadowRoot('#updateNow', manager);
    if (!updateButton) return { ok: false, error: '#updateNow button not found' };
    if (updateButton.disabled) return { ok: false, error: 'Update button is disabled' };

    updateButton.click();
    return { ok: true };
  })();
  `;

    try {
      const result = (await withOperationTimeout(
        frame.evaluate(hookCode),
        '更新扩展',
        10_000,
      )) as {
        ok: boolean;
        error?: string;
      };

      if (result.ok) {
        response.setStructuredContent({
          success: true,
          message: 'Chrome extensions update initiated successfully.',
          tooltype: 'update_extensions',
        });
        return;
      }

      throw createToolError(
        ErrorCodes.RUNTIME,
        `Failed to update extensions: ${result.error ?? 'unknown error'}`,
        {toolName: 'update_extensions'},
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `Error: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'update_extensions'},
      );
    }
  },
});
