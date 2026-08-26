/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ExportMitmCaParams} from '../../modules/proxy/index.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const exportMitmCa = defineTool({
  name: 'export_mitm_ca',
  description:
    '导出 MITM 根 CA 证书（PEM 或 DER），供客户端信任以解密 HTTPS 流量。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    format: zod.enum(['pem', 'der']).default('pem').describe('证书格式。'),
    outputPath: zod.string().describe('导出文件路径。'),
  },
  handler: async (request, response) => {
    const result = await getRuntime().mitmModule.exportCa(
      request.params as ExportMitmCaParams,
    );
    response.setStructuredContent({...result, tooltype: 'export_mitm_ca'});
  },
});
