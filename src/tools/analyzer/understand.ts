/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import type {UnderstandCodeFnResult} from './types.js';

export const understandCode = defineTool({
  name: 'understand_code',
  description: '结合 AI 与静态分析，分析代码结构、业务逻辑与安全性。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    code: zod.string(),
    focus: zod.enum(['all', 'structure', 'business', 'security']).optional(),
  },
  handler: async (request, response) => {
    try {
      const result = await getRuntime().analyzer.understand(
        request.params as any,
      );
      response.setStructuredContent({
        success: true,
        message: 'Code analysis completed',
        tooltype: 'understand',
        data: result,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `Code analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'understand',
        data: {} as UnderstandCodeFnResult['data'],
      });
    }
  },
});
