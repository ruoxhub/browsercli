/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {getRuntime} from '../../runtime.js';
import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';

export const understandCode = defineTool({
  name: 'understand_code',
  description: 'Analyze code structure/business/security with AI + static analysis.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    code: zod.string(),
    focus: zod.enum(['all', 'structure', 'business', 'security']).optional(),
  },
  handler: async (request, response) => {
    try {
      const result = await getRuntime().analyzer.understand(request.params);
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify({
        success: true,
        message: 'Code analysis completed',
        tooltype: 'understand',
        data: result,
      }, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify({
        success: false,
        message: `Code analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'understand',
        data: {},
      }, null, 2));
      response.appendResponseLine('```');
    }
  },
});