/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {getRuntime} from '../../runtime.js';
import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';

export const deobfuscateCode = defineTool({
  name: 'deobfuscate_code',
  description: 'AI-assisted JavaScript deobfuscation.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    code: zod.string(),
    aggressive: zod.boolean().optional(),
    renameVariables: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    try {
      const result = await getRuntime().deobfuscator.deobfuscate(request.params);
      response.setStructuredContent({
        success: true,
        message: 'Deobfuscation completed',
        tooltype: 'deobfuscate',
        logFormat: 'json',
        data: result,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `Deobfuscation failed: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'deobfuscate',
        logFormat: 'json',
        data: {},
      });
    }
  },
});
