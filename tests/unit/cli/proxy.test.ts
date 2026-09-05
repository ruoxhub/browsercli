/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {proxyCommand} from '../../../src/cli/commands/proxy.js';
import type {AxiStructuredOutput} from '../../../src/cli/output.js';
import type {WorkerContext} from '../../../src/cli/types.js';

describe('proxyCommand', () => {
  const fakeContext: WorkerContext = {
    session: 'default',
    connect: async () => {
      throw new Error('Not needed in test');
    },
  };

  it('支持 proxy status --json 输出结构化状态', async () => {
    const result = await proxyCommand(['status', '--json'], fakeContext);
    const obj = result as AxiStructuredOutput;
    assert.strictEqual(obj.command, 'proxy status');
    assert.strictEqual(obj.status, 'success');
    assert.strictEqual(obj.exitCode, 0);
    const proxyStatus = obj.proxyStatus as {running: boolean};
    assert.strictEqual(typeof proxyStatus.running, 'boolean');
  });

  it('支持 proxy status 文本输出', async () => {
    const result = await proxyCommand(['status'], fakeContext);
    // SAFETY: Cast AxiRenderable to inspect command and exitCode properties in unit test
    const obj = result as {command?: string; exitCode?: number};
    assert.strictEqual(obj?.command, 'proxy status');
    assert.strictEqual(obj?.exitCode, 0);
  });
});
