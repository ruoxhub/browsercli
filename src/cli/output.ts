/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CLI 输出工具 — 项目特有的结构化输出构造
 *
 * renderOutput/renderError 由 axi-sdk-js 在 runAxiCli 中自动调用，
 * 此文件仅提供 CLI commands 使用的结构化输出构造函数
 */

export type AxiRenderable = string | Record<string, unknown>;

export interface AxiStructuredOutput extends Record<string, unknown> {
  status?: string;
  bin?: string;
  description?: string;
  version?: string;
  command?: string;
  session?: string;
  title?: string;
  headers?: string[];
  rows?: string[][];
  items?: string[];
  usage?: string;
  options?: Array<{name: string; description: string; required?: boolean}>;
}

export function successOutput(
  data: Record<string, unknown>,
  session?: string,
): AxiStructuredOutput {
  const result: Record<string, unknown> = {};
  if ('command' in data) {
    result.command = data.command;
  }
  const resolvedSession =
    session ?? (typeof data.session === 'string' ? data.session : undefined);
  if (resolvedSession !== undefined) {
    result.session = resolvedSession;
  }
  for (const [k, v] of Object.entries(data)) {
    if (k !== 'command' && k !== 'session') {
      result[k] = v;
    }
  }
  result.status = 'success';
  return result;
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
