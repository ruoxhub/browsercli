/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Debugger 格式化器（ADR-0010）：
 * 将断点、调用栈、暂停态与日志点规约为统一结构与可读文本行，
 * 供 debugger 工具层复用，避免在 tool handler 内重复拼装输出格式。
 */

import type {Logpoint} from '../modules/debugger/LogpointManager.js';
import type {BreakpointInfo} from '../modules/debugger/types.js';

export interface FormattedCallFrameSummary {
  index: number;
  callFrameId: string;
  functionName: string;
  url: string;
  scriptId: string;
  lineNumber: number;
  columnNumber: number;
}

export function formatBreakpointSummary(bp: BreakpointInfo): {
  id: string;
  location: string;
  enabled: boolean;
  hitCount: number;
  condition?: string;
} {
  const loc = bp.location;
  const target = loc?.url || loc?.scriptId || '<unknown>';
  const line = loc?.lineNumber !== undefined ? `:${loc.lineNumber}` : '';
  const col = loc?.columnNumber !== undefined ? `:${loc.columnNumber}` : '';
  return {
    id: bp.breakpointId,
    location: `${target}${line}${col}`,
    enabled: bp.enabled,
    hitCount: bp.hitCount,
    ...(bp.condition ? {condition: bp.condition} : {}),
  };
}

export function formatCallFrames(
  frames: Array<{
    callFrameId: string;
    functionName?: string;
    url?: string;
    location?: {scriptId?: string; lineNumber?: number; columnNumber?: number};
  }>,
  maxFrames = 20,
): {items: FormattedCallFrameSummary[]; lines: string[]} {
  const sliced = frames.slice(0, maxFrames);
  const items: FormattedCallFrameSummary[] = [];
  const lines: string[] = [];

  for (let i = 0; i < sliced.length; i++) {
    const frame = sliced[i]!;
    const functionName = frame.functionName || '(anonymous)';
    const url = frame.url || '<inline>';
    const scriptId = frame.location?.scriptId ?? '';
    const lineNumber = frame.location?.lineNumber ?? 0;
    const columnNumber = frame.location?.columnNumber ?? 0;
    items.push({
      index: i,
      callFrameId: frame.callFrameId,
      functionName,
      url,
      scriptId,
      lineNumber,
      columnNumber,
    });
    lines.push(`#${i} ${functionName} (${url}:${lineNumber}:${columnNumber})`);
  }

  return {items, lines};
}

export function formatLogpointSummaryList(logpoints: Logpoint[]): {
  count: number;
  items: Array<{
    url: string;
    lineNumber: number;
    columnNumber?: number;
    expression: string;
    bound: boolean;
  }>;
  lines: string[];
} {
  const items = logpoints.map(lp => ({
    url: lp.url,
    lineNumber: lp.lineNumber,
    ...(lp.columnNumber !== undefined ? {columnNumber: lp.columnNumber} : {}),
    expression: lp.expression,
    bound: lp.bound,
  }));
  const lines = items.map(
    lp =>
      `${lp.url}:${lp.lineNumber}${lp.columnNumber !== undefined ? `:${lp.columnNumber}` : ''} -> ${lp.expression}`,
  );
  return {count: items.length, items, lines};
}
