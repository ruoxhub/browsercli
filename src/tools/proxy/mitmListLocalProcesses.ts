/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const mitmListLocalProcesses = defineTool({
  name: 'mitm_list_local_processes',
  description:
    '列出当前正在发起或保持 TCP 连接的本地进程（pid/名称），辅助选取透明拦截目标。Windows 上基于 netstat 连接表。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response) => {
    const result = await getRuntime().mitmModule.listLocalProcesses();
    response.setStructuredContent({
      ...result,
      tooltype: 'mitm_list_local_processes',
    });
  },
});
