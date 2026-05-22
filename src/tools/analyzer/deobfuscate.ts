/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import type {DeobfuscateCodeResult} from './types.js';

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
      const result = await getRuntime().deobfuscator.deobfuscate(request.params as any);
      response.setStructuredContent<DeobfuscateCodeResult>({
        success: true,
        message: 'Deobfuscation completed',
        tooltype: 'deobfuscate',
        data: result,
      });
    } catch (error) {
      response.setStructuredContent<DeobfuscateCodeResult>({
        success: false,
        message: `Deobfuscation failed: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'deobfuscate',
        data: {} as DeobfuscateCodeResult['data'],
      });
    }
  },
});
