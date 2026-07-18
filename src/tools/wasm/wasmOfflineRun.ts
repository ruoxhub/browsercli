/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {execFile} from 'node:child_process';

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{stdout: string; stderr: string; exitCode: number}> {
  return new Promise(resolve => {
    const child = execFile(
      cmd,
      args,
      {timeout: timeoutMs},
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode:
            typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        });
      },
    );
    child.on('error', () => {
      resolve({stdout: '', stderr: `命令未找到: ${cmd}`, exitCode: -1});
    });
  });
}

export const wasmOfflineRun = defineTool({
  name: 'wasm_offline_run',
  description:
    '使用 wasmtime 或 wasmer CLI 运行时离线执行 Wasm 函数。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    inputPath: zod.string().describe('.wasm 文件路径'),
    functionName: zod
      .string()
      .describe('要调用的导出 Wasm 函数名'),
    args: zod
      .array(zod.string())
      .optional()
      .describe('传给函数的参数'),
    runtime: zod
      .enum(['wasmtime', 'wasmer', 'auto'])
      .optional()
      .describe('使用的运行时（默认 "auto"）'),
    timeoutMs: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('执行超时时间（毫秒，默认 10000）'),
  },
  handler: async (request, response) => {
    const {
      inputPath,
      functionName,
      args = [],
      runtime: runtimeChoice = 'auto',
      timeoutMs = 10000,
    } = request.params;

    const start = Date.now();

    try {
      let cmd: string;
      let cmdArgs: string[];

      if (runtimeChoice === 'wasmer') {
        cmd = 'wasmer';
        cmdArgs = [inputPath, '--invoke', functionName, ...args];
      } else if (runtimeChoice === 'wasmtime') {
        cmd = 'wasmtime';
        cmdArgs = [inputPath, '--invoke', functionName, ...args];
      } else {
        // auto: prefer wasmtime, fallback to wasmer
        cmd = 'wasmtime';
        cmdArgs = [inputPath, '--invoke', functionName, ...args];
      }

      const result = await runCommand(cmd, cmdArgs, timeoutMs);
      const durationMs = Date.now() - start;

      // auto fallback
      if (
        result.exitCode !== 0 &&
        runtimeChoice === 'auto' &&
        result.stderr.includes('未找到')
      ) {
        const wasmerResult = await runCommand(
          'wasmer',
          [inputPath, '--invoke', functionName, ...args],
          timeoutMs,
        );
        response.setStructuredContent({
          success: wasmerResult.exitCode === 0,
          message:
            wasmerResult.exitCode === 0
              ? `wasmer 执行成功（${durationMs}ms）`
              : `wasmer 执行失败：${wasmerResult.stderr}`,
          tooltype: 'wasm_offline_run',
          logFormat: 'json',
          data: {
            inputPath,
            functionName,
            runtime: 'wasmer',
            ...wasmerResult,
            durationMs: Date.now() - start,
          },
        });
        return;
      }

      response.setStructuredContent({
        success: result.exitCode === 0,
        message:
          result.exitCode === 0
            ? `${cmd} 执行成功（${durationMs}ms）`
            : `${cmd} 执行失败（exit ${result.exitCode}）：${result.stderr.slice(0, 500)}`,
        tooltype: 'wasm_offline_run',
        logFormat: 'json',
        data: {
          inputPath,
          functionName,
          runtime: cmd,
          ...result,
          durationMs,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `离线执行 WASM 失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'wasm_offline_run',
      });
    }
  },
});
