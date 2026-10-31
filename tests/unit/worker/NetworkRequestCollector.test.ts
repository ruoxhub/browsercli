/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {Page, Request} from 'patchright';

import {NetworkRequestCollector} from '../../../src/worker/collectors.js';

describe('NetworkRequestCollector', () => {
  it('prunes async parent stacks from cdp initiator events', async () => {
    const collector = new NetworkRequestCollector();
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const cdpListeners = new Map<string, (...args: unknown[]) => void>();

    const mockPage = {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler);
      },
      once: () => undefined,
      off: () => undefined,
      mainFrame: () => ({}),
      context: () => ({
        newCDPSession: async () => ({
          on: (event: string, listener: (...args: unknown[]) => void) => {
            cdpListeners.set(event, listener);
          },
          off: () => undefined,
          send: async () => undefined,
          detach: async () => undefined,
        }),
      }),
    } as unknown as Page;

    collector.attachToPage(mockPage);
    // 等待 CDP 会话初始化
    await new Promise(resolve => setTimeout(resolve, 50));

    const initiatorData = {
      type: 'script' as const,
      stack: {
        callFrames: [
          {
            functionName: 'fetchData',
            scriptId: '42',
            url: 'https://example.com/app.js',
            lineNumber: 10,
            columnNumber: 5,
          },
        ],
        parent: {
          callFrames: [
            {
              functionName: 'setTimeout',
              scriptId: '1',
              url: 'https://example.com/vendor.js',
              lineNumber: 99,
              columnNumber: 1,
            },
          ],
        },
      },
    };

    // 触发 CDP requestWillBeSent
    cdpListeners.get('Network.requestWillBeSent')?.({
      request: {
        method: 'GET',
        url: 'https://example.com/api/v1',
      },
      initiator: initiatorData,
    });

    // 触发 Page request
    const mockRequest = {
      method: () => 'GET',
      url: () => 'https://example.com/api/v1',
      frame: () => ({}),
      resourceType: () => 'fetch',
    } as unknown as Request;

    handlers.get('request')?.(mockRequest);

    const tracked = collector.getData(mockPage, false);
    assert.strictEqual(tracked.length, 1);
    const attachedInitiator = tracked[0]!.initiator;
    assert.deepStrictEqual(attachedInitiator, {
      type: 'script',
      stack: {
        callFrames: [
          {
            functionName: 'fetchData',
            scriptId: '42',
            url: 'https://example.com/app.js',
            lineNumber: 10,
            columnNumber: 5,
          },
        ],
      },
    });
    // 确认 parent 确实已被裁剪
    assert.strictEqual(attachedInitiator?.stack?.parent, undefined);

    collector.detachFromPage(mockPage);
  });

  it('starts an empty bucket after a navigation without requests', async () => {
    const collector = new NetworkRequestCollector();
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const mainFrame = {};

    const mockPage = {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler);
      },
      once: () => undefined,
      off: () => undefined,
      mainFrame: () => mainFrame,
      context: () => ({
        newCDPSession: async () => ({
          on: () => undefined,
          off: () => undefined,
          send: async () => ({frameTree: {frame: {id: 'main-1'}}}),
          detach: async () => undefined,
        }),
      }),
    } as unknown as Page;

    collector.attachToPage(mockPage);
    await new Promise(resolve => setTimeout(resolve, 50));

    const navDocRequest = {
      method: () => 'GET',
      url: () => 'https://example.com/page1',
      frame: () => mainFrame,
      resourceType: () => 'document',
    } as unknown as Request;

    const subRequest = {
      method: () => 'GET',
      url: () => 'https://example.com/style.css',
      frame: () => mainFrame,
      resourceType: () => 'stylesheet',
    } as unknown as Request;

    // 第一轮导航及其请求
    handlers.get('request')?.(navDocRequest);
    handlers.get('request')?.(subRequest);

    // 第一次 framenavigated 触发切片（将上面的请求作为第一轮导航）
    handlers.get('framenavigated')?.(mainFrame);
    await new Promise(resolve => setImmediate(resolve));

    assert.strictEqual(collector.getData(mockPage, false).length, 2);

    // 第二轮导航：页面进入 about:blank 或从 bfcache 恢复，未产生任何新 document 请求
    handlers.get('framenavigated')?.(mainFrame);
    await new Promise(resolve => setImmediate(resolve));

    // 验证当前导航桶为空，没有误吞第一轮导航的请求
    assert.strictEqual(collector.getData(mockPage, false).length, 0);

    // 验证历史保留请求完整包含上一轮导航的 2 个请求
    assert.strictEqual(collector.getData(mockPage, true).length, 2);

    collector.detachFromPage(mockPage);
  });
});
