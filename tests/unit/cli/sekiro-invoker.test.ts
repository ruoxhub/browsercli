/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {SekiroInvoker} from '../../../src/cli/sekiro-invoker.js';

/** 用可控 handler 临时替换 global fetch */
function mockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status});
}

describe('SekiroInvoker.invoke — no client available 重试', () => {
  let invoker: SekiroInvoker;

  beforeEach(() => {
    // 缩短重连等待，便于测试；noClientRetries 默认 3
    invoker = new SekiroInvoker({
      rpcHost: 'ws://127.0.0.1:5612',
      noClientRetries: 2,
      noClientRetryDelay: 1,
    });
  });

  afterEach(() => {
    // 保险：测试应自行 restore，这里无操作
  });

  it('no client available 时等待 Worker 重连后重试成功', async () => {
    let calls = 0;
    const restore = mockFetch(async () => {
      calls++;
      if (calls < 2) {
        return jsonResponse({
          code: 3001,
          status: -1,
          message: 'no client available',
        });
      }
      return jsonResponse({code: 0, status: 0, data: {ok: true}});
    });

    try {
      const result = await invoker.invoke('g', 'action');
      assert.equal(calls, 2, '应重试一次后成功');
      assert.deepEqual(result, {ok: true});
    } finally {
      restore();
    }
  });

  it('no client available 重试耗尽后抛出错误', async () => {
    let calls = 0;
    const restore = mockFetch(async () => {
      calls++;
      return jsonResponse({
        code: 3001,
        status: -1,
        message: 'no client available',
      });
    });

    try {
      await assert.rejects(() => invoker.invoke('g', 'action'));
      // maxAttempts = max(maxRetries=1, noClientRetries+1=3) = 3
      assert.equal(calls, 3, '应重试至耗尽');
    } finally {
      restore();
    }
  });

  it('maxRetries=1 时普通网络抖动不重试（只尝试一次）', async () => {
    let calls = 0;
    const restore = mockFetch(async () => {
      calls++;
      throw new Error('fetch failed');
    });

    try {
      await assert.rejects(() => invoker.invoke('g', 'action'));
      assert.equal(calls, 1, 'maxRetries 默认 1，应只尝试一次');
    } finally {
      restore();
    }
  });

  it('maxRetries=2 时普通网络抖动重试一次后成功', async () => {
    const invoker2 = new SekiroInvoker({
      rpcHost: 'ws://127.0.0.1:5612',
      maxRetries: 2,
      noClientRetries: 2,
      noClientRetryDelay: 1,
    });
    let calls = 0;
    const restore = mockFetch(async () => {
      calls++;
      if (calls < 2) {
        throw new Error('fetch failed');
      }
      return jsonResponse({code: 0, status: 0, data: {ok: true}});
    });

    try {
      const result = await invoker2.invoke('g', 'action');
      assert.equal(calls, 2, 'maxRetries=2，应重试一次');
      assert.deepEqual(result, {ok: true});
    } finally {
      restore();
    }
  });

  it('HTTP 4xx 不重试直接抛出', async () => {
    let calls = 0;
    const restore = mockFetch(async () => {
      calls++;
      return jsonResponse({message: 'not found'}, 404);
    });

    try {
      await assert.rejects(() => invoker.invoke('g', 'action'));
      assert.equal(calls, 1, '4xx 不应重试');
    } finally {
      restore();
    }
  });

  it('正常成功不重试', async () => {
    let calls = 0;
    const restore = mockFetch(async () => {
      calls++;
      return jsonResponse({code: 0, status: 0, data: {ok: true}});
    });

    try {
      const result = await invoker.invoke('g', 'action');
      assert.equal(calls, 1);
      assert.deepEqual(result, {ok: true});
    } finally {
      restore();
    }
  });
});
