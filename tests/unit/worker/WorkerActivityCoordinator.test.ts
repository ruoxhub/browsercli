/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {WorkerActivityCoordinator} from '../../../src/worker/WorkerActivityCoordinator.js';

describe('WorkerActivityCoordinator', () => {
  it('releases a hung tool slot when its signal is aborted', async () => {
    const coordinator = new WorkerActivityCoordinator();
    const controller = new AbortController();
    const reason = new Error('cancelled');
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const runTool = coordinator.runTool.bind(coordinator) as <T>(
      action: () => Promise<T>,
      signal?: AbortSignal,
    ) => Promise<T>;
    const running = runTool(async () => {
      await gate;
      return 'late result';
    }, controller.signal);
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      assert.equal(coordinator.getState().activeTools, 1);
      controller.abort(reason);
      await assert.rejects(
        Promise.race([
          running,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('abort was not propagated')),
              50,
            );
          }),
        ]),
        error => error === reason,
      );
      assert.equal(coordinator.getState().activeTools, 0);
      await coordinator.runBrowserOperation(
        'disconnect',
        async () => undefined,
      );
    } finally {
      if (timer) clearTimeout(timer);
      release();
      await running.catch(() => undefined);
    }
  });
});
