/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Live smoke check for the ego bridge against the *real* installed CLI.
 *
 * This is the test that would have caught the broken host contract: the unit
 * tests drive a fake CLI, so they passed happily while `start()` timed out
 * against ego 0.6.1.13 (its embedded runtime neither streams stdout nor accepts
 * stdin as a control channel). Here nothing is faked except the machine:
 *
 *   start() -> a real ws://127.0.0.1:<port> endpoint within the timeout,
 *              the port really listening, stop() -> child gone, port closed.
 *
 * It skips cleanly when ego lite is not installed, so CI on a machine without it
 * stays green.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {findEgoBrowserBinary} from '../../../../src/modules/browser/ego/ego-detect.js';
import {EgoBridgeManager} from '../../../../src/modules/browser/ego/EgoBridgeManager.js';

/** A real TCP connect attempt: `true` when something accepts on the port. */
function portAccepts(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({host: '127.0.0.1', port});
    const done = (accepts: boolean) => {
      socket.destroy();
      resolve(accepts);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

const binary = findEgoBrowserBinary();

describe('ego bridge live smoke check', () => {
  it(
    'starts the real ego bridge, serves the endpoint, and stops it',
    {
      skip:
        binary === null ? 'ego lite is not installed on this machine' : false,
    },
    async () => {
      assert.ok(binary, 'the skip guard should have caught a missing install');
      assert.equal(fs.existsSync(binary), true, `${binary} must exist`);

      // Isolate this bridge's task space from the other live ego test.
      //
      // The task-space name is `browsercli-<hash of the workspace cwd>`, and
      // `ego.useTaskSpace()` selects process-globally. `npm test` runs test
      // FILES concurrently, so two live ego tests sharing `process.cwd()` derive
      // the SAME name, enter the SAME space, and the slower one detaches the
      // faster one's — which surfaces as `EGO_TASK_SPACE_INACTIVE` from a
      // `page.goto` in whichever suite lost the race (`--test-concurrency=8`
      // failed, `=1` passed). A private temp cwd gives each live test its own
      // space, which also stops the run from leaving a shared space behind.
      const workspace = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ego-bridge-live-'),
      );

      const manager = new EgoBridgeManager({
        startTimeoutMs: 30_000,
        cwd: workspace,
      });
      const startedAt = Date.now();
      let connection: {wsEndpoint: string; childPid?: number} | undefined;

      try {
        connection = await manager.start();
        const elapsed = Date.now() - startedAt;

        // 1. A real loopback endpoint, returned within the timeout.
        assert.match(
          connection.wsEndpoint,
          /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[0-9a-f-]+$/,
          'the worker must report a real CDP endpoint',
        );
        assert.ok(
          elapsed < 30_000,
          `start() must return within the timeout, took ${elapsed} ms`,
        );
        assert.equal(manager.isRunning(), true);
        assert.ok(
          typeof connection.childPid === 'number',
          'the launcher pid must be reported',
        );

        // 2. The port is genuinely listening, not just parsed out of a string.
        const port = Number(new URL(connection.wsEndpoint).port);
        assert.equal(
          await portAccepts(port),
          true,
          `ws://127.0.0.1:${port} must accept connections`,
        );

        const stopStartedAt = Date.now();
        await manager.stop();
        const stopElapsed = Date.now() - stopStartedAt;

        // 3. The child is gone and the port is closed.
        assert.equal(manager.isRunning(), false);
        assert.equal(
          await portAccepts(port),
          false,
          `ws://127.0.0.1:${port} must be closed after stop()`,
        );
        assert.ok(
          stopElapsed < 30_000,
          `stop() must resolve promptly, took ${stopElapsed} ms`,
        );
      } finally {
        await manager.stop();
        fs.rmSync(workspace, {recursive: true, force: true});
      }
    },
  );
});
