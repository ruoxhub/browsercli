/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {AxiError} from 'axi-sdk-js';

import type {WorkerContext} from '../../types.js';

export interface WorkerRuntime {
  group: string;
  invoker: WorkerContext['invoker'];
}

export function requireWorkerRuntime(
  ctx: WorkerContext | undefined,
): WorkerRuntime {
  const invoker = ctx?.invoker;
  const group = ctx?.group;

  if (!invoker || !group) {
    throw new AxiError('Worker 未运行', 'WORKER_NOT_RUNNING');
  }

  return {group, invoker};
}
