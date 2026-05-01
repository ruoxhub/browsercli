/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {execFile} from 'node:child_process';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';

import type {
  WasmOptimizeParams,
  WasmOptimizeResult,
} from './types.js';

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

export async function wasmOptimize(
  params: WasmOptimizeParams,
): Promise<WasmOptimizeResult> {
  const tooltype = 'wasm_optimize';

  try {
    const level = params.level ?? 'O2';
    const outputPath = params.outputPath
      ?? params.inputPath.replace(/\.wasm$/i, `.opt.${level}.wasm`);

    const originalStats = await stat(params.inputPath);

    const args = [`-${level}`, params.inputPath, '-o', outputPath];
    const result = await runCommand('wasm-opt', args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        message: `wasm-opt 优化失败：${result.stderr.slice(0, 500)}`,
        tooltype,
      };
    }

    const optimizedStats = await stat(outputPath);
    const reduction = originalStats.size > 0
      ? Math.round((1 - optimizedStats.size / originalStats.size) * 100)
      : 0;

    return {
      success: true,
      message: `优化完成（${level}）：${originalStats.size} → ${optimizedStats.size} 字节（${reduction > 0 ? '-' : '+'}${Math.abs(reduction)}%）`,
      tooltype,
      logFormat: 'json',
      data: {
        inputPath: params.inputPath,
        outputPath,
        level,
        originalSize: originalStats.size,
        optimizedSize: optimizedStats.size,
        reduction,
        stdout: result.stdout,
        stderr: result.stderr,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `WASM 优化失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}
