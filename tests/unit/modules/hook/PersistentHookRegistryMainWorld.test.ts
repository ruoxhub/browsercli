/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';
import vm from 'node:vm';

import type {BrowserContext, Frame} from 'patchright';

import {PersistentHookRegistry} from '../../../../src/modules/hook/PersistentHookRegistry.js';

/** Frame whose page() 暴露一个只能走 Runtime.evaluate 的 CDP 主 world。 */
function createMainWorldFrame() {
  const mainRealm = vm.createContext({});
  vm.runInContext('var window = globalThis;', mainRealm);

  const contextListeners = new Set<(event: unknown) => void>();
  const evaluated: string[] = [];
  const client = {
    on: (event: string, listener: (event: unknown) => void) => {
      contextListeners.add(listener);
    },
    off: (_event: string, listener: (event: unknown) => void) => {
      contextListeners.delete(listener);
    },
    send: async (method: string, params?: {expression?: string}) => {
      if (method === 'Runtime.enable') {
        for (const listener of contextListeners) {
          listener({context: {id: 3, auxData: {isDefault: true}}});
        }
        return {};
      }
      if (method === 'Runtime.evaluate') {
        const expression = params?.expression ?? '';
        evaluated.push(expression);
        return {
          result: {value: vm.runInContext(expression, mainRealm)},
        };
      }
      return {};
    },
    detach: async () => undefined,
  };

  const frame = {
    url: () => 'https://example.com/',
    // 隔离 world：写进去的值不应出现在主 world。
    evaluate: async () => undefined,
    page: () => ({context: () => ({newCDPSession: async () => client})}),
  } as unknown as Frame;

  return {frame, mainRealm, evaluated};
}

function createContext(pages: unknown[]): BrowserContext {
  const context = {
    isClosed: () => false,
    once: () => context,
    addInitScript: async () => ({dispose: async () => undefined}),
    pages: () => pages,
  };
  return context as unknown as BrowserContext;
}

describe('PersistentHookRegistry 的主 world 回填', () => {
  it('backfills existing frames through Runtime.evaluate in the main world', async () => {
    const {frame, mainRealm, evaluated} = createMainWorldFrame();
    const page = {isClosed: () => false, frames: () => [frame]};
    const registry = new PersistentHookRegistry();

    const result = await registry.register({
      context: createContext([page]),
      hookId: 'persist-main-world',
      script: 'window.__persisted = true;',
      source: 'inject_hook',
      requestedWorld: 'main',
      applyMode: 'existing-and-future',
    });

    assert.equal(result.appliedFrames, 1);
    assert.deepStrictEqual(result.failedFrames, []);
    assert.ok(evaluated.includes('window.__persisted = true;'));
    assert.equal(
      vm.runInContext('window.__persisted', mainRealm),
      true,
      '脚本必须落在页面主 world',
    );
  });
});
