/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const sessionList = defineTool({
  name: 'session_list',
  description: '列出所有抓包会话。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response) => {
    const sessions = getRuntime().captureSessionManager.listSessions();
    response.setStructuredContent({sessions, tooltype: 'session_list'});
  },
});
