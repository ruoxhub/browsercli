/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {writeFile} from 'node:fs/promises';
import path from 'node:path';

import {getRuntime} from '../../runtime.js';

import type {
  WasmDumpParams,
  WasmDumpResult,
} from './types.js';

export async function wasmDump(
  params: WasmDumpParams,
): Promise<WasmDumpResult> {
  const tooltype = 'wasm_dump';

  try {
    const runtime = getRuntime();
    const modules = runtime.wasmCollector.getModules();
    const moduleIndex = params.moduleIndex ?? 0;

    if (modules.length === 0) {
      return {
        success: false,
        message: '当前会话未捕获任何 WASM 模块，请先使用 collect_wasm 捕获',
        tooltype,
      };
    }

    if (moduleIndex < 0 || moduleIndex >= modules.length) {
      return {
        success: false,
        message: `模块索引 ${moduleIndex} 超出范围（共 ${modules.length} 个模块）`,
        tooltype,
      };
    }

    const module = modules[moduleIndex];
    const bytes = runtime.wasmCollector.getModuleBytes(module.id);

    if (!bytes) {
      return {
        success: false,
        message: `模块 ${module.id} 的二进制数据不可用`,
        tooltype,
      };
    }

    const outputPath = params.outputPath
      ?? path.join(process.cwd(), `wasm_dump_${moduleIndex}_${module.hash.slice(0, 8)}.wasm`);

    await writeFile(outputPath, bytes);

    return {
      success: true,
      message: `已导出模块 ${module.id}（${bytes.byteLength} 字节）到 ${outputPath}`,
      tooltype,
      logFormat: 'json',
      data: {
        moduleId: module.id,
        hash: module.hash,
        size: bytes.byteLength,
        outputPath,
        sourceUrl: module.sourceUrl,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `导出 WASM 模块失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}
