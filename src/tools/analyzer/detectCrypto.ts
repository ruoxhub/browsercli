/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import type {DetectCryptoFnResult} from './types.js';

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
      const raw = await getRuntime().cryptoDetector.detect(request.params as any);
      response.setStructuredContent<DetectCryptoFnResult>({
        success: true,
        message: 'Crypto detection completed',
        tooltype: 'detectCrypto',
        data: {
          algorithms: raw.algorithms ?? [],
          libraries: raw.libraries ?? [],
          confidence: raw.confidence ?? 0,
          securityIssues: raw.securityIssues ?? [],
          strength: raw.strength,
        },
      });
    } catch (error) {
      response.setStructuredContent<DetectCryptoFnResult>({
        success: false,
        message: `Crypto detection failed: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'detectCrypto',
        data: {
          algorithms: [],
          libraries: [],
          confidence: 0,
          securityIssues: [],
          strength: undefined,
        },
      });
    }
  },
});