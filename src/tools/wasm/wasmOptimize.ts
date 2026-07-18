/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {execFile} from 'node:child_process';
import {stat} from 'node:fs/promises';

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

function runCommand(
  cmd: string,
  args: string[],
): Promise<{stdout: string; stderr: string; exitCode: number}> {
  return new Promise(resolve => {
    execFile(cmd, args, {timeout: 30000}, (error, stdout, stderr) => {
      resolve({
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
      });
    });
  });
}

export const wasmOptimize = defineTool({
  name: 'wasm_optimize',
  description:
    '使用 binaryen 的 wasm-opt 优化 .wasm 文件，可指定优化级别。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    inputPath: zod.string().describe('要优化的 .wasm 文件路径'),
    outputPath: zod
      .string()
      .optional()
      .describe('优化后文件的输出路径'),
    level: zod
      .enum(['O1', 'O2', 'O3', 'O4', 'Os', 'Oz'])
      .optional()
      .describe('优化级别（默认 "O2"）'),
  },
  handler: async (request, response) => {
    const {inputPath, level = 'O2'} = request.params;
    const outputPath =
      request.params.outputPath ??
      inputPath.replace(/\.wasm$/i, `.opt.${level}.wasm`);

    try {
      const originalStats = await stat(inputPath);

      const args = [`-${level}`, inputPath, '-o', outputPath];
      const result = await runCommand('wasm-opt', args);

      if (result.exitCode !== 0) {
        response.setStructuredContent({
          success: false,
          message: `wasm-opt 优化失败：${result.stderr.slice(0, 500)}`,
          tooltype: 'wasm_optimize',
        });
        return;
      }

      const optimizedStats = await stat(outputPath);
      const reduction =
        originalStats.size > 0
          ? Math.round((1 - optimizedStats.size / originalStats.size) * 100)
          : 0;

      response.setStructuredContent({
        success: true,
        message: `优化完成（${level}）：${originalStats.size} → ${optimizedStats.size} 字节（${reduction > 0 ? '-' : '+'}${Math.abs(reduction)}%）`,
        tooltype: 'wasm_optimize',
        logFormat: 'json',
        data: {
          inputPath,
          outputPath,
          level,
          originalSize: originalStats.size,
          optimizedSize: optimizedStats.size,
          reduction,
          stdout: result.stdout,
          stderr: result.stderr,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `WASM 优化失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'wasm_optimize',
      });
    }
  },
});
