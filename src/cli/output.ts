/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

export type AxiRenderable = string | Record<string, unknown>;

export interface AxiStructuredOutput extends Record<string, unknown> {
  status?: string;
  bin?: string;
  description?: string;
  version?: string;
  command?: string;
  title?: string;
  headers?: string[];
  rows?: string[][];
  items?: string[];
  usage?: string;
  options?: Array<{name: string; description: string; required?: boolean}>;
}

/**
 * 渲染输出 — 支持 JSON 和终端友好格式
 */
export function renderOutput(data: AxiRenderable): string {
  if (typeof data === 'string') return data;

  // 如果在终端中，优先输出人类友好格式
  if (process.stdout.isTTY) {
    return renderTerminal(data as AxiStructuredOutput);
  }

  return JSON.stringify(data, null, 2);
}

/**
 * 终端友好的格式化输出
 */
function renderTerminal(data: AxiStructuredOutput): string {
  const lines: string[] = [];

  // 顶层信息
  if (data.bin) {
    lines.push(`\n  ${data.bin} v${data.version || '?'}`);
    if (data.description) lines.push(`  ${data.description}`);
    lines.push('');
  }

  if (data.command && data.description) {
    lines.push(`  ${data.command} — ${data.description}`);
    lines.push('');
  }

  if (data.usage) {
    lines.push(`  用法: ${data.usage}`);
    lines.push('');
  }

  // 表格输出
  if (data.headers && data.rows) {
    const colWidths = data.headers.map((h, i) => {
      const maxDataLen = Math.max(...data.rows!.map(r => (r[i] || '').length));
      return Math.max(h.length, maxDataLen);
    });

    // 表头
    const headerLine = data.headers.map((h, i) => h.padEnd(colWidths[i])).join('  ');
    lines.push(`  ${headerLine}`);
    lines.push(`  ${colWidths.map(w => '-'.repeat(w)).join('  ')}`);

    // 数据行
    for (const row of data.rows) {
      const rowLine = row.map((cell, i) => (cell || '').padEnd(colWidths[i])).join('  ');
      lines.push(`  ${rowLine}`);
    }
    lines.push('');
  }

  // 列表输出
  if (data.items && data.items.length > 0) {
    if (data.title) lines.push(`  ${data.title}:`);
    for (const item of data.items) {
      lines.push(`  - ${item}`);
    }
    lines.push('');
  }

  // 选项
  if (data.options && data.options.length > 0) {
    lines.push('  选项:');
    for (const opt of data.options) {
      const required = opt.required ? ' (必填)' : '';
      lines.push(`    --${opt.name}${required}  ${opt.description}`);
    }
    lines.push('');
  }

  // 状态行
  if (data.status) {
    const statusIcons: Record<string, string> = {
      success: 'OK',
      info: 'INFO',
      warn: 'WARN',
      error: 'ERR',
    };
    const icon = statusIcons[data.status] || data.status.toUpperCase();
    lines.push(`  [${icon}]`);
  }

  // 如果没有特殊字段被处理，回退到 JSON
  if (lines.length === 0) {
    return JSON.stringify(data, null, 2);
  }

  return lines.join('\n');
}

export function renderError(
  message: string,
  code?: string,
  suggestions?: string[],
): string {
  const parts = [`Error: ${message}`];
  if (code) parts.push(`Code: ${code}`);
  if (suggestions?.length) {
    parts.push('Suggestions:');
    for (const s of suggestions) parts.push(`  - ${s}`);
  }
  return parts.join('\n');
}

export function successOutput(
  data: Record<string, unknown>,
): AxiStructuredOutput {
  const {status: _ignored, ...rest} = data;
  return {status: 'success', ...rest};
}

export function tableOutput(
  headers: string[],
  rows: string[][],
): AxiStructuredOutput {
  return {headers, rows};
}

export function listOutput(
  items: string[],
  title?: string,
): AxiStructuredOutput {
  return title ? {items, title} : {items};
}
