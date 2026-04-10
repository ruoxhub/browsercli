/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {isDaemonRunning, socketPath} from '../../../src/daemon/utils.js';

describe('daemon/utils', () => {
  it('socketPath 应该是有效路径', () => {
    assert.ok(socketPath.endsWith('js-reverse-mcp.sock'));
  });

  it('isDaemonRunning 应该在没有 PID 时返回 false', () => {
    assert.strictEqual(isDaemonRunning(999999), false);
  });
});
