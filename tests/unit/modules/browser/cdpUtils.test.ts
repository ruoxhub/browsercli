/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {CDPSession, Page} from 'patchright';

import {withCdpSession} from '../../../../src/modules/browser/cdpUtils.js';

describe('withCdpSession', () => {
  it('执行操作并成功触发 client.detach', async () => {
    let detached = false;
    let actionExecuted = false;

    const mockSession = {
      detach: async () => {
        detached = true;
      },
      send: async () => ({}),
    } as unknown as CDPSession;

    const mockPage = {
      context: () => ({
        newCDPSession: async () => mockSession,
      }),
    } as unknown as Page;

    const result = await withCdpSession(mockPage, async client => {
      actionExecuted = true;
      assert.strictEqual(client, mockSession);
      return 'ok';
    });

    assert.strictEqual(result, 'ok');
    assert.strictEqual(actionExecuted, true);
    assert.strictEqual(detached, true);
  });

  it('操作抛出异常时仍能触发 client.detach 并向外冒泡异常', async () => {
    let detached = false;

    const mockSession = {
      detach: async () => {
        detached = true;
      },
    } as unknown as CDPSession;

    const mockPage = {
      context: () => ({
        newCDPSession: async () => mockSession,
      }),
    } as unknown as Page;

    await assert.rejects(
      async () => {
        await withCdpSession(mockPage, async () => {
          throw new Error('action failed');
        });
      },
      {message: 'action failed'},
    );

    assert.strictEqual(detached, true);
  });

  it('detach 抛错时被安全吞掉，不掩盖正常返回值', async () => {
    const mockSession = {
      detach: async () => {
        throw new Error('Target closed');
      },
    } as unknown as CDPSession;

    const mockPage = {
      context: () => ({
        newCDPSession: async () => mockSession,
      }),
    } as unknown as Page;

    const result = await withCdpSession(mockPage, async () => 42);
    assert.strictEqual(result, 42);
  });
});
