/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const mitmConfigureLocalApps = defineTool({
  name: 'mitm_configure_local_apps',
  description:
    '配置 Local Applications 透明拦截模式：接管 Windows 系统代理（127.0.0.1:<port>），仅对目标进程做 MITM 解密抓包，其余进程经盲转发正常上网。关闭时自动还原系统代理。targets 留空代表拦截全部本地应用。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    enabled: zod.boolean().optional().describe('是否开启透明系统代理接管。'),
    targets: zod
      .array(zod.string())
      .optional()
      .describe(
        '拦截的目标进程名列表（如 ["wechat.exe"]，大小写不敏感，无扩展名自动补 .exe）。留空/空数组代表全部进程。',
      ),
  },
  handler: async (request, response) => {
    const result = await getRuntime().mitmModule.configureLocalApps({
      enabled: request.params.enabled,
      targets: request.params.targets,
    });
    response.setStructuredContent({
      ...result,
      tooltype: 'mitm_configure_local_apps',
    });
  },
});
