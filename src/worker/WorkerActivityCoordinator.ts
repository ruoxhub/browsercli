/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export type BrowserOperation = 'connect' | 'disconnect';

export interface WorkerActivityState {
  activeTools: number;
  browserOperation?: BrowserOperation;
}

export interface BrowserOperationOptions {
  allowActiveTools?: boolean;
}

export class WorkerBusyError extends Error {
  readonly code = 'WORKER_BUSY';

  constructor(readonly state: WorkerActivityState) {
    super(
      state.browserOperation
        ? `worker is busy with browser ${state.browserOperation}`
        : 'worker is busy running tools',
    );
  }
}

function getAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('operation aborted');
}

export async function raceWithAbort<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return await operation;
  if (signal.aborted) throw getAbortReason(signal);

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(getAbortReason(signal));
    signal.addEventListener('abort', onAbort, {once: true});
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export class WorkerActivityCoordinator {
  private activeTools = 0;
  private browserOperation?: BrowserOperation;

  getState(): WorkerActivityState {
    return {
      activeTools: this.activeTools,
      browserOperation: this.browserOperation,
    };
  }

  async runTool<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.browserOperation) throw new WorkerBusyError(this.getState());
    if (signal?.aborted) throw getAbortReason(signal);
    this.activeTools += 1;
    try {
      return await raceWithAbort(action(), signal);
    } finally {
      this.activeTools -= 1;
    }
  }

  async runBrowserOperation<T>(
    operation: BrowserOperation,
    action: () => Promise<T>,
    options: BrowserOperationOptions = {},
  ): Promise<T> {
    if (
      this.browserOperation ||
      (!options.allowActiveTools && this.activeTools > 0)
    ) {
      throw new WorkerBusyError(this.getState());
    }
    this.browserOperation = operation;
    try {
      return await action();
    } finally {
      this.browserOperation = undefined;
    }
  }
}

export const workerActivityCoordinator = new WorkerActivityCoordinator();
