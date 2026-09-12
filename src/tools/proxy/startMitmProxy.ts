/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const startMitmProxy = defineTool({
  name: 'start_mitm_proxy',
  description:
    '启动 MITM 抓包代理，拦截非浏览器流量（curl、脚本、桌面应用、手机 App）。启动后终端可通过 `-x http://127.0.0.1:<port>` 走代理；HTTPS 需信任返回的 CA 证书路径（--cacert）。可配置 upstreamProxy 将流量通过二级外部代理（HTTP/HTTPS/SOCKS5）转发。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    port: zod
      .number()
      .int()
      .min(1)
      .max(65535)
      .optional()
      .describe('代理监听端口，默认 8888。'),
    upstreamProxy: zod
      .string()
      .optional()
      .describe(
        '二级外部代理 URL，支持 HTTP/HTTPS 与 SOCKS5，例如 http://127.0.0.1:7890、socks5://127.0.0.1:1080 或 http://user:pass@127.0.0.1:8080。',
      ),
  },
  handler: async (request, response) => {
    const result = await getRuntime().mitmModule.start(
      request.params.port,
      request.params.upstreamProxy,
    );
    response.setStructuredContent({...result, tooltype: 'start_mitm_proxy'});
  },
});
