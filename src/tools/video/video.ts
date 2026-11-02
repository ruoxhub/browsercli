/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {VideoError} from '../../modules/video/errors.js';
import type {VideoParams} from '../../modules/video/types.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {safeStringify} from '../../utils/safeJson.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const video = defineTool({
  name: 'video',
  description:
    'Record and manage browser session video via CDP screencast. Supports start, stop, status, save, read, list, discard, and capabilities.',
  annotations: {
    title: '视频录制',
    category: ToolCategory.SCREENSHOT,
    readOnlyHint: false,
  },
  schema: {
    action: zod
      .enum([
        'capabilities',
        'start',
        'status',
        'stop',
        'save',
        'read',
        'list',
        'discard',
      ])
      .describe('Action to perform'),
    recording_id: zod
      .string()
      .optional()
      .describe(
        'Target recording ID (required for status, stop, save, read, discard)',
      ),
    tab_id: zod.number().optional().describe('Target tab index to record'),
    session_id: zod
      .string()
      .optional()
      .describe('Caller session ID for grouping'),
    quality: zod
      .enum(['standard', 'clear'])
      .optional()
      .describe('Video quality preset (standard=1280@15fps, clear=1920@30fps)'),
    max_duration_ms: zod
      .number()
      .optional()
      .describe(
        'Maximum recording duration in milliseconds (default 60000, max 600000)',
      ),
    request_id: zod.string().optional().describe('Idempotency token for start'),
    output: zod
      .string()
      .optional()
      .describe('Destination file path when saving recording'),
    overwrite: zod
      .boolean()
      .optional()
      .describe('Overwrite destination file if it exists'),
    offset: zod
      .number()
      .optional()
      .describe('Byte offset when reading video chunks'),
  },
  handler: async (request, response) => {
    const videoManager = getRuntime().videoManager;
    if (!videoManager) {
      throw createToolError(
        ErrorCodes.INTERNAL_ERROR,
        'VideoManager service is unavailable',
      );
    }

    try {
      const result = await videoManager.rpc(request.params as VideoParams);
      response.setStructuredContent(result);
      response.appendResponseLine(safeStringify(result));
    } catch (err) {
      if (err instanceof VideoError) {
        const errorPayload = {
          error: {
            code: err.code,
            message: err.message,
            data: err.data,
          },
        };
        response.setStructuredContent(errorPayload);
        response.appendResponseLine(safeStringify(errorPayload));
      } else {
        throw err;
      }
    }
  },
});
