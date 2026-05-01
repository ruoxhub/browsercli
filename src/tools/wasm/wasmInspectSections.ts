/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {readFile} from 'node:fs/promises';

import {getRuntime} from '../../runtime.js';

import type {
  WasmInspectSectionsParams,
  WasmInspectSectionsResult,
} from './types.js';

export async function wasmInspectSections(
  params: WasmInspectSectionsParams,
): Promise<WasmInspectSectionsResult> {
  const tooltype = 'wasm_inspect_sections';

  try {
    const bytes = Uint8Array.from(await readFile(params.inputPath));
    const runtime = getRuntime();

    const analysis = runtime.wasmAnalyzer.analyzeBinary(bytes, {
      includeFunctionSignatures: true,
      includeRawSectionMap: params.sections === 'all' || params.sections === 'disassemble',
      includeStringScan: true,
      maskSensitiveStrings: false,
    });

    return {
      success: true,
      message: `分析完成：${analysis.sections.length} 个 section，${analysis.functionCount} 个函数，${analysis.importCount} 个导入，${analysis.exportCount} 个导出`,
      tooltype,
      logFormat: 'json',
      data: {
        inputPath: params.inputPath,
        analysis,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `WASM section 检查失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}
