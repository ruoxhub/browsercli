/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Console 消息格式化器（ADR-0010）：
 * 供 DeclarativeResponse.materialize() 与 console 工具共用，
 * 统一产出结构化列表、单条明细与简洁文本行。
 */

import type {ConsoleMessage} from '../third_party/index.js';
import type {PaginationOptions} from '../utils/types.js';

export interface FormattedConsoleItem {
  msgid: number;
  type: string;
  text: string;
  args?: string[];
}

export interface FormattedConsoleList {
  total: number;
  pageIdx: number;
  pageSize: number;
  items: FormattedConsoleItem[];
  lines: string[];
}

function getMessageType(item: ConsoleMessage | Error): string {
  if (item instanceof Error) {
    return 'error';
  }
  const maybeMsg = item as unknown as {type?: () => string};
  return typeof maybeMsg.type === 'function' ? maybeMsg.type() : 'log';
}

function getMessageText(item: ConsoleMessage | Error): string {
  if (item instanceof Error) {
    return item.message || String(item);
  }
  const maybeMsg = item as unknown as {text?: () => string};
  return typeof maybeMsg.text === 'function' ? maybeMsg.text() : String(item);
}

export function formatConsoleMessageDetail(
  msgid: number,
  item: ConsoleMessage | Error,
): {detail: FormattedConsoleItem; line: string} {
  const type = getMessageType(item);
  const text = getMessageText(item);
  const detail: FormattedConsoleItem = {msgid, type, text};
  return {
    detail,
    line: `msgid=${msgid} [${type}] ${text}`,
  };
}

export function formatConsoleMessages(
  messages: Array<ConsoleMessage | Error>,
  getStableId: (msg: ConsoleMessage | Error) => number,
  options?: PaginationOptions & {types?: string[]},
): FormattedConsoleList {
  const typeFilter = options?.types?.length ? new Set(options.types) : null;
  const filtered = typeFilter
    ? messages.filter(m => typeFilter.has(getMessageType(m)))
    : messages;

  const total = filtered.length;
  const pageSize =
    options?.pageSize && options.pageSize > 0 ? options.pageSize : total || 20;
  const pageIdx = options?.pageIdx && options.pageIdx >= 0 ? options.pageIdx : 0;
  const start = pageIdx * pageSize;
  const slice = filtered.slice(start, start + pageSize);

  const items: FormattedConsoleItem[] = [];
  const lines: string[] = [];
  for (const msg of slice) {
    const msgid = getStableId(msg);
    const {detail, line} = formatConsoleMessageDetail(msgid, msg);
    items.push(detail);
    lines.push(line);
  }

  return {total, pageIdx, pageSize, items, lines};
}
