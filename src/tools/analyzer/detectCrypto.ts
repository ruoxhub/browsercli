/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {getRuntime} from '../../runtime.js';
import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';

export const detectCrypto = defineTool({
  name: 'detect_crypto',
  description: 'Detect cryptographic algorithms/libraries from JavaScript source.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    code: zod.string(),
    useAI: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    try {
      const raw = await getRuntime().cryptoDetector.detect(request.params);
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify({
        success: true,
        message: 'Crypto detection completed',
        tooltype: 'detect_crypto',
        data: {
          algorithms: raw.algorithms,
          libraries: raw.libraries,
          confidence: raw.confidence,
          securityIssues: raw.securityIssues,
          strength: raw.strength,
        },
      }, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify({
        success: false,
        message: `Crypto detection failed: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'detect_crypto',
        data: {
          algorithms: [],
          libraries: [],
          confidence: 0,
        },
      }, null, 2));
      response.appendResponseLine('```');
    }
  },
});