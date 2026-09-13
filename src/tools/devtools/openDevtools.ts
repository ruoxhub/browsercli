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

/** DevTools 前端 URL（Chrome 特权 scheme，仅非 headless 窗口可用）。 */
const DEVTOOLS_FRONTEND_URL = 'devtools://devtools/bundled/inspector.html';

/**
 * 为当前页面打开 DevTools 窗口。
 *
 * 原生实现：通过 CDP Target.createTarget 以 devtools:// URL 在同一浏览器内
 * 新建目标（页面级 session 无法指定 newWindow，通常落在新标签页）并激活。
 * 窗口不会自动附着到页面，用户在 DevTools 的 target 下拉框中手动选择目标页面。
 * 注意：headless 模式下 Chrome 不提供 devtools:// 前端，调用可能静默降级为
 * about:blank；本工具不做探测，仅在返回信息中说明未附着。
 */
export const openDevtools = defineTool({
  name: 'open_devtools',
  description:
    '为当前选中页面打开 Chrome DevTools 目标（同一浏览器内新建 devtools:// 标签页）。窗口默认不附着到页面，需要在 DevTools 的 target 下拉框中手动选择目标；headless 模式下该 scheme 可能不可用。',
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

    const {targetId} = await withCdpSession(page, async client => {
      const created = (await client.send('Target.createTarget', {
        url: DEVTOOLS_FRONTEND_URL,
      })) as {targetId: string};
      await client
        .send('Target.activateTarget', {targetId: created.targetId})
        .catch(() => undefined);
      return created;
    });

    response.setStructuredContent({
      success: true,
      message: `DevTools target opened unattached (target ${targetId.slice(0, 8)}). Use the target dropdown to select the page manually.`,
      tooltype: 'open_devtools',
      data: {targetId},
    });
  },
});
