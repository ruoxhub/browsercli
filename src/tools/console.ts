/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {type AggregatedIssue, zod} from '../third_party/index.js';
import {mapIssueToMessageObject} from '../utils/DevtoolsUtils.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';

import {ToolCategory} from './categories.js';
import type {DomainManifest} from './manifest.js';
import type {MessagesResult} from './shared/types.js';
import {definePageTool} from './ToolDefinition.js';

// ─── types.ts ────────────────────────────────────────────

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
  /** 堆栈信息（includeStackTraces=true 时可选附带） */
  stackTrace?: unknown;
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
  /** 是否包含堆栈信息 */
  includeStackTraces?: boolean;
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
  /** 确保 Console 收集会话已就绪（按需激活 CDP Runtime.enable） */
  ensureConsoleEnabled?: () => Promise<void>;
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

// ─── getConsoleMessage.ts ────────────────────────────────

/**
 * 通过 ID 获取单条 Console 消息（definePageTool 模式）。
 *
 * 使用 definePageTool 包装，与 old-source 结构保持一致。
 */
export const getConsoleMessage = definePageTool({
  name: 'get_console_message',
  description:
    '按 ID 获取单条 Console 消息，返回包含类型、文本与参数的结构化数据。',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    msgid: zod
      .number()
      .describe('页面 Console 消息的 msgid，来自已列出的 Console 消息列表。'),
  },
  handler: async (request, response, context) => {
    let data;
    let message;
    try {
      await context.ensureConsoleEnabled?.();
      if (!context.getConsoleMessageById) {
        throw new Error('Console 消息查询能力不可用');
      }
      const consoleMessage = context.getConsoleMessageById(
        request.params.msgid,
      );
      const consoleMessageStableId = request.params.msgid;

      if (
        !(consoleMessage instanceof Error) &&
        typeof (consoleMessage as any).args === 'function'
      ) {
        const msg = consoleMessage as any;
        message = msg.text();
        data = {
          consoleMessageStableId,
          args: await Promise.all(
            msg.args().map(async (arg: any) => {
              const remoteObj = arg.remoteObject();
              const value = remoteObj.value;
              const stringArg =
                value !== undefined
                  ? value
                  : (remoteObj.description ?? String(undefined));
              return typeof stringArg === 'object'
                ? JSON.stringify(stringArg)
                : String(stringArg);
            }),
          ),
        };
      } else if (isAggregatedIssue(consoleMessage)) {
        const issue = consoleMessage as unknown as AggregatedIssue;
        message = issue.title?.() ?? issue.code() ?? '<unknown error>';
        data = {
          consoleMessageStableId,
          args: [],
        };
      } else {
        const err = consoleMessage as Error;
        message = err.message ?? '<unknown error>';
        data = {
          consoleMessageStableId,
          type: 'error',
          message: String(err.message ?? '<unknown error>'),
          args: [],
        };
      }
      const responseData = {
        success: true,
        message: message,
        tooltype: 'get_console_message',
        data: data,
      };
      response.setStructuredContent(responseData);
    } catch (error) {
      data = {
        consoleMessageStableId: request.params.msgid,
        type: 'error',
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        args: [],
      };
      const responseData = {
        success: true,
        message: `Console message retrieved error`,
        tooltype: 'get_console_message',
        data: data,
      };
      response.setStructuredContent(responseData);
    }
  },
});

// ─── listConsoleMessages.ts ──────────────────────────────

/**
 * 列出当前页面的所有 Console 消息（definePageTool 模式）。
 */
