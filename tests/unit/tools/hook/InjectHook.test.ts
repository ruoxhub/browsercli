/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, beforeEach} from 'node:test';
import assert from 'node:assert/strict';

import {
  injectHook,
  listPersistentHooks,
  getPersistentHookRegistry,
} from '../../../../src/tools/hook/InjectHook.js';
import type {Context} from '../../../../src/tools/ToolDefinition.js';

/**
 * 构造最小 Context mock，仅暴露 inject_hook 用到的方法。
 * frame.evaluate + page.addInitScript 都记录调用痕迹供断言。
 */
function buildMockContext(options: {
  supportsAddInitScript?: boolean;
} = {}) {
  const supportsAddInitScript = options.supportsAddInitScript ?? true;
  const frameEvaluateCalls: string[] = [];
  const addInitScriptCalls: string[] = [];

  const fakeFrame = {
    evaluate: async (script: unknown) => {
      frameEvaluateCalls.push(String(script));
      return undefined;
    },
  };

  const fakePage: Record<string, unknown> = {};
  if (supportsAddInitScript) {
    fakePage.addInitScript = async (script: string) => {
      addInitScriptCalls.push(script);
    };
  }

  const ctx = {
    getSelectedFrame: () => fakeFrame,
    getSelectedPage: () => fakePage,
  } as unknown as Context;

  return {ctx, frameEvaluateCalls, addInitScriptCalls};
}

/** 最小 Response mock：记录结构化输出。 */
function buildMockResponse() {
  const calls: Array<Record<string, unknown>> = [];
  const response = {
    setStructuredContent(content: Record<string, unknown>) {
      calls.push(content);
    },
    appendResponseLine() {},
    setIncludePages() {},
    setIncludeNetworkRequests() {},
    setIncludeConsoleData() {},
    attachImage() {},
    attachNetworkRequest() {},
    attachConsoleMessage() {},
    setIncludeWebSocketConnections() {},
    attachWebSocket() {},
  };
  return {response: response as never, calls};
}

describe('inject_hook persistent 模式', () => {
  beforeEach(() => {
    // 清空注册表，避免测试间串扰
    (getPersistentHookRegistry() as unknown as Map<string, unknown>).clear();
  });

  it('persistent=false（默认）只 evaluate 当前 frame，不注册到 addInitScript', async () => {
    const {ctx, frameEvaluateCalls, addInitScriptCalls} = buildMockContext();
    const {response, calls} = buildMockResponse();

    await injectHook.handler(
      {params: {hookId: 'h1', script: 'console.log(1)'}},
      response,
      ctx,
    );

    assert.equal(frameEvaluateCalls.length, 1);
    assert.equal(addInitScriptCalls.length, 0);
    assert.equal(calls[0]?.success, true);
    const data = calls[0]?.data as {persisted: boolean; ranOnCurrentFrame: boolean};
    assert.equal(data.persisted, false);
    assert.equal(data.ranOnCurrentFrame, true);
  });

  it('persistent=true 既调 addInitScript 也 evaluate 当前 frame', async () => {
    const {ctx, frameEvaluateCalls, addInitScriptCalls} = buildMockContext();
    const {response, calls} = buildMockResponse();

    await injectHook.handler(
      {params: {hookId: 'h2', script: '/*hook*/', persistent: true}},
      response,
      ctx,
    );

    assert.equal(frameEvaluateCalls.length, 1);
    assert.equal(addInitScriptCalls.length, 1);
    assert.equal(calls[0]?.success, true);
    const data = calls[0]?.data as {persisted: boolean; ranOnCurrentFrame: boolean};
    assert.equal(data.persisted, true);
    assert.equal(data.ranOnCurrentFrame, true);
    // 写入了注册表
    assert.equal(getPersistentHookRegistry().has('h2'), true);
  });

  it('页面不支持 addInitScript 时降级为单次 evaluate 并给 warning', async () => {
    const {ctx, frameEvaluateCalls, addInitScriptCalls} = buildMockContext({
      supportsAddInitScript: false,
    });
    const {response, calls} = buildMockResponse();

    await injectHook.handler(
      {params: {hookId: 'h3', script: '/*x*/', persistent: true}},
      response,
      ctx,
    );

    assert.equal(frameEvaluateCalls.length, 1);
    assert.equal(addInitScriptCalls.length, 0);
    assert.equal(calls[0]?.success, true);
    const data = calls[0]?.data as {persisted: boolean; warnings?: string[]};
    assert.equal(data.persisted, false);
    assert.ok(data.warnings && data.warnings.length > 0);
  });

  it('list_persistent_hooks 返回已注册的列表', async () => {
    const {ctx} = buildMockContext();
    const {response} = buildMockResponse();

    await injectHook.handler(
      {params: {hookId: 'persistent-a', script: '/*a*/', persistent: true}},
      response,
      ctx,
    );
    await injectHook.handler(
      {params: {hookId: 'persistent-b', script: '/*b*/', persistent: true}},
      response,
      ctx,
    );

    const listResponse = buildMockResponse();
    await listPersistentHooks.handler(
      {params: {}},
      listResponse.response,
      {} as never,
    );

    const data = listResponse.calls[0]?.data as {
      hooks: Array<{hookId: string}>;
      count: number;
    };
    assert.equal(data.count, 2);
    const ids = data.hooks.map(h => h.hookId).sort();
    assert.deepEqual(ids, ['persistent-a', 'persistent-b']);
  });
});
