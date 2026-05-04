/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AggregatedIssue} from '../../third_party/index.js';
import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';

import type {
  ConsoleMessageEntry,
  ConsoleMessageData,
} from './types.js';
import {isAggregatedIssue} from './types.js';

/**
 * 通过 ID 获取单条 Console 消息（defineTool 模式）。
 *
 * 使用 defineTool 包装，与 old-source 结构保持一致。
 */
export const getConsoleMessage = defineTool({
  name: 'get_console_message',
  description: 'Gets a console message by its ID. Returns structured message data including type, text, and arguments.',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    msgid: zod
      .number()
      .describe('The msgid of a console message on the page from the listed console messages'),
  },
  handler: async (request, response) => {
    try {
      const message = getRuntime().contextProvider!.getConsoleMessageById(request.params.msgid);
      const consoleMessageStableId = request.params.msgid;

      let data: ConsoleMessageData;

      if ('args' in message) {
        const consoleMessage = message as unknown as ConsoleMessageEntry;
        data = {
          consoleMessageStableId,
          type: consoleMessage.type(),
          message: consoleMessage.text(),
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
        };
      } else {
        data = {
          consoleMessageStableId,
          type: 'error',
          message: String(
            (message as unknown as Record<string, unknown>).message ??
              '<unknown error>',
          ),
          args: [],
        };
      }

      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(data, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});