export const listConsoleMessages = definePageTool({
  name: 'list_console_messages',
  description:
    '列出当前选中页面自上次导航以来的所有 Console 消息，支持按类型过滤与分页。',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  blockedByDialog: false,
  concurrency: 'page',
  schema: {
    pageSize: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('返回的最大消息数量。省略时返回全部消息。'),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe('要返回的页码（从 0 开始）。省略时返回第一页。'),
    types: zod
      .array(zod.enum(FILTERABLE_MESSAGE_TYPES))
      .optional()
      .describe('仅返回指定类型的消息。省略或为空时返回全部消息。'),
    includePreservedMessages: zod
      .boolean()
      .default(false)
      .optional()
      .describe('设为 true 可返回最近 3 次导航内保留的消息。'),
    includeStackTraces: zod
      .boolean()
      .default(false)
      .optional()
      .describe('是否附带每条消息的位置或错误堆栈（默认 false）。'),
  },
  handler: async (request, response, context) => {
    let result: ListConsoleMessagesResult;
    try {
      await context.ensureConsoleEnabled?.();
      const includePreserved = request.params.includePreservedMessages ?? false;
      const includeStackTraces = request.params.includeStackTraces ?? false;
      let messages = context.getConsoleData?.(includePreserved) ?? [];

      // 按类型过滤
      if (request.params.types?.length) {
        const normalizedTypes = new Set(request.params.types);
        messages = messages.filter(message => {
          if (
            'type' in message &&
            typeof (message as unknown as ConsoleMessageEntry).type ===
              'function'
          ) {
            const msgType = (message as unknown as ConsoleMessageEntry).type();
            return normalizedTypes.has(msgType as ConsoleResponseType);
          }
          if (isAggregatedIssue(message)) {
            return normalizedTypes.has('issue');
          }
          return normalizedTypes.has('error');
        });
      }

      // 转换为 ConsoleMessageData
      const allData = (
        await Promise.all(
          messages.map(async (item): Promise<ConsoleMessageData | null> => {
            const consoleMessageStableId =
              context.getConsoleMessageStableId?.(item) ?? -1;
            const sourceMapHints = undefined; // getConsoleSourceMapHints not available in ToolContextProvider

            if ('args' in item) {
              const consoleMessage = item as unknown as ConsoleMessageEntry & {
                location?: () => unknown;
              };
              const locationTrace = includeStackTraces
                ? consoleMessage.location?.()
                : undefined;
              return {
                consoleMessageStableId,
                type: consoleMessage.type(),
                message: consoleMessage.text(),
                sourceMapHints,
                args: await Promise.all(
                  consoleMessage.args().map(async arg => {
                    const remoteObj = arg.remoteObject();
                    const value = remoteObj.value;
                    const stringArg =
                      value !== undefined
                        ? value
                        : (remoteObj.description ?? String(undefined));
                    return typeof stringArg === 'object'
                      ? JSON.stringify(stringArg)
                      : String(stringArg);
                  }),
                ),
                ...(locationTrace !== undefined
                  ? {stackTrace: locationTrace}
                  : {}),
              };
            }
            if (isAggregatedIssue(item)) {
              const mappedIssueMessage = mapIssueToMessageObject(item);
              if (!mappedIssueMessage) return null;
              return {
                consoleMessageStableId,
                ...mappedIssueMessage,
                sourceMapHints,
              };
            }
            const errRecord = item as unknown as Record<string, unknown>;
            return {
              consoleMessageStableId,
              type: 'error',
              message: String(errRecord.message ?? '<unknown error>'),
              args: [],
              sourceMapHints,
              ...(includeStackTraces && errRecord.stack !== undefined
                ? {stackTrace: errRecord.stack}
                : {}),
            };
          }),
        )
      ).filter((item): item is ConsoleMessageData => item !== null);

      // 分页
      const total = allData.length;
      const pageSize = request.params.pageSize;
      const pageIdx = request.params.pageIdx ?? 0;

      let pagedData: ConsoleMessageData[];
      if (pageSize) {
        const start = pageIdx * pageSize;
        pagedData = allData.slice(start, start + pageSize);
      } else {
        pagedData = allData;
      }

      const data: ListConsoleMessagesData = {
        messages: pagedData,
        total,
        pageIdx,
        pageSize,
      };
      result = {
        success: true,
        message: `Listed ${data.messages.length} console messages`,
        tooltype: 'list_console_messages',
        logFormat: 'json',
        data,
      };
      response.setStructuredContent(result);
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `List console messages failed: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'list_console_messages'},
      );
    }
  },
});

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'console',
  description: 'Browser console inspection tools.',
  profile: 'workflow',
  tools: [
    {
      modulePath: './console.js',
      handlerName: 'listConsoleMessages',
    },
    {
      modulePath: './console.js',
      handlerName: 'getConsoleMessage',
    },
  ],
} satisfies DomainManifest;
