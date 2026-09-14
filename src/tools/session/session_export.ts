/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {writeFile} from 'node:fs/promises';

import {
  buildRequestFilter,
  exportTraffic,
  type SessionExportFormat,
} from '../../modules/session/export.js';
import type {CaptureSource} from '../../modules/session/types.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {validateOutputPath} from '../../utils/fsSafe.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const sessionExport = defineTool({
  name: 'session_export',
  description:
    '将指定会话捕获的网络流量导出为 HAR 1.2、JSON 或 cURL 脚本文件。支持按来源、URL、mitmproxy 语法或指定 ID 过滤。',
  annotations: {
    category: ToolCategory.NETWORK,
    // 传入 outputPath 时会写盘，标注为可修改环境（对齐 wasm_dump / dump_session_state）。
    readOnlyHint: false,
  },
  schema: {
    sessionId: zod.string().optional().describe('会话 ID，默认当前活动会话。'),
    format: zod
      .enum(['har', 'json', 'curl'])
      .default('har')
      .describe(
        '导出格式：har (HTTP Archive 1.2), json (完整结构化数组), curl (Shell脚本)。默认 har。',
      ),
    outputPath: zod
      .string()
      .optional()
      .describe('导出文件写入路径。若省略则在返回数据中附带完整文本。'),
    sources: zod
      .array(zod.enum(['cdp', 'proxy']))
      .optional()
      .describe('抓包来源过滤。'),
    urlFilter: zod.string().optional().describe('URL 包含过滤。'),
    filter: zod
      .string()
      .optional()
      .describe('mitmproxy 流过滤表达式（如 ~m POST & ~c 200）。'),
    ids: zod.array(zod.string()).optional().describe('指定请求 ID 列表导出。'),
    includeResponseBody: zod
      .boolean()
      .optional()
      .default(true)
      .describe('是否包含响应体内容，默认 true。'),
    desensitize: zod
      .boolean()
      .optional()
      .default(false)
      .describe('是否脱敏 Authorization、Cookie 等敏感标头，默认 false。'),
  },
  handler: async (request, response) => {
    const {
      sessionId,
      format,
      outputPath,
      sources,
      urlFilter,
      filter,
      ids,
      includeResponseBody,
      desensitize,
    } = request.params as {
      sessionId?: string;
      format: SessionExportFormat;
      outputPath?: string;
      sources?: CaptureSource[];
      urlFilter?: string;
      filter?: string;
      ids?: string[];
      includeResponseBody?: boolean;
      desensitize?: boolean;
    };

    const manager = getRuntime().captureSessionManager;
    if (!manager) {
      throw createToolError(ErrorCodes.RUNTIME, '抓包会话管理器不可用');
    }

    // requireActiveSession() 无会话时抛错（不返回 null），单独捕获以给出中文提示。
    let session;
    if (sessionId) {
      session = manager.getSession(sessionId);
      if (!session) {
        throw createToolError(ErrorCodes.NOT_FOUND, `未找到会话 ${sessionId}`);
      }
    } else {
      try {
        session = manager.requireActiveSession();
      } catch {
        throw createToolError(ErrorCodes.NOT_FOUND, '暂无活动抓包会话');
      }
    }

    const requestFilter = buildRequestFilter({
      sources,
      urlFilter,
      filter,
      ids,
    });

    const records = manager.getRequests(session.id, requestFilter);
    const exportResult = exportTraffic(records, format, {
      includeResponseBody: includeResponseBody ?? true,
      desensitize: desensitize ?? false,
    });

    if (outputPath) {
      try {
        await writeFile(
          validateOutputPath(outputPath),
          exportResult.content,
          'utf-8',
        );
      } catch (err) {
        throw createToolError(
          ErrorCodes.RUNTIME,
          `写入文件 ${outputPath} 失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    response.setStructuredContent({
      tooltype: 'session_export',
      sessionId: session.id,
      format,
      count: exportResult.count,
      filename: exportResult.filename,
      outputPath: outputPath ?? null,
      ...(outputPath ? {} : {content: exportResult.content}),
    });
    response.appendResponseLine(
      `已成功导出 ${exportResult.count} 条请求为 ${format.toUpperCase()} 格式${outputPath ? `（已保存至 ${outputPath}）` : ''}。`,
    );
  },
});
