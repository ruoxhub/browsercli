/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AggregatedIssue} from '../../third_party/index.js';
import type {MessagesResult} from '../shared/types.js';

export type ConsoleMessageType =
  | 'log'
  | 'debug'
  | 'info'
  | 'error'
  | 'warn'
  | 'dir'
  | 'dirxml'
  | 'table'
  | 'trace'
  | 'clear'
  | 'startGroup'
  | 'startGroupCollapsed'
  | 'endGroup'
  | 'assert'
  | 'profile'
  | 'profileEnd'
  | 'count'
  | 'timeEnd'
  | 'verbose';

/** Console 响应类型（兼容 puppeteer ConsoleMessageType + issue） */
export type ConsoleResponseType = ConsoleMessageType | 'issue';

/** 可过滤的消息类型列表 */
export const FILTERABLE_MESSAGE_TYPES: [
  ConsoleResponseType,
  ...ConsoleResponseType[],
] = [
  'log',
  'debug',
  'info',
  'error',
  'warn',
  'dir',
  'dirxml',
  'table',
  'trace',
  'clear',
  'startGroup',
  'startGroupCollapsed',
  'endGroup',
  'assert',
  'profile',
  'profileEnd',
  'count',
  'timeEnd',
  'verbose',
  'issue',
];

/** 单条 Console 消息的结构化数据 */
export interface ConsoleMessageData {
  /** 稳定 ID（由 collector 分配） */
  consoleMessageStableId: number;
  /** 消息类型 (log/warn/error/issue/...) */
  type?: string;
  /** AggregatedIssue 对象（仅 issue 类型） */
  item?: AggregatedIssue;
  /** 消息文本 */
  message?: string;
  /** 重复计数（仅 issue 类型） */
  count?: number;
  /** issue 描述（Markdown） */
  description?: string;
  /** 消息参数序列化 */
  args?: string[];
  /** SourceMap 提示 */
  sourceMapHints?: Record<string, string>;
}

/** listConsoleMessages 参数 */
export interface ListConsoleMessagesParams {
  /** 每页最大条数，省略返回全部 */
  pageSize?: number;
  /** 页码（0-based），省略返回第一页 */
  pageIdx?: number;
  /** 按消息类型过滤 */
  types?: ConsoleResponseType[];
  /** 是否包含最近 3 次导航的保留消息 */
  includePreservedMessages?: boolean;
}

/** getConsoleMessage 参数 */
export interface GetConsoleMessageParams {
  /** Console 消息稳定 ID */
  msgid: number;
}

/** Console 运行时服务（从 McpContext 提取的接口） */
export interface ConsoleRuntimeServices {
  /** 获取当前选中页面 */
  getSelectedPage: () => unknown;
  /** 获取 console 数据列表 */
  getConsoleData: (includePreservedMessages?: boolean) => ConsoleMessageEntry[];
  /** 通过 ID 获取单条 console 消息 */
  getConsoleMessageById: (id: number) => ConsoleMessageEntry;
  /** 获取消息的稳定 ID */
  getConsoleMessageStableId: (message: ConsoleMessageEntry) => number;
  /** SourceMap 提示获取（可选） */
  getConsoleSourceMapHints?: (
    message: ConsoleMessageEntry,
  ) => Record<string, string> | undefined;
}

/**
 * Console 消息条目最小接口（兼容 puppeteer ConsoleMessage / Error / AggregatedIssue）。
 * 使用宽松类型以避免 TS 联合收窄问题，运行时通过 `isAggregatedIssue` 区分。
 */
export interface ConsoleMessageEntry {
  type(): string;
  text(): string;
  args(): Array<{
    remoteObject(): {
      objectId?: string;
      value?: unknown;
      description?: string;
    };
  }>;
  [key: string]: unknown;
}

/** listConsoleMessages 返回数据 */
export interface ListConsoleMessagesData {
  messages: ConsoleMessageData[];
  total: number;
  pageIdx: number;
  pageSize: number | undefined;
}

/** getConsoleMessage 返回数据 */
export type GetConsoleMessageData = ConsoleMessageData;

/** listConsoleMessages 结果 */
export interface ListConsoleMessagesResult extends MessagesResult<ListConsoleMessagesData> {
  tooltype: string;
  logFormat: string;
}

/** getConsoleMessage 结果 */
export interface GetConsoleMessageResult extends MessagesResult<GetConsoleMessageData> {
  tooltype: string;
  logFormat: string;
}

/** 判断是否为 AggregatedIssue */
export function isAggregatedIssue(value: unknown): value is AggregatedIssue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as Record<string, unknown>).code === 'function'
  );
}
