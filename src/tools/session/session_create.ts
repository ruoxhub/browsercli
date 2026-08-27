/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const sessionCreate = defineTool({
  name: 'session_create',
  description: '创建新的抓包会话并设为当前活跃会话。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    name: zod.string().min(1).describe('抓包会话名称。'),
    targetUrl: zod.string().optional().describe('目标页面或网站 URL。'),
  },
  handler: async (request, response) => {
    const session = getRuntime().captureSessionManager.createSession(
      request.params as {name: string; targetUrl?: string},
    );
    response.setStructuredContent({session, tooltype: 'session_create'});
  },
});
