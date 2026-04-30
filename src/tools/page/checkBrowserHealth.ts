/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getActivePageWithGuard,
  normalizeBrowserRuntimeError,
  withOperationTimeout,
} from '../shared/browserRuntime.js';

import type {
  CheckBrowserHealthParams,
  CheckBrowserHealthResult,
  HealthIssue,
  PageRuntimeServices,
} from './types.js';

/**
 * 检查浏览器连接健康状态和页面可用性（纯函数版本）。
 *
 * 检测浏览器连接、页面就绪状态，并返回问题列表和建议。
 *
 * @param runtime - Page 运行时服务
 * @param _params - 参数（无参数）
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function checkBrowserHealth(
  runtime: PageRuntimeServices,
  _params?: CheckBrowserHealthParams,
): Promise<CheckBrowserHealthResult> {
  const issues: HealthIssue[] = [];
  let connected = runtime.isBrowserConnected();
  try {
    const running = await runtime.isCollectorRunning();
    connected = connected || running;
  } catch {
    // Fall through to page-level probes below.
  }

  let pageReady = false;
  let url: string | null = null;
  let title: string | null = null;
  try {
    const page = await getActivePageWithGuard(runtime);
    pageReady = true;
    connected = true;
    url = page.url();
    title = await withOperationTimeout(page.title(), '读取页面标题');
    await withOperationTimeout(page.evaluate('1+1'), '执行页面健康探针');
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

  return {
    success: issues.length === 0,
    message: issues.length === 0 ? '浏览器健康' : `发现 ${issues.length} 个问题`,
    tooltype: 'check_browser_health',
    logFormat: 'json',
    data,
  };
}
