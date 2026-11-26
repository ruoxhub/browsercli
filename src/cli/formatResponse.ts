/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CLI 响应渲染器（参考 chrome-devtools-mcp/src/daemon/client.ts#handleResponse 与
 * src/McpResponse.ts 的 TOON 编码渲染）：
 * 支持 `--output-format toon|md|json`（默认 `toon`），将工具执行结果渲染为低 token
 * 占用的 TOON 文本、紧凑 Markdown 或供脚本消费的原始结构化 JSON。
 */

import {getToonEncode, type ToonEncode} from '../third_party/toon.js';

export const OUTPUT_FORMATS = ['md', 'json', 'toon'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export function isOutputFormat(value: unknown): value is OutputFormat {
  return (
    typeof value === 'string' &&
    (OUTPUT_FORMATS as readonly string[]).includes(value)
  );
}

const OMITTED_PAYLOAD_KEYS = new Set([
  'success',
  'message',
  'tooltype',
  'logFormat',
  'snapshot',
  'consoleErrors',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ExtractedResponseSections {
  message?: string;
  snapshot?: Record<string, unknown>;
  consoleErrors: unknown[];
  payload?: unknown;
}

function extractResponseSections(
  result: Record<string, unknown>,
): ExtractedResponseSections {
  const structured = isRecord(result.structuredContent)
    ? result.structuredContent
    : result;

  const message =
    typeof structured.message === 'string' && structured.message.trim()
      ? structured.message.trim()
      : undefined;

  const snapshot = isRecord(structured.snapshot)
    ? structured.snapshot
    : undefined;

  const consoleErrors = Array.isArray(structured.consoleErrors)
    ? structured.consoleErrors
    : [];

  const rawPayload =
    structured.data !== undefined
      ? structured.data
      : Object.fromEntries(
          Object.entries(structured).filter(
            ([k]) => !OMITTED_PAYLOAD_KEYS.has(k),
          ),
        );

  const hasPayload =
    rawPayload !== undefined &&
    rawPayload !== null &&
    !(isRecord(rawPayload) && Object.keys(rawPayload).length === 0);

  return {
    message,
    snapshot,
    consoleErrors,
    payload: hasPayload ? rawPayload : undefined,
  };
}

/**
 * 将工具返回结果渲染为紧凑、低 token 占用的 Markdown 文本。
 */
export function formatToolResponseAsMarkdown(
  toolName: string,
  result: unknown,
): string {
  if (typeof result === 'string') {
    return result;
  }
  if (!isRecord(result)) {
    return String(result ?? '');
  }

  const {message, snapshot, consoleErrors, payload} =
    extractResponseSections(result);

  const lines: string[] = [`# ${toolName}`];
  if (message) {
    lines.push('', message);
  }

  // 页面快照大纲优先以纯代码块展示
  if (snapshot) {
    if (typeof snapshot.filePath === 'string') {
      lines.push(
        '',
        `- Snapshot: \`${snapshot.snapshotId ?? ''}\` (${snapshot.nodeCount ?? 0} nodes) -> \`${snapshot.filePath}\``,
      );
    } else if (typeof snapshot.textOutline === 'string') {
      lines.push(
        '',
        '## Snapshot',
        '```text',
        snapshot.textOutline.trimEnd(),
        '```',
      );
    }
  }

  // 控制台错误提示
  if (consoleErrors.length > 0) {
    lines.push('', '## Console Errors');
    for (const err of consoleErrors) {
      lines.push(`- ${String(err)}`);
    }
  }

  // 业务负载 data（或其余核心字段）
  if (payload !== undefined) {
    lines.push('', '```json', JSON.stringify(payload, null, 2), '```');
  }

  return lines.join('\n');
}

/**
 * 使用指定的 TOON 编码器将工具返回结果渲染为紧凑 TOON 文本（同步纯函数）。
 * 对齐 chrome-devtools-mcp/src/McpResponse.ts：保留可读 Markdown 标题与纯文本大纲，
 * 将结构化负载与错误列表替换为 `@toon-format/toon` 紧凑编码。
 */
export function renderStructuredAsToon(
  toolName: string,
  result: unknown,
  encode: ToonEncode,
): string {
  if (typeof result === 'string') {
    return result;
  }
  if (Array.isArray(result)) {
    return encode(result);
  }
  if (!isRecord(result)) {
    return String(result ?? '');
  }

  const {message, snapshot, consoleErrors, payload} =
    extractResponseSections(result);

  const lines: string[] = [`# ${toolName}`];
  if (message) {
    lines.push('', message);
  }

  if (snapshot) {
    if (typeof snapshot.filePath === 'string') {
      lines.push(
        '',
        `- Snapshot: \`${snapshot.snapshotId ?? ''}\` (${snapshot.nodeCount ?? 0} nodes) -> \`${snapshot.filePath}\``,
      );
    } else if (typeof snapshot.textOutline === 'string') {
      lines.push(
        '',
        '## Snapshot',
        '```text',
        snapshot.textOutline.trimEnd(),
        '```',
      );
    } else {
      lines.push('', '## Snapshot', encode(snapshot));
    }
  }

  if (consoleErrors.length > 0) {
    lines.push('', '## Console Errors', encode(consoleErrors));
  }

  if (payload !== undefined) {
    lines.push('', encode(payload));
  }

  return lines.join('\n');
}

/**
 * 将工具返回结果渲染为 TOON 格式文本（按需懒加载 `@toon-format/toon`）。
 */
export async function formatToolResponseAsToon(
  toolName: string,
  result: unknown,
  encode?: ToonEncode,
): Promise<string> {
  const toonEncode = encode ?? (await getToonEncode());
  return renderStructuredAsToon(toolName, result, toonEncode);
}

export async function formatToolResponse(
  toolName: string,
  result: unknown,
  format: OutputFormat = 'toon',
): Promise<string> {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }
  if (format === 'toon') {
    return await formatToolResponseAsToon(toolName, result);
  }
  return formatToolResponseAsMarkdown(toolName, result);
}
