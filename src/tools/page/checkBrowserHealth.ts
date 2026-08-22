/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {ToolCategory} from '../categories.js';
import {
  getActivePageWithGuard,
  normalizeBrowserRuntimeError,
  withOperationTimeout,
} from '../shared/browserRuntime.js';
import {sendJson} from '../shared/pageResponse.js';
import {defineTool} from '../ToolDefinition.js';

import type {HealthIssue} from './types.js';

/**
 * 检查浏览器连接健康状态和页面可用性。
 */
export const checkBrowserHealth = defineTool({
  name: 'check_browser_health',
  description: '检查浏览器连接健康状态与页面可用性。',
  annotations: {
    category: ToolCategory.PAGES,
    readOnlyHint: true,
    requirements: {
      browser: 'connected',
      recovery: true,
    },
  },
  schema: {},
  handler: async (_request, response, _context) => {
    const issues: HealthIssue[] = [];
    const runtime = getRuntime();
    let connected =
      runtime.contextProvider?.isBrowserConnected() ??
      runtime.browserManager?.getBrowser()?.isConnected() ??
      false;
    try {
      const running =
        (await runtime.contextProvider?.isCollectorRunning()) ??
        (await runtime.collector?.getStatus())?.running ??
        false;
      connected = connected || running;
    } catch {
      // Fall through to page-level probes below.
    }

    let pageReady = false;
    let url: string | null = null;
    let title: string | null = null;
    try {
      const page = runtime.contextProvider
        ? await getActivePageWithGuard(runtime.contextProvider)
        : await runtime.pageController.getPage();
      pageReady = true;
      connected = true;
      url = page.url();
      title = await withOperationTimeout(page.title(), '读取页面标题');
      await withOperationTimeout(page.evaluate('1+1'), '执行页面健康探针');
      const pageId = runtime.contextProvider?.getPageId(page);
      if (pageId) {
        const {globalPageHealthTracker} =
          await import('../../worker/context/PageHealthTracker.js');
        globalPageHealthTracker.recordSuccess(pageId);
      }
    } catch (error) {
      const message = normalizeBrowserRuntimeError(error);
      issues.push({
        code: 'NO_ACTIVE_PAGE',
        message: `No controllable active page: ${message}`,
      });
      if (/浏览器连接失败|已关闭|超时/.test(message)) {
        issues.push({
          code: 'PAGE_UNRESPONSIVE',
          message: `Active page is present but not responsive: ${message}`,
        });
      }
    }

    if (!connected) {
      issues.push({
        code: 'BROWSER_DISCONNECTED',
        message:
          'Browser is not connected. Use browserUrl/wsEndpoint or start remote debugging.',
      });
    }

    const data = {
      healthy: issues.length === 0,
      connected,
      pageReady,
      currentPage: {url, title},
      recommendations: [
        !connected
          ? 'Start Chrome with --remote-debugging-port and reconnect MCP.'
          : null,
        connected && !pageReady
          ? 'Open/select a target page, then retry health check.'
          : null,
      ].filter((item): item is string => Boolean(item)),
      issues,
    };

    sendJson(response, {
      success: issues.length === 0,
      message:
        issues.length === 0 ? '浏览器健康' : `发现 ${issues.length} 个问题`,
      tooltype: 'check_browser_health',
      data,
    });
  },
});
