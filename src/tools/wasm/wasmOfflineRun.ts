/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {execFile} from 'node:child_process';

import type {
  WasmOfflineRunParams,
  WasmOfflineRunResult,
} from './types.js';

function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{stdout: string; stderr: string; exitCode: number}> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, {timeout: timeoutMs}, (error, stdout, stderr) => {
      resolve({
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        exitCode: error?.code ?? (error ? 1 : 0),
      });
    });
    child.on('error', () => {
      resolve({stdout: '', stderr: `命令未找到: ${cmd}`, exitCode: -1});
    });
  });
}

export async function wasmOfflineRun(
  params: WasmOfflineRunParams,
): Promise<WasmOfflineRunResult> {
  const tooltype = 'wasm_offline_run';
  const start = Date.now();

  try {
    const runtimeChoice = params.runtime ?? 'auto';
    const timeoutMs = params.timeoutMs ?? 10000;
    const args = params.args ?? [];

    let cmd: string;
    let cmdArgs: string[];

    if (runtimeChoice === 'wasmer') {
      cmd = 'wasmer';
      cmdArgs = [params.inputPath, '--invoke', params.functionName, ...args];
    } else if (runtimeChoice === 'wasmtime') {
      cmd = 'wasmtime';
      cmdArgs = [params.inputPath, '--invoke', params.functionName, ...args];
    } else {
      // auto: prefer wasmtime, fallback to wasmer
      cmd = 'wasmtime';
      cmdArgs = [params.inputPath, '--invoke', params.functionName, ...args];
    }

    const result = await runCommand(cmd, cmdArgs, timeoutMs);
    const durationMs = Date.now() - start;

    // auto fallback
    if (result.exitCode !== 0 && runtimeChoice === 'auto' && result.stderr.includes('未找到')) {
      const wasmerResult = await runCommand(
        'wasmer',
        [params.inputPath, '--invoke', params.functionName, ...args],
        timeoutMs,
      );
      return {
        success: wasmerResult.exitCode === 0,
        message: wasmerResult.exitCode === 0
          ? `wasmer 执行成功（${durationMs}ms）`
          : `wasmer 执行失败：${wasmerResult.stderr}`,
        tooltype,
        logFormat: 'json',
        data: {
          inputPath: params.inputPath,
          functionName: params.functionName,
          runtime: 'wasmer',
          ...wasmerResult,
          durationMs: Date.now() - start,
        },
      };
    }

    return {
      success: result.exitCode === 0,
      message: result.exitCode === 0
        ? `${cmd} 执行成功（${durationMs}ms）`
        : `${cmd} 执行失败（exit ${result.exitCode}）：${result.stderr.slice(0, 500)}`,
      tooltype,
      logFormat: 'json',
      data: {
        inputPath: params.inputPath,
        functionName: params.functionName,
        runtime: cmd,
        ...result,
        durationMs,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `离线执行 WASM 失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}
