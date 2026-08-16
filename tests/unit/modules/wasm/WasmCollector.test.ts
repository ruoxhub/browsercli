/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {Page} from 'patchright';

import {WasmCollector} from '../../../../src/modules/wasm/WasmCollector.js';

describe('WasmCollector', () => {
  it('uses DOM readiness instead of waiting for global network idle', async () => {
    let navigationOptions: {waitUntil?: string; timeout?: number} | undefined;
    let preloadCalls = 0;
    const page = {
      addInitScript: async () => {
        preloadCalls += 1;
      },
      evaluate: async () => ({modules: [], events: []}),
      goto: async (
        _url: string,
        options: {waitUntil?: string; timeout?: number},
      ) => {
        navigationOptions = options;
      },
      off: () => undefined,
      on: () => undefined,
    } as unknown as Page;
    const collector = new WasmCollector(
      {
        getPage: async () => page,
        injectScriptOnNewDocument: async () => undefined,
      } as never,
      {} as never,
      {} as never,
    );

    await collector.collect({
      url: 'https://example.test/wasm',
      waitAfterLoadMs: 0,
      includeRuntimeEvents: false,
    });

    assert.equal(navigationOptions?.waitUntil, 'domcontentloaded');
    assert.equal(preloadCalls, 0);
  });

  it('captures runtime events from a main-world preload', async () => {
    const commands: string[] = [];
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
      send: async (method: string) => {
        commands.push(method);
        if (method === 'Page.addScriptToEvaluateOnNewDocument') {
          return {identifier: 'wasm-preload-1'};
        }
        if (method === 'Runtime.enable') {
          for (const listener of contextListeners) {
            listener({
              context: {
                id: 11,
                auxData: {isDefault: true, type: 'default'},
              },
            });
          }
          return {};
        }
        if (method === 'Runtime.evaluate') {
          return {
            result: {
              value: {
                modules: [],
                events: [{type: 'instantiate', timestamp: 1}],
              },
            },
          };
        }
        return {};
      },
      detach: async () => undefined,
    };
    const frame = {page: () => page} as never;
    const page = {
      context: () => ({newCDPSession: async () => client}),
      goto: async () => undefined,
      mainFrame: () => frame,
      off: () => undefined,
      on: () => undefined,
    } as unknown as Page;
    const collector = new WasmCollector(
      {getPage: async () => page} as never,
      {} as never,
      {} as never,
    );

    const result = await collector.collect({
      url: 'https://example.test/runtime-wasm',
      waitAfterLoadMs: 0,
      includeRuntimeEvents: true,
    });

    assert.ok(commands.includes('Page.enable'));
    assert.ok(commands.includes('Page.addScriptToEvaluateOnNewDocument'));
    assert.ok(commands.includes('Page.removeScriptToEvaluateOnNewDocument'));
    assert.equal(result.totalRuntimeEvents, 1);
  });
});
