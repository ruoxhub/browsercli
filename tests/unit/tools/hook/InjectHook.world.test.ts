/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it, beforeEach} from 'node:test';

import {
  injectHook,
  getPersistentHookRegistry,
} from '../../../../src/tools/hook/InjectHook.js';
import type {Context} from '../../../../src/tools/ToolDefinition.js';

/**
 * 构造最小 Context mock，包含 mainFrame / on 以触发 framenavigated 路径。
 */
function buildMockContext(
  options: {
    supportsAddInitScript?: boolean;
  } = {},
) {
  const supportsAddInitScript = options.supportsAddInitScript ?? true;
  const frameEvaluateCalls: string[] = [];
  const addInitScriptCalls: string[] = [];
  const framenavigatedHandlers: Array<(frame: any) => Promise<void>> = [];

  const fakeFrame = {
    evaluate: async (script: unknown) => {
      frameEvaluateCalls.push(String(script));
      return undefined;
    },
  };

  const fakePage: Record<string, unknown> = {
    mainFrame: () => fakeFrame,
    on: (event: string, handler: (frame: any) => Promise<void>) => {
      if (event === 'framenavigated') {
        framenavigatedHandlers.push(handler);
      }
    },
  };
  if (supportsAddInitScript) {
    fakePage.addInitScript = async (script: string) => {
      addInitScriptCalls.push(script);
    };
  }

  const ctx = {
    getSelectedFrame: () => fakeFrame,
    getSelectedPage: () => fakePage,
  } as unknown as Context;

  return {
    ctx,
    fakeFrame,
    fakePage,
    frameEvaluateCalls,
    addInitScriptCalls,
    framenavigatedHandlers,
  };
}

/** 最小 Response mock：记录结构化输出。 */
function buildMockResponse() {
  const calls: Array<Record<string, unknown>> = [];
  return {
    response: {
      setStructuredContent(content: Record<string, unknown>) {
        calls.push(content);
      },
    } as never,
    calls,
  };
}

describe('inject_hook world parameter', () => {
  beforeEach(() => {
    (getPersistentHookRegistry() as unknown as Map<string, unknown>).clear();
  });

  it('defaults to world=main when not specified', async () => {
    const {ctx} = buildMockContext();
    const {response, calls} = buildMockResponse();

    await injectHook.handler(
      {params: {hookId: 'hw1', script: '/*main*/'}},
      response,
      ctx,
    );

    const data = calls[0]?.data as any;
    assert.equal(data.world, 'main');
  });

  it('returns world=isolated when explicitly set', async () => {
    const {ctx} = buildMockContext();
    const {response, calls} = buildMockResponse();

    await injectHook.handler(
      {params: {hookId: 'hw2', script: '/*isolated*/', world: 'isolated'}},
      response,
      ctx,
    );

    const data = calls[0]?.data as any;
    assert.equal(data.world, 'isolated');
    assert.equal(calls[0]?.success, true);
  });

  it('includes persistentStrategy in response for persistent hooks', async () => {
    const {ctx} = buildMockContext();
    const {response, calls} = buildMockResponse();

    await injectHook.handler(
      {params: {hookId: 'hw3', script: '/*persist*/', persistent: true}},
      response,
      ctx,
    );

    const data = calls[0]?.data as any;
    assert.equal(data.persisted, true);
    assert.match(data.persistentStrategy, /addInitScript/);
  });

  it('includes persistentStrategy=evaluate-once for non-persistent hooks', async () => {
    const {ctx} = buildMockContext();
    const {response, calls} = buildMockResponse();

    await injectHook.handler(
      {params: {hookId: 'hw4', script: '/*once*/'}},
      response,
      ctx,
    );

    const data = calls[0]?.data as any;
    assert.equal(data.persisted, false);
    assert.equal(data.persistentStrategy, 'evaluate-once');
  });

  it('persistent hook stores world in registry', async () => {
    const {ctx} = buildMockContext();
    const {response} = buildMockResponse();

    await injectHook.handler(
      {
        params: {
          hookId: 'hw5',
          script: '/*pw*/',
          persistent: true,
          world: 'main',
        },
      },
      response,
      ctx,
    );

    const entry = getPersistentHookRegistry().get('hw5');
    assert.ok(entry);
    assert.equal((entry as any).world, 'main');
  });
});
