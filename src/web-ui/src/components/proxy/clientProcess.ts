/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ParsedClientProcess {
  pid: number;
  name: string;
  path?: string;
}

export function parseClientProcess(
  initiator: string | null | undefined,
): ParsedClientProcess | null {
  if (!initiator) return null;
  try {
    const v = JSON.parse(initiator) as {
      type?: string;
      pid?: number;
      name?: string;
      path?: string;
    };
    if (
      v?.type === 'clientProcess' &&
      typeof v.pid === 'number' &&
      typeof v.name === 'string'
    ) {
      return {pid: v.pid, name: v.name, path: v.path};
    }
  } catch {
    // 非 JSON（CDP initiator 等）按无进程处理
  }
  return null;
}
