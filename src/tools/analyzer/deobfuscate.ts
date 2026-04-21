/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AnalyzerRuntimeServices, DeobfuscateCodeResult} from './types.js';
import type {DeobfuscateFullOptions} from '../../modules/deobfuscator/Deobfuscator.js';

export async function deobfuscateCode(
  runtime: AnalyzerRuntimeServices,
  options: DeobfuscateFullOptions,
): Promise<DeobfuscateCodeResult> {
  try {
    const data = await runtime.deobfuscator.deobfuscate(options);
    return {
      success: true,
      message: 'Deobfuscation completed',
      tooltype: 'deobfuscate',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `Deobfuscation failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'deobfuscate',
      data: {} as DeobfuscateCodeResult['data'],
    };
  }
}