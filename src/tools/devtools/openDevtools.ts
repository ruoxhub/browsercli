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
 * 原生实现：通过 CDP Target.createTarget 以 devtools:// URL 在同一浏览器内
 * 开窗并激活。窗口不会自动附着到页面，用户在 DevTools 的 target 下拉框中
 * 手动选择目标页面。
 */
export const openDevtools = defineTool({
  name: 'open_devtools',
  description:
    '为当前选中页面打开 Chrome DevTools 窗口（同一浏览器内新开 devtools:// 目标）。窗口默认不附着到页面，需要在 DevTools 的 target 下拉框中手动选择目标。',
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
        url: 'devtools://devtools/bundled/inspector.html',
      })) as {targetId: string};
      await client
        .send('Target.activateTarget', {targetId: created.targetId})
        .catch(() => undefined);
      return created;
    });

    response.setStructuredContent({
      success: true,
      message: `DevTools window opened unattached (target ${targetId.slice(0, 8)}). Use the target dropdown to select the page manually.`,
      tooltype: 'open_devtools',
      data: {targetId},
    });
  },
});
