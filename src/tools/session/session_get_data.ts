/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CaptureSource} from '../../modules/session/types.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const sessionGetData = defineTool({
  name: 'session_get_data',
  description:
    '获取指定会话的结构化请求、加解密 Hook 日志与 Storage 快照。默认取当前活动会话。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    sessionId: zod.string().optional().describe('会话 ID，默认当前活动会话。'),
    sources: zod
      .array(zod.enum(['cdp', 'proxy']))
      .optional()
      .describe('来源过滤。'),
    urlFilter: zod.string().optional().describe('URL 关键字过滤。'),
    includeHooks: zod
      .boolean()
      .optional()
      .describe('是否包含 Hook 日志，默认 true。'),
    includeSnapshots: zod
      .boolean()
      .optional()
      .describe('是否包含 Storage 快照，默认 true。'),
  },
  handler: async (request, response) => {
    const {sessionId, sources, urlFilter, includeHooks, includeSnapshots} =
      request.params as {
        sessionId?: string;
        sources?: CaptureSource[];
        urlFilter?: string;
        includeHooks?: boolean;
        includeSnapshots?: boolean;
      };

    const manager = getRuntime().captureSessionManager;

    let session;
    if (sessionId) {
      session = manager.getSession(sessionId);
      if (!session) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `No session found with id: ${sessionId}`,
        );
      }
    } else {
      session = manager.requireActiveSession();
    }

    const requests = manager.getRequests(session.id, {sources, urlFilter});
    const hooks = includeHooks !== false ? manager.getHooks(session.id) : [];
    const snapshots =
      includeSnapshots !== false ? manager.getSnapshots(session.id) : [];

    response.setStructuredContent({
      session,
      requests,
      hooks,
      snapshots,
      tooltype: 'session_get_data',
    });
  },
});
