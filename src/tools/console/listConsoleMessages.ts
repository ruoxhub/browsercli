/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  mapIssueToMessageObject,
} from '../../utils/DevtoolsUtils.js';
import {getRuntime} from '../../runtime.js';

import type {
  ConsoleMessageData,
  ConsoleMessageEntry,
  ConsoleResponseType,
  ListConsoleMessagesData,
  ListConsoleMessagesParams,
  ListConsoleMessagesResult,
} from './types.js';
import {isAggregatedIssue} from './types.js';

/**
 * 列出当前页面的所有 Console 消息（纯函数版本）。
 *
 * @param runtime - Console 运行时服务
 * @param params - 查询参数（分页、类型过滤等）
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function listConsoleMessages(
  params?: ListConsoleMessagesParams,
): Promise<ListConsoleMessagesResult> {
  try {
    const includePreserved = params?.includePreservedMessages ?? false;
    let messages = getRuntime().contextProvider!.getConsoleData(includePreserved);

    // 按类型过滤
    if (params?.types?.length) {
      const normalizedTypes = new Set(params.types);
      messages = messages.filter(message => {
        if ('type' in message && typeof (message as ConsoleMessageEntry).type === 'function') {
          const msgType = (message as ConsoleMessageEntry).type();
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
          const sourceMapHints = getRuntime().contextProvider!.getConsoleSourceMapHints?.(item);

          if ('args' in item) {
            const consoleMessage = item as ConsoleMessageEntry;
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
                      : remoteObj.description ?? String(undefined);
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
    const pageSize = params?.pageSize;
    const pageIdx = params?.pageIdx ?? 0;

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

    return {
      success: true,
      message: `共 ${total} 条消息，返回 ${pagedData.length} 条`,
      tooltype: 'list_console_messages',
      logFormat: 'json',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `列出消息失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'list_console_messages',
      logFormat: 'json',
      data: {
        messages: [],
        total: 0,
        pageIdx: 0,
        pageSize: undefined,
      },
    };
  }
}
