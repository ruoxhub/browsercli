/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import type {AggregatedIssue} from '../../third_party/index.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import {isAggregatedIssue} from './types.js';

/**
 * 通过 ID 获取单条 Console 消息（defineTool 模式）。
 *
 * 使用 defineTool 包装，与 old-source 结构保持一致。
 */
export const getConsoleMessage = defineTool({
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
  handler: async (request, response) => {
    let data;
    let message;
    try {
      const provider = getRuntime().contextProvider;
      await (provider as any)?.ensureConsoleEnabled?.();
      const consoleMessage = provider!.getConsoleMessageById(
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
