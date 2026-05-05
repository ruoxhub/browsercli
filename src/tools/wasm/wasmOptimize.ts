/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {execFile} from 'node:child_process';
import {stat} from 'node:fs/promises';

import {zod} from '../../third_party/index.js';
import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';

function runCommand(
  cmd: string,
  args: string[],
): Promise<{stdout: string; stderr: string; exitCode: number}> {
  return new Promise((resolve) => {
    execFile(cmd, args, {timeout: 30000}, (error, stdout, stderr) => {
      resolve({
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        exitCode: error?.code ?? (error ? 1 : 0),
      });
    });
  });
}

function appendJson(
  response: {appendResponseLine(value: string): void},
  value: unknown,
): void {
  response.appendResponseLine('```json');
  response.appendResponseLine(JSON.stringify(value, null, 2));
  response.appendResponseLine('```');
}

export const wasmOptimize = defineTool({
  name: 'wasm_optimize',
  description: 'Optimize a .wasm file using binaryen wasm-opt with selectable optimization level.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    inputPath: zod.string().describe('Path to the .wasm file to optimize'),
    outputPath: zod.string().optional().describe('Output path for the optimized file'),
    level: zod.enum(['O1', 'O2', 'O3', 'O4', 'Os', 'Oz']).optional().describe('Optimization level (default "O2")'),
  },
  handler: async (request, response) => {
    const {inputPath, level = 'O2'} = request.params;
    const outputPath = request.params.outputPath
      ?? inputPath.replace(/\.wasm$/i, `.opt.${level}.wasm`);

    try {
      const originalStats = await stat(inputPath);

      const args = [`-${level}`, inputPath, '-o', outputPath];
      const result = await runCommand('wasm-opt', args);

      if (result.exitCode !== 0) {
        appendJson(response, {
          success: false,
          message: `wasm-opt 优化失败：${result.stderr.slice(0, 500)}`,
          tooltype: 'wasm_optimize',
        });
        return;
      }

      const optimizedStats = await stat(outputPath);
      const reduction = originalStats.size > 0
        ? Math.round((1 - optimizedStats.size / originalStats.size) * 100)
        : 0;

      appendJson(response, {
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
      appendJson(response, {
        success: false,
        message: `WASM 优化失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'wasm_optimize',
      });
    }
  },
});
