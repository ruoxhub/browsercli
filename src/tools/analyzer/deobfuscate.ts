/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { getRuntime } from '../../runtime.js';
import type {DeobfuscateFullOptions} from '../../modules/deobfuscator/Deobfuscator.js';

import type {AnalyzerRuntimeServices, DeobfuscateCodeResult} from './types.js';

export async function deobfuscateCode(
  options: DeobfuscateFullOptions,
): Promise<DeobfuscateCodeResult> {
  try {
    const data = await getRuntime().deobfuscator.deobfuscate(options);
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