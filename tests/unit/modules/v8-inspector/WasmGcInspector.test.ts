/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  discoverWasmScripts,
  inspectWasmGc,
} from '../../../../src/modules/v8-inspector/WasmGcInspector.js';

function assertBrowserJavaScript(expression: unknown): string {
  assert.ok(typeof expression === 'string');
  new Function(`return (${expression});`);
  return expression;
}

function createWasmPage(
  wasmResources: Array<{
    scriptId: string;
    url: string;
    byteSize: number;
  }> = [
    {
      scriptId: '7',
      url: 'wasm://wasm/example-test-module',
      byteSize: 128,
    },
  ],
  features = {gc: true, threads: false, simd: true},
) {
  let detachCount = 0;
  const expressions: string[] = [];
  const page = {
    context() {
      return {
        async newCDPSession(target: unknown) {
          assert.equal(target, page);
          const listeners = new Map<
            string,
            Set<(...args: unknown[]) => void>
          >();
          return {
            async send(
              method: string,
              params?: Record<string, unknown>,
            ): Promise<unknown> {
              if (method === 'Runtime.enable') return {};
              if (method === 'Debugger.enable') {
                for (const script of wasmResources) {
                  for (const listener of listeners.get(
                    'Debugger.scriptParsed',
                  ) ?? []) {
                    listener({
                      scriptId: script.scriptId,
                      url: script.url,
                      length: script.byteSize,
                      scriptLanguage: 'WebAssembly',
                    });
                  }
                }
                return {};
              }
              assert.equal(method, 'Runtime.evaluate');
              const expression = assertBrowserJavaScript(
                params?.['expression'],
              );
              expressions.push(expression);

              return {
                result: {
                  value: JSON.stringify({
                    modules: [],
                    totalModules: 1,
                    gcModules: 1,
                    features,
                    hasGC: features.gc,
                    structs: [],
                  }),
                },
              };
            },
            on(event: string, listener: (...args: unknown[]) => void) {
              const eventListeners = listeners.get(event) ?? new Set();
              eventListeners.add(listener);
              listeners.set(event, eventListeners);
            },
            off(event: string, listener: (...args: unknown[]) => void) {
              listeners.get(event)?.delete(listener);
            },
            async detach(): Promise<void> {
              detachCount += 1;
            },
          };
        },
      };
    },
  };

  return {
    expressions,
    get detachCount(): number {
      return detachCount;
    },
    page,
  };
}

describe('WasmGcInspector', () => {
  it('discovers WASM resources with browser-executable probe code', async () => {
    const harness = createWasmPage();

    assert.deepEqual(await discoverWasmScripts(harness.page), [
      {
        scriptId: '7',
        url: 'wasm://wasm/example-test-module',
        isWasm: true,
        byteSize: 128,
      },
    ]);
    assert.equal(harness.detachCount, 1);
  });

  it('combines feature inspection with discovered resources and detaches both sessions', async () => {
    const harness = createWasmPage();

    const result = await inspectWasmGc(harness.page, {includeStructs: false});

    assert.equal(result.success, true);
    assert.equal(result.totalModules, 1);
    assert.equal(result.gcModules, 1);
    assert.equal(result.wasmGcAvailable, true);
    assert.deepEqual(result.summary, {
      totalWasmModules: 1,
      gcModules: 1,
      nonGcModules: 0,
      hasGcFeature: true,
      hasThreadsFeature: false,
      hasSimdFeature: true,
    });
    assert.equal(harness.detachCount, 2);
    assert.ok(
      harness.expressions.every(expression => !expression.includes(' as any')),
    );
    assert.ok(
      harness.expressions.some(expression =>
        expression.includes('WebAssembly.validate'),
      ),
    );
    assert.ok(
      harness.expressions.every(
        expression => !expression.includes('WebAssembly.Struct'),
      ),
    );
  });

  it('filters modules by scriptId and keeps module counts consistent', async () => {
    const harness = createWasmPage([
      {
        scriptId: '7',
        url: 'wasm://wasm/selected',
        byteSize: 64,
      },
      {
        scriptId: '8',
        url: 'wasm://wasm/other',
        byteSize: 32,
      },
    ]);

    const result = await inspectWasmGc(harness.page, {
      scriptId: '7',
      includeStructs: false,
    });

    assert.equal(result.totalModules, 1);
    assert.equal(result.gcModules, 1);
    assert.deepEqual(result.modules, [
      {
        moduleId: '7',
        url: 'wasm://wasm/selected',
        usesGC: true,
        features: {gc: true, threads: false, simd: true},
      },
    ]);
    assert.deepEqual(result.wasmScripts, [
      {
        scriptId: '7',
        url: 'wasm://wasm/selected',
        isWasm: true,
        byteSize: 64,
      },
    ]);
    assert.equal(result.summary.totalWasmModules, 1);
  });

  it('rejects Runtime.evaluate protocol exceptions', async () => {
    const page = {
      context() {
        return {
          async newCDPSession() {
            return {
              async send(method: string): Promise<unknown> {
                return method === 'Runtime.enable'
                  ? {}
                  : {exceptionDetails: {text: 'probe failed'}};
              },
              detach(): Promise<void> {
                return Promise.resolve();
              },
            };
          },
        };
      },
    };

    await assert.rejects(
      inspectWasmGc(page, {}),
      /Runtime\.evaluate failed: probe failed/u,
    );
  });

  it('rejects values that cannot create a CDP session', async () => {
    await assert.rejects(
      inspectWasmGc({}, {}),
      /WASM inspection requires a live CDP page/u,
    );
  });
});
