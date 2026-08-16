/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {execFile} from 'node:child_process';

interface NativeCommandError extends Error {
  code?: string | number | null;
  killed?: boolean;
}

export interface NativeCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  notFound: boolean;
  timedOut: boolean;
}

function exitCodeFor(error: NativeCommandError | null): number {
  if (!error) return 0;
  return typeof error.code === 'number' ? error.code : 1;
}

export function runNativeCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<NativeCommandResult> {
  return new Promise(resolve => {
    execFile(command, args, {timeout: timeoutMs}, (error, stdout, stderr) => {
      const nativeError = error as NativeCommandError | null;
      resolve({
        stdout: stdout ?? '',
        stderr: (stderr ?? '').trim() || nativeError?.message || '',
        exitCode: exitCodeFor(nativeError),
        notFound: nativeError?.code === 'ENOENT',
        timedOut: nativeError?.killed === true,
      });
    });
  });
}
