/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AddMitmRuleParams} from '../../modules/proxy/index.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const addRewriteRule = defineTool({
  name: 'mitm_add_rule',
  description:
    '新增/覆盖一条 MITM 改写规则（block / map_local / map_remote / modify_header / modify_body），进程内生效直到 stop 或 clear。同 id 覆盖。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    action: zod.discriminatedUnion('type', [
      zod.object({
        type: zod.literal('block'),
        statusCode: zod
          .number()
          .int()
          .default(444)
          .describe('短路返回的状态码，444=断连不发响应。'),
        closeConnection: zod
          .boolean()
          .optional()
          .describe('强制断连而不回响应。'),
      }),
      zod.object({
        type: zod.literal('map_local'),
        urlRegex: zod.string().describe('目标 URL 正则。'),
        localPath: zod.string().describe('命中时返回的本地文件路径。'),
        statusCode: zod
          .number()
          .int()
          .optional()
          .describe('返回状态码，默认 200。'),
        contentType: zod
          .string()
          .optional()
          .describe('覆盖响应的 content-type。'),
      }),
      zod.object({
        type: zod.literal('map_remote'),
        urlRegex: zod.string().describe('目标 URL 正则（可含捕获组）。'),
        replacement: zod.string().describe('替换目标 URL，支持 $1..$n。'),
      }),
      zod.object({
        type: zod.literal('modify_header'),
        phase: zod.enum(['request', 'response']).describe('作用于哪一侧。'),
        set: zod
          .record(zod.string(), zod.string())
          .optional()
          .describe('设值（覆盖同名头）。'),
        remove: zod.array(zod.string()).optional().describe('删除的头名。'),
      }),
      zod.object({
        type: zod.literal('modify_body'),
        phase: zod.enum(['request', 'response']).describe('作用于哪一侧。'),
        find: zod.string().describe('要替换的字符串或正则。'),
        replace: zod.string().describe('替换为。'),
        regex: zod
          .boolean()
          .optional()
          .describe('find 是否按正则全局替换，默认字面量。'),
      }),
    ]),
    id: zod.string().optional().describe('规则 id，缺省自动生成；同 id 覆盖。'),
    enabled: zod.boolean().optional().describe('是否启用，默认 true。'),
    urlFilter: zod
      .string()
      .optional()
      .describe('URL 子串匹配（大小写不敏感）。'),
    method: zod.string().optional().describe('HTTP 方法大写精确。'),
    host: zod.string().optional().describe('hostname 子串（大小写不敏感）。'),
    headerContains: zod
      .object({name: zod.string(), value: zod.string()})
      .optional()
      .describe('请求头命中谓词。'),
    bodyContains: zod
      .string()
      .optional()
      .describe('body 子串（大小写不敏感，按 phase 侧）。'),
    filter: zod
      .string()
      .optional()
      .describe(
        'mitmproxy 风格流过滤表达式（如 "~m POST & ~c 200"），与离散谓词 AND 组合。',
      ),
  },
  handler: async (request, response) => {
    const result = getRuntime().mitmModule.addRule(
      request.params as AddMitmRuleParams,
    );
    response.setStructuredContent({...result, tooltype: 'mitm_add_rule'});
  },
});
