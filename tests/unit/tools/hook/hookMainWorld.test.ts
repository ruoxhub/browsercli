/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import vm from 'node:vm';

import type {Frame} from 'patchright';

import {setRuntime} from '../../../../src/runtime.js';
import {injectHook} from '../../../../src/tools/hook.js';
import {removeHook} from '../../../../src/tools/hook.js';
import {HOOK_STORE_KEY} from '../../../../src/tools/hook.js';
import type {Context} from '../../../../src/tools/ToolDefinition.js';
import {ToolError} from '../../../../src/utils/errors.js';

/** 页面主 world 与 Playwright 隔离 world 各自独立的 realm。 */
function createTwoWorldFrame() {
  const mainRealm = vm.createContext({});
  const isolatedRealm = vm.createContext({});
  // 两个 realm 各自提供 window 自引用，模拟浏览器全局对象。
  vm.runInContext('var window = globalThis;', mainRealm);
  vm.runInContext('var window = globalThis;', isolatedRealm);
  const evaluatedExpressions: string[] = [];

  const runInRealm = (realm: vm.Context) => (script: string) =>
    vm.runInContext(script, realm);

  const contextListeners = new Set<(event: unknown) => void>();
  const client = {
    on: (event: string, listener: (event: unknown) => void) => {
      if (event === 'Runtime.executionContextCreated') {
        contextListeners.add(listener);
      }
    },
    off: (_event: string, listener: (event: unknown) => void) => {
      contextListeners.delete(listener);
    },
    send: async (method: string, params?: {expression?: string}) => {
      if (method === 'Runtime.enable') {
        for (const listener of contextListeners) {
          listener({context: {id: 7, auxData: {isDefault: true}}});
        }
        return {};
      }
      if (method === 'Runtime.evaluate') {
        evaluatedExpressions.push(params?.expression ?? '');
        try {
          return {
            result: {value: runInRealm(mainRealm)(params?.expression ?? '')},
          };
        } catch (error) {
          return {
            exceptionDetails: {exception: {description: String(error)}},
          };
        }
      }
      return {};
    },
    detach: async () => undefined,
  };

  const page = {
    context: () => ({newCDPSession: async () => client}),
  };

  const frame = {
    // frame.evaluate 代表 Playwright 隔离 world：这里写入的值不进主 world。
    evaluate: async (script: string) => runInRealm(isolatedRealm)(script),
    page: () => page,
  } as unknown as Frame;

  return {frame, mainRealm, isolatedRealm, evaluatedExpressions};
}

function contextHarness(frame: Frame) {
  return {
    getSelectedFrame: () => frame,
    getBrowserContext: () => null,
    getPersistentHookRegistry: () => ({register: async () => undefined}),
  } as unknown as Context;
}

function responseHarness() {
  let content: any;
  return {
    response: {
      setStructuredContent(value: unknown) {
        content = value;
      },
    } as any,
    get content() {
      return content;
    },
  };
}

describe('inject_hook 与非持久模式的主 world 注入', () => {
  it('executes the script in the page main world, not the isolated world', async () => {
    const {frame, mainRealm, isolatedRealm} = createTwoWorldFrame();
    const output = responseHarness();

    await injectHook.handler(
      {
        params: {
          hookId: 'mw',
          script: 'window.__mw_probe = "hit"; window.__hookStore = {};',
        },
      },
      output.response,
      contextHarness(frame),
    );

    assert.equal(vm.runInContext('window.__mw_probe', mainRealm), 'hit');
    assert.equal(
      vm.runInContext('typeof window.__mw_probe', isolatedRealm),
      'undefined',
    );
    assert.equal(output.content.data.ranOnCurrentFrame, true);
  });
});

describe('remove_hook 的浏览器端清理', () => {
  it('deletes the hook entry from the page main world store', async () => {
    const {frame, mainRealm} = createTwoWorldFrame();
    vm.runInContext(`window.${HOOK_STORE_KEY} = {h1: [1]};`, mainRealm);
    setRuntime({hookManager: {remove: () => false}} as never);

    try {
      const output = responseHarness();
      await removeHook.handler(
        {params: {hookId: 'h1'}},
        output.response,
        contextHarness(frame) as never,
      );

      assert.equal(
        vm.runInContext(`window.${HOOK_STORE_KEY}.h1`, mainRealm),
        undefined,
      );
      assert.equal(output.content.success, true);
      assert.equal(output.content.tooltype, 'remove_hook');
      assert.equal(output.content.hookId, 'h1');
    } finally {
      setRuntime(undefined);
    }
  });

  it('does not claim cleanup when the page had no such entry', async () => {
    const {frame, mainRealm} = createTwoWorldFrame();
    vm.runInContext(`window.${HOOK_STORE_KEY} = {};`, mainRealm);
    setRuntime({hookManager: {remove: () => false}} as never);

    try {
      await assert.rejects(
        () =>
          removeHook.handler(
            {params: {hookId: 'ghost'}},
            responseHarness().response,
            contextHarness(frame) as never,
          ),
        (error: unknown) =>
          error instanceof ToolError && error.code === 'NOT_FOUND',
      );
    } finally {
      setRuntime(undefined);
    }
  });
});
