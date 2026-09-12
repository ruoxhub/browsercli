/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {withCdpSession} from '../../modules/browser/cdpUtils.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {NO_ACTIVE_PAGE_MESSAGE} from '../shared/activePageResolver.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 为当前页面打开 DevTools 窗口。
 *
 * 原生实现：优先通过 CDP Target.createTarget 以 devtools:// URL 在同一
 * 浏览器内开窗；若浏览器带 HTTP 调试端口（--remote-debugging-port），
 * 先查 /json/list 拿到带 ws 参数的 devtoolsFrontendUrl 以便窗口附着
 * 到页面；pipe 启动的浏览器没有 ws 端点，退化为未附着的 DevTools 窗口。
 */
export const openDevtools = defineTool({
  name: 'open_devtools',
  description:
    '为当前选中页面打开 Chrome DevTools 窗口（同一浏览器内新开 devtools:// 目标）。若浏览器以 pipe 启动（无 HTTP 调试端口），窗口不会自动附着到页面，需要人工选择 target。',
  annotations: {
    title: '打开DevTools窗口',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response, context) => {
    const page = (context as Context).getSelectedPage();
    if (!page) {
      throw createToolError(ErrorCodes.PAGE_REQUIRED, NO_ACTIVE_PAGE_MESSAGE, {
        toolName: 'open_devtools',
      });
    }

    let frontendUrl = 'devtools://devtools/bundled/inspector.html';
    let attached = false;

    // 尝试从 HTTP 调试端口拿附着的 frontend URL（仅 --remote-debugging-port 启动的浏览器有）。
    try {
      // 注意：patchright 的 Browser 接口未声明 wsEndpoint（只有 BrowserServer 有），
      // 因此这里按运行时可选属性做防御式探测；pipe 启动时通常为 undefined。
      const browser = page.context().browser?.() as
        | {wsEndpoint?: () => string}
        | null
        | undefined;
      const ws =
        typeof browser?.wsEndpoint === 'function' ? browser.wsEndpoint() : '';
      const match =
        typeof ws === 'string' ? ws.match(/ws:\/\/[^/]+:(\d+)/) : null;
      if (match) {
        const list = (await (
          await fetch(`http://127.0.0.1:${match[1]}/json/list`)
        ).json()) as Array<{
          type: string;
          url: string;
          devtoolsFrontendUrl?: string;
        }>;
        const target = list.find(
          t => t.type === 'page' && t.url === page.url(),
        );
        if (target?.devtoolsFrontendUrl) {
          frontendUrl = target.devtoolsFrontendUrl;
          attached = true;
        }
      }
    } catch {
      // pipe 启动：无 HTTP 端点，保持未附着 fallback
    }

    const {targetId} = await withCdpSession(page, async client => {
      const created = (await client.send('Target.createTarget', {
        url: frontendUrl,
      })) as {targetId: string};
      await client
        .send('Target.activateTarget', {targetId: created.targetId})
        .catch(() => undefined);
      return created;
    });

    response.setStructuredContent({
      success: true,
      message: attached
        ? `DevTools window opened and attached (target ${targetId.slice(0, 8)}).`
        : `DevTools window opened without page attachment (pipe-launched browser; target ${targetId.slice(0, 8)}). Use the target dropdown to select the page manually.`,
      tooltype: 'open_devtools',
      data: {targetId, attached},
    });
  },
});
