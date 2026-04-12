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

export function renderOutput(data: AxiRenderable): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
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
  const output: AxiStructuredOutput = {items};
  if (title) {
    output.title = title;
  }
  return output;
}
