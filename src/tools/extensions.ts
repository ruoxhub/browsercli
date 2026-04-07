/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {getJSHookRuntime} from './runtime.js';
import {defineTool} from './ToolDefinition.js';

/**
 * 更新 Chrome 扩展
 * 访问 chrome://extensions/ 并点击"立即更新"按钮
 */
export const updateExtensions = defineTool({
  name: 'update_extensions',
  description: 'Update Chrome extensions by navigating to chrome://extensions/ and clicking the "Update now" button.',
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (_request, response, context, runtime) => {
    const page = await runtime.collector.getActivePage();

    // 导航到 extensions 页面
    await page.goto('chrome://extensions/', {
      waitUntil: 'networkidle2',
      timeout: 10000,
    });

    // 等待页面加载完成
    await new Promise(resolve => setTimeout(resolve, 500));

    // 执行 JavaScript 点击更新按钮
    const result = await page.evaluate(() => {
      const manager = document.querySelector('extensions-manager');
      if (!manager) {
        return {success: false, error: 'extensions-manager not found'};
      }

      const shadowRoot = (manager as any).shadowRoot;
      if (!shadowRoot) {
        return {success: false, error: 'shadowRoot not found on extensions-manager'};
      }

      const toolbar = shadowRoot.querySelector('extensions-toolbar#toolbar');
      if (!toolbar) {
        return {success: false, error: 'extensions-toolbar#toolbar not found'};
      }

      const toolbarShadowRoot = (toolbar as any).shadowRoot;
      if (!toolbarShadowRoot) {
        return {success: false, error: 'shadowRoot not found on extensions-toolbar'};
      }

      const updateButton = toolbarShadowRoot.querySelector('#updateNow');
      if (!updateButton) {
        return {success: false, error: '#updateNow button not found'};
      }

      // 检查按钮是否被禁用
      if ((updateButton as any).disabled) {
        return {success: false, error: 'Update button is disabled'};
      }

      (updateButton as HTMLElement).click();
      return {success: true};
    });

    if (result.success) {
      response.appendResponseLine('Chrome extensions update initiated successfully.');
    } else {
      response.appendResponseLine(`Failed to update extensions: ${result.error}`);
    }
  },
});
