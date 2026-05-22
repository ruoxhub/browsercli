/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 更新 Chrome 扩展：导航到 chrome://extensions/ 并点击更新按钮。
 */
export const updateExtensions = defineTool({
  name: 'update_extensions',
  description: 'Update Chrome extensions by clicking the update button on chrome://extensions/',
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
        response.appendResponseLine('```json');
        response.appendResponseLine(
          JSON.stringify(
            {
              success: true,
              message: 'Chrome extensions update initiated successfully.',
              tooltype: 'update_extensions',
            },
            null,
            2,
          ),
        );
        response.appendResponseLine('```');
        return;
      }

      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: `Failed to update extensions: ${result.error ?? 'unknown error'}`,
            tooltype: 'update_extensions',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: `Error: ${error instanceof Error ? error.message : String(error)}`,
            tooltype: 'update_extensions',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    }
  },
});
