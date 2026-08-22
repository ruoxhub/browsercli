/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import type {UnderstandCodeOptions} from '../../types/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import {executeAnalysis} from './analysisExecution.js';

export const understandCode = defineTool({
  name: 'understand_code',
  description: '结合 AI 与静态分析，分析代码结构、业务逻辑与安全性。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    code: zod.string(),
    focus: zod.enum(['all', 'structure', 'business', 'security']).optional(),
    useAI: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    const runtime = getRuntime();
    const params = request.params as UnderstandCodeOptions;
    const useAI = params.useAI ?? true;

    const result = await executeAnalysis({
      toolName: 'understand_code',
      useAI,
      localAnalysis: () =>
        runtime.analyzer.understand({
          ...params,
          useAI: false,
        }),
      aiEnrichment: () =>
        runtime.analyzer.understand({
          ...params,
          useAI: true,
        }),
    });

    response.setStructuredContent({
      success: true,
      message: 'Code analysis completed',
      tooltype: 'understand',
      meta: result.meta,
      data: result.data,
    });
  },
});
