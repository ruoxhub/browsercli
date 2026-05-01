/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import type {UnderstandCodeOptions} from '../../types/index.js';

import type {UnderstandCodeFnResult} from './types.js';

export async function understandCode(
  options: UnderstandCodeOptions,
): Promise<UnderstandCodeFnResult> {
  try {
    const data = await getRuntime().analyzer.understand(options);
    return {
      success: true,
      message: 'Code analysis completed',
      tooltype: 'understand',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `Code analysis failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'understand',
      data: {} as UnderstandCodeFnResult['data'],
    };
  }
}