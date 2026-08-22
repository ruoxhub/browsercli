/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Response} from '../ToolDefinition.js';

import {runNativeCommand, type NativeCommandResult} from './nativeCommand.js';

type WasmRuntimeName = 'wasmtime' | 'wasmer';

function invocationArgs(
  inputPath: string,
  functionName: string,
  args: string[],
): string[] {
  return [inputPath, '--invoke', functionName, ...args];
}

function executionMessage(
  runtime: WasmRuntimeName,
  result: NativeCommandResult,
  durationMs: number,
): string {
  if (result.exitCode === 0) {
    return `${runtime} 执行成功（${durationMs}ms）`;
  }
  if (result.timedOut) {
    return `${runtime} 执行超时（${durationMs}ms）`;
  }
  return `${runtime} 执行失败（exit ${result.exitCode}）：${result.stderr.slice(0, 500)}`;
}

function setExecutionResult(
  response: Response,
  inputPath: string,
  functionName: string,
  runtime: WasmRuntimeName,
  result: NativeCommandResult,
  durationMs: number,
): void {
  if (result.exitCode !== 0) {
    throw createToolError(
      result.timedOut ? ErrorCodes.TIMEOUT : ErrorCodes.RUNTIME,
      executionMessage(runtime, result, durationMs),
      {toolName: 'wasm_offline_run'},
      {
        details: {
          inputPath,
          functionName,
          runtime,
          exitCode: result.exitCode,
          stderr: result.stderr,
          durationMs,
        },
      },
    );
  }
  response.setStructuredContent({
    success: true,
    message: executionMessage(runtime, result, durationMs),
    tooltype: 'wasm_offline_run',
    logFormat: 'json',
    data: {
      inputPath,
      functionName,
      runtime,
      ...result,
      durationMs,
    },
  });
}

export const wasmOfflineRun = defineTool({
  name: 'wasm_offline_run',
  description: '使用 wasmtime 或 wasmer CLI 运行时离线执行 Wasm 函数。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    inputPath: zod.string().describe('.wasm 文件路径'),
    functionName: zod.string().describe('要调用的导出 Wasm 函数名'),
    args: zod.array(zod.string()).optional().describe('传给函数的参数'),
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
      const commandArgs = invocationArgs(inputPath, functionName, args);
      if (runtimeChoice !== 'auto') {
        const result = await runNativeCommand(
          runtimeChoice,
          commandArgs,
          timeoutMs,
        );
        if (result.notFound) {
          throw createToolError(
            ErrorCodes.NATIVE_TOOL_MISSING,
            `运行 WASM 失败：系统中未找到运行时 ${runtimeChoice}，请先安装 wasmtime 或 wasmer 后重试。`,
            {toolName: 'wasm_offline_run'},
            {
              details: {
                inputPath,
                functionName,
                runtime: runtimeChoice,
                ...result,
              },
            },
          );
        }
        setExecutionResult(
          response,
          inputPath,
          functionName,
          runtimeChoice,
          result,
          Date.now() - start,
        );
        return;
      }

      const wasmtimeResult = await runNativeCommand(
        'wasmtime',
        commandArgs,
        timeoutMs,
      );
      if (!wasmtimeResult.notFound) {
        setExecutionResult(
          response,
          inputPath,
          functionName,
          'wasmtime',
          wasmtimeResult,
          Date.now() - start,
        );
        return;
      }

      const wasmerResult = await runNativeCommand(
        'wasmer',
        commandArgs,
        timeoutMs,
      );
      if (wasmerResult.notFound) {
        throw createToolError(
          ErrorCodes.NATIVE_TOOL_MISSING,
          '运行 WASM 失败：系统中未找到 wasmtime 或 wasmer，请先安装任一运行时后重试。',
          {toolName: 'wasm_offline_run'},
          {
            details: {
              inputPath,
              functionName,
              runtime: 'auto',
              attempts: {
                wasmtime: wasmtimeResult,
                wasmer: wasmerResult,
              },
              durationMs: Date.now() - start,
            },
          },
        );
      }

      setExecutionResult(
        response,
        inputPath,
        functionName,
        'wasmer',
        wasmerResult,
        Date.now() - start,
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `离线执行 WASM 失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'wasm_offline_run'},
      );
    }
  },
});
