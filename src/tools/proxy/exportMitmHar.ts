/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ExportMitmHarParams} from '../../modules/proxy/index.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const exportMitmHar = defineTool({
  name: 'mitm_export_har',
  description:
    '把当前捕获缓冲导出为 HAR 1.2（HTTP Archive）。outputPath 省略时直接返回 HAR 对象。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    outputPath: zod
      .string()
      .optional()
      .describe('同时把 HAR JSON 写入该文件路径；省略则只返回对象。'),
  },
  handler: async (request, response) => {
    const result = await getRuntime().mitmModule.exportHar(
      request.params as ExportMitmHarParams,
    );
    response.setStructuredContent({...result, tooltype: 'mitm_export_har'});
  },
});
