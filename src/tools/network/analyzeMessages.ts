/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import type {AnalyzeWebSocketMessagesParams} from './types.js';

const DIRECTION_OPTIONS: readonly ['sent', 'received'] = ['sent', 'received'];

export const analyzeWebSocketMessages = defineTool({
  name: 'analyze_websocket_messages',
  description: `Analyzes WebSocket messages and groups them by pattern/fingerprint. Essential for understanding binary/protobuf message types in live streaming scenarios. Returns statistics and sample indices for each message type.`,
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    wsid: zod
      .number()
      .describe('The wsid of the WebSocket connection to analyze.'),
    direction: zod
      .enum(DIRECTION_OPTIONS)
      .optional()
      .describe('Only analyze messages in this direction.'),
  },
  handler: async (request, response) => {
    const result = await getRuntime().networkModule.analyzeWebSocketMessages(
      getRuntime().contextProvider!,
      request.params as AnalyzeWebSocketMessagesParams,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'analyze_websocket_messages',
    });
  },
});
