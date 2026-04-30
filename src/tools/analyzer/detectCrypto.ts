/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DetectCryptoOptions} from '../../types/index.js';

import type {AnalyzerRuntimeServices, DetectCryptoFnResult} from './types.js';

export async function detectCrypto(
  runtime: AnalyzerRuntimeServices,
  options: DetectCryptoOptions,
): Promise<DetectCryptoFnResult> {
  try {
    const raw = await runtime.cryptoDetector.detect(options);
    return {
      success: true,
      message: 'Crypto detection completed',
      tooltype: 'detectCrypto',
      data: {
        algorithms: raw.algorithms,
        libraries: raw.libraries,
        confidence: raw.confidence,
        securityIssues: raw.securityIssues,
        strength: raw.strength,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Crypto detection failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'detectCrypto',
      data: {
        algorithms: [],
        libraries: [],
        confidence: 0,
      },
    };
  }
}