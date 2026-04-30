/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AggregatedIssue} from '../../third_party/index.js';

import type {
  ConsoleMessageEntry,
  ConsoleRuntimeServices,
  GetConsoleMessageData,
  GetConsoleMessageParams,
  GetConsoleMessageResult,
} from './types.js';
import {isAggregatedIssue} from './types.js';

/**
 * 通过 ID 获取单条 Console 消息（纯函数版本）。
 *
 * @param runtime - Console 运行时服务
 * @param params - 查询参数（包含 msgid）
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function getConsoleMessage(
  runtime: ConsoleRuntimeServices,
  params: GetConsoleMessageParams,
): Promise<GetConsoleMessageResult> {
  try {
    const message = runtime.getConsoleMessageById(params.msgid);
    const consoleMessageStableId = params.msgid;
    const sourceMapHints = runtime.getConsoleSourceMapHints?.(message);

    let data: GetConsoleMessageData;

    if ('args' in message) {
      const consoleMessage = message as ConsoleMessageEntry;
      data = {
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
    } else if (isAggregatedIssue(message)) {
      const issue = message as unknown as AggregatedIssue;
      data = {
        consoleMessageStableId,
        type: 'error',
        message: issue.title?.() ?? issue.code() ?? '<unknown error>',
        args: [],
        sourceMapHints,
      };
    } else {
      data = {
        consoleMessageStableId,
        type: 'error',
        message: String(
          (message as Record<string, unknown>).message ??
            '<unknown error>',
        ),
        args: [],
        sourceMapHints,
      };
    }

    return {
      success: true,
      message: `消息 ID=${params.msgid} 获取成功`,
      tooltype: 'get_console_message',
      logFormat: 'json',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `获取消息失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'get_console_message',
      logFormat: 'json',
      data: {
        consoleMessageStableId: params.msgid,
        message: '',
        args: [],
      },
    };
  }
}
