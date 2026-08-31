/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {ProxyStore} from '../../../../src/modules/proxy/ProxyStore.js';
import type {CapturedExchange} from '../../../../src/modules/proxy/types.js';

function makeExchange(url: string): CapturedExchange {
  return {
    requestId: `proxy-${url}`,
    method: 'GET',
    url,
    requestHeaders: {},
    requestBody: null,
    statusCode: 200,
    responseHeaders: {},
    responseBody: null,
    contentType: null,
    isOptions: false,
    isStatic: false,
    isStreaming: false,
    isWebSocket: false,
    truncated: false,
    timestamp: Date.now(),
    modified: false,
  };
}

describe('ProxyStore', () => {
  it('add 分配从 1 递增的稳定 id', () => {
    const store = new ProxyStore();
    const a = store.add(makeExchange('http://a/'));
    const b = store.add(makeExchange('http://b/'));
    assert.strictEqual(a.id, 1);
    assert.strictEqual(b.id, 2);
    assert.strictEqual(store.size(), 2);
    assert.strictEqual(store.get(1), a);
  });

  it('超过上限时淘汰最旧记录', () => {
    const store = new ProxyStore(2);
    store.add(makeExchange('http://a/'));
    store.add(makeExchange('http://b/'));
    store.add(makeExchange('http://c/'));
    assert.strictEqual(store.size(), 2);
    assert.strictEqual(store.get(1), undefined);
    assert.strictEqual(store.get(2)?.url, 'http://b/');
    assert.strictEqual(store.get(3)?.url, 'http://c/');
  });

  it('clear 清空并重置 id', () => {
    const store = new ProxyStore();
    store.add(makeExchange('http://a/'));
    store.clear();
    assert.strictEqual(store.size(), 0);
    const next = store.add(makeExchange('http://b/'));
    assert.strictEqual(next.id, 1);
  });

  it('add 与 clear 触发对应 events 事件', () => {
    const store = new ProxyStore();
    const captured: unknown[] = [];
    let cleared = false;

    store.events.on('capture', record => {
      captured.push(record);
    });
    store.events.on('clear', () => {
      cleared = true;
    });

    const rec = store.add(makeExchange('http://test/'));
    assert.strictEqual(captured.length, 1);
    assert.strictEqual(captured[0], rec);

    store.clear();
    assert.strictEqual(cleared, true);
  });
});
