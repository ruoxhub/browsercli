/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Script} from 'node:vm';

import type {DebuggerManager} from './DebuggerManager.js';

export interface LogpointOptions {
  /** 脚本 URL 或后缀匹配路径。 */
  url: string;
  /** 1-based 行号。 */
  lineNumber: number;
  /** 可选 1-based 列号。 */
  columnNumber?: number;
  /** 以 console.log(...) 参数形式求值的表达式。 */
  expression: string;
}

export interface Logpoint {
  url: string;
  lineNumber: number;
  columnNumber?: number;
  expression: string;
  breakpointId: string;
  bound: boolean;
}

export class LogpointError extends Error {
  readonly logpoints: Logpoint[];

  constructor(message: string, logpoints: Logpoint[]) {
    super(message);
    this.name = 'LogpointError';
    this.logpoints = logpoints;
  }
}

export const LOGPOINT_FORMAT =
  '<url>:<lineNumber>[:<columnNumber>] <expression>';

/**
 * 解析 `<url>:<lineNumber>[:<columnNumber>] <expression>` 格式的 logpoint 描述。
 */
export function parseLogpoint(text: string): LogpointOptions {
  const match = /^(\S+?):(\d+)(?::(\d+))?\s+(\S.*)$/s.exec(text.trim());
  if (!match) {
    throw new Error(
      `Invalid logpoint "${text}". Expected the format ${LOGPOINT_FORMAT}, for example "src/app.ts:42 'total', cart.total".`,
    );
  }
  const [, url, lineNumber, columnNumber, expression] = match;
  const logpoint: LogpointOptions = {
    url,
    lineNumber: Number(lineNumber),
    expression,
  };
  if (columnNumber !== undefined) {
    logpoint.columnNumber = Number(columnNumber);
  }
  if (logpoint.lineNumber < 1 || logpoint.columnNumber === 0) {
    throw new Error(
      `Invalid logpoint "${text}": line and column numbers are 1-based.`,
    );
  }
  return logpoint;
}

/**
 * 校验表达式能否作为 console.log(...) 的参数通过 V8 语法编译。
 */
export function validateLogpointExpression(expression: string): void {
  try {
    new Script(`console.log(${expression})`);
  } catch (error) {
    throw new Error(
      `The logpoint expression \`${expression}\` does not compile: ${error instanceof Error ? error.message : String(error)}. Provide the expression like arguments to console.log(...).`,
    );
  }
}

function locationKey(
  url: string,
  lineNumber: number,
  columnNumber: number | undefined,
): string {
  return `${url}:${lineNumber}${columnNumber === undefined ? '' : `:${columnNumber}`}`;
}

/**
 * 基于 CDP 条件断点实现的非暂停日志点（Logpoint）管理器。
 *
 * 将表达式包装为 `((() => { console.log(...); return false; })())`，
 * 确保每次命中只输出到 console 而不暂停页面执行。
 */
export class LogpointManager {
  readonly #records = new Map<string, Logpoint>();

  async setLogpoints(
    debuggerManager: DebuggerManager,
    desired: LogpointOptions[],
  ): Promise<Logpoint[]> {
    for (const item of desired) {
      validateLogpointExpression(item.expression);
    }

    const scripts = debuggerManager.getScripts();
    const resolvedByKey = new Map<
      string,
      {options: LogpointOptions; resolvedUrl: string; key: string}
    >();

    for (const options of desired) {
      const resolvedUrl = resolveScriptUrl(scripts, options.url);
      const key = locationKey(
        resolvedUrl,
        options.lineNumber,
        options.columnNumber,
      );
      resolvedByKey.set(key, {options, resolvedUrl, key});
    }

    // 先移除不再保留的旧 logpoint（以及表达式有变化的条目，便于重建）
    for (const [key, existing] of [...this.#records.entries()]) {
      const next = resolvedByKey.get(key);
      if (!next || next.options.expression !== existing.expression) {
        await debuggerManager
          .removeBreakpoint(existing.breakpointId)
          .catch(() => undefined);
        this.#records.delete(key);
      }
    }

    const failedKeys: string[] = [];
    for (const [key, {options, resolvedUrl}] of resolvedByKey.entries()) {
      if (this.#records.has(key)) {
        continue;
      }
      const condition = `((() => { console.log(${options.expression}); return false; })())`;
      try {
        const bp = await debuggerManager.setBreakpointByUrl({
          url: resolvedUrl,
          lineNumber: options.lineNumber - 1,
          columnNumber:
            options.columnNumber !== undefined ? options.columnNumber - 1 : 0,
          condition,
        });
        const bound = Boolean(bp.location || bp.breakpointId);
        this.#records.set(key, {
          url: resolvedUrl,
          lineNumber: options.lineNumber,
          ...(options.columnNumber !== undefined
            ? {columnNumber: options.columnNumber}
            : {}),
          expression: options.expression,
          breakpointId: bp.breakpointId,
          bound,
        });
      } catch {
        failedKeys.push(key);
      }
    }

    const logpoints = [...this.#records.values()];
    if (failedKeys.length > 0) {
      throw new LogpointError(
        `Failed to bind logpoint(s) at ${failedKeys.join(', ')}.`,
        logpoints,
      );
    }
    return logpoints;
  }

  getLogpoints(): Logpoint[] {
    return [...this.#records.values()];
  }

  clear(): void {
    this.#records.clear();
  }
}

function resolveScriptUrl(
  scripts: Array<{url?: string}>,
  requestedUrl: string,
): string {
  const exact = scripts.find(s => s.url === requestedUrl);
  if (exact?.url) {
    return exact.url;
  }
  const normalizedSuffix = requestedUrl.startsWith('/')
    ? requestedUrl
    : `/${requestedUrl}`;
  const suffixMatches = scripts.filter(
    s =>
      typeof s.url === 'string' &&
      (s.url.endsWith(normalizedSuffix) || s.url.endsWith(requestedUrl)),
  );
  if (suffixMatches.length === 1 && suffixMatches[0]?.url) {
    return suffixMatches[0].url;
  }
  return requestedUrl;
}

export function formatLogpoints(logpoints: Logpoint[]): string {
  if (logpoints.length === 0) {
    return 'No logpoints are active on this page.';
  }
  return logpoints
    .map(lp => {
      const col = lp.columnNumber !== undefined ? `:${lp.columnNumber}` : '';
      return `${lp.url}:${lp.lineNumber}${col} [${lp.bound ? 'bound' : 'pending'}] ${lp.expression}`;
    })
    .join('\n');
}
