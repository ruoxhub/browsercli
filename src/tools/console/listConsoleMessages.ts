/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {mapIssueToMessageObject} from '../../utils/DevtoolsUtils.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import type {
  ConsoleMessageData,
  ConsoleMessageEntry,
  ConsoleResponseType,
  ListConsoleMessagesData,
  ListConsoleMessagesResult,
} from './types.js';
import {FILTERABLE_MESSAGE_TYPES} from './types.js';
import {isAggregatedIssue} from './types.js';

/**
 * 列出当前页面的所有 Console 消息（defineTool 模式）。
 */
export const listConsoleMessages = defineTool({
  name: 'list_console_messages',
  description:
    '列出当前选中页面自上次导航以来的所有 Console 消息，支持按类型过滤与分页。',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    pageSize: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        '返回的最大消息数量。省略时返回全部消息。',
      ),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        '要返回的页码（从 0 开始）。省略时返回第一页。',
      ),
    types: zod
      .array(zod.enum(FILTERABLE_MESSAGE_TYPES))
      .optional()
      .describe(
        '仅返回指定类型的消息。省略或为空时返回全部消息。',
      ),
    includePreservedMessages: zod
      .boolean()
      .default(false)
      .optional()
      .describe(
        '设为 true 可返回最近 3 次导航内保留的消息。',
      ),
  },
  handler: async (request, response) => {
    let result: ListConsoleMessagesResult;
    try {
      const includePreserved = request.params.includePreservedMessages ?? false;
      let messages =
        getRuntime().contextProvider!.getConsoleData(includePreserved);

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
              getRuntime().contextProvider!.getConsoleMessageStableId(item);
            const sourceMapHints = undefined; // getConsoleSourceMapHints not available in ToolContextProvider

            if ('args' in item) {
              const consoleMessage = item as unknown as ConsoleMessageEntry;
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
            return {
              consoleMessageStableId,
              type: 'error',
              message: String(
                (item as unknown as Record<string, unknown>).message ??
                  '<unknown error>',
              ),
              args: [],
              sourceMapHints,
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
      result = {
        success: false,
        message: `List console messages failed: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'list_console_messages',
        logFormat: 'json',
        data: null,
      };
    }
  },
});
