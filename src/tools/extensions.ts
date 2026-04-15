/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

/**
 * 更新 Chrome 扩展
 * 访问 chrome://extensions/ 并点击"立即更新"按钮
 */
export const updateExtensions = defineTool({
  name: 'update_extensions',
  description:
    'Update Chrome extensions by navigating to chrome://extensions/ and clicking the "Update now" button.',
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
    title: 'Update browser extensions',
  },
  schema: {},
  handler: async (_request, response, context, runtime) => {
    const page = await runtime.collector.getActivePage();

    await page.goto('chrome://extensions/', {
      waitUntil: 'networkidle2',
      timeout: 10000,
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    const result = await page.evaluate(() => {
      const traverseShadowRoot = (
        selector: string,
        el: Element | ShadowRoot,
      ): Element | null => {
        const found = el.querySelector(selector);
        if (found) return found;
        for (const child of el.children) {
          const sr = (child as any).shadowRoot;
          if (sr) {
            const deep = traverseShadowRoot(selector, sr);
            if (deep) return deep;
          }
        }
        return null;
      };

      const manager = document.querySelector('extensions-manager');
      if (!manager) {
        return {success: false, error: 'extensions-manager not found'};
      }

      const updateButton = traverseShadowRoot('#updateNow', manager);
      if (!updateButton) {
        return {success: false, error: '#updateNow button not found'};
      }

      if ((updateButton as any).disabled) {
        return {success: false, error: 'Update button is disabled'};
      }

      (updateButton as HTMLElement).click();
      return {success: true};
    });

    if (result.success) {
      response.appendResponseLine(
        'Chrome extensions update initiated successfully.',
      );
    } else {
      response.appendResponseLine(
        `Failed to update extensions: ${result.error}`,
      );
    }
  },
});
