/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {writeFile} from 'node:fs/promises';
import path from 'node:path';

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const wasmDump = defineTool({
  name: 'wasm_dump',
  description: '将捕获的 Wasm 模块导出为磁盘上的 .wasm 文件。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    moduleIndex: zod
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('捕获模块的索引（默认 0）'),
    outputPath: zod
      .string()
      .optional()
      .describe('.wasm 二进制文件的输出路径'),
  },
  handler: async (request, response) => {
    const {moduleIndex = 0, outputPath: userOutputPath} = request.params;

    try {
      const runtime = getRuntime();
      const modules = runtime.wasmCollector.getModules();

      if (modules.length === 0) {
        response.setStructuredContent({
          success: false,
          message: '当前会话未捕获任何 WASM 模块，请先使用 collect_wasm 捕获',
          tooltype: 'wasm_dump',
        });
        return;
      }

      if (moduleIndex < 0 || moduleIndex >= modules.length) {
        response.setStructuredContent({
          success: false,
          message: `模块索引 ${moduleIndex} 超出范围（共 ${modules.length} 个模块）`,
          tooltype: 'wasm_dump',
        });
        return;
      }

      const module = modules[moduleIndex];
      const bytes = runtime.wasmCollector.getModuleBytes(module.id);

      if (!bytes) {
        response.setStructuredContent({
          success: false,
          message: `模块 ${module.id} 的二进制数据不可用`,
          tooltype: 'wasm_dump',
        });
        return;
      }

      const outputPath =
        userOutputPath ??
        path.join(
          process.cwd(),
          `wasm_dump_${moduleIndex}_${module.hash.slice(0, 8)}.wasm`,
        );

      await writeFile(outputPath, bytes);

      response.setStructuredContent({
        success: true,
        message: `已导出模块 ${module.id}（${bytes.byteLength} 字节）到 ${outputPath}`,
        tooltype: 'wasm_dump',
        logFormat: 'json',
        data: {
          moduleId: module.id,
          hash: module.hash,
          size: bytes.byteLength,
          outputPath,
          sourceUrl: module.sourceUrl,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `导出 WASM 模块失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'wasm_dump',
      });
    }
  },
});
