/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, it} from 'node:test';
import vm from 'node:vm';

import type {Frame, Page} from 'patchright';

import {setRuntime} from '../../../../src/runtime.js';
import type {Context} from '../../../../src/tools/ToolDefinition.js';
import {collectWasm} from '../../../../src/tools/wasm/collectWasm.js';
import {manifest as wasmManifest} from '../../../../src/tools/wasm/manifest.js';
import {wasmMemoryInspect} from '../../../../src/tools/wasm/wasmMemoryInspect.js';
import {wasmOfflineRun} from '../../../../src/tools/wasm/wasmOfflineRun.js';
import {wasmOptimize} from '../../../../src/tools/wasm/wasmOptimize.js';
import {ErrorCodes, ToolError} from '../../../../src/utils/errors.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

afterEach(() => setRuntime(undefined));

interface StructuredContent {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

function structuredContent(response: ToolResponseAccumulator) {
  return response.toJSON().structuredContent as StructuredContent;
}

function memoryContextHarness() {
  const realm = vm.createContext({__name: (value: unknown) => value});
  vm.runInContext(
    `
globalThis.getterCalls = 0;
globalThis.exports = {memory: new WebAssembly.Memory({initial: 1})};
Object.defineProperty(globalThis, 'dangerous', {
  enumerable: true,
  get() {
    globalThis.getterCalls += 1;
    throw new Error('getter must not run');
  },
});
`,
    realm,
  );
  const evaluateInRealm =
    (targetRealm: vm.Context) =>
    async (callback: (...args: never[]) => unknown, argument?: unknown) => {
      if (typeof callback === 'string') {
        return vm.runInContext(callback, targetRealm);
      }
      const serializedArgument =
        argument === undefined ? 'undefined' : JSON.stringify(argument);
      return vm.runInContext(
        `(${callback.toString()})(${serializedArgument})`,
        targetRealm,
      );
    };
  const staleRealm = vm.createContext({__name: (value: unknown) => value});
  const evaluateInMainRealm = evaluateInRealm(realm);
  const evaluateInIsolatedRealm = evaluateInRealm(staleRealm);
  const frame = {
    evaluate: evaluateInMainRealm,
    page: () => page,
  } as unknown as Frame;
  const staleFrame = {
    evaluate: evaluateInIsolatedRealm,
    page: () => page,
  } as unknown as Frame;
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
    send: async (
      method: string,
      params?: {expression?: string; contextId?: number},
    ) => {
      if (method === 'Runtime.enable') {
        for (const listener of contextListeners) {
          listener({
            context: {
              id: 7,
              auxData: {isDefault: true, type: 'default'},
            },
          });
          listener({
            context: {
              id: 8,
              auxData: {isDefault: false, type: 'isolated'},
            },
          });
        }
        return {};
      }
      if (method === 'Runtime.evaluate') {
        const targetRealm = params?.contextId === 7 ? realm : staleRealm;
        return {
          result: {
            value: vm.runInContext(params?.expression ?? '', targetRealm),
          },
        };
      }
      return {};
    },
    detach: async () => undefined,
  };
  const page = {
    context: () => ({newCDPSession: async () => client}),
    evaluate: evaluateInIsolatedRealm,
    mainFrame: () => frame,
  } as unknown as Page;
  const context = {
    getSelectedFrame: () => staleFrame,
    getSelectedPage: () => page,
  } as unknown as Context;

  return {context, realm};
}

describe('collect_wasm', () => {
  it('is exposed by the full WASM manifest', () => {
    assert.ok(
      wasmManifest.tools.some(item => item.handlerName === 'collectWasm'),
    );
  });

  it('delegates collection options to the runtime collector', async () => {
    let receivedOptions: unknown;
    let receivedPage: unknown;
    let synchronizedPage: unknown;
    const selectedPage = {} as Page;
    setRuntime({
      syncPageContext: (page: Page) => {
        synchronizedPage = page;
      },
      wasmCollector: {
        collect: async (options: unknown, _task: unknown, page: unknown) => {
          receivedOptions = options;
          receivedPage = page;
          return {
            modules: [],
            runtimeEvents: [],
            totalModules: 1,
            totalRuntimeEvents: 2,
            collectedAt: '2026-08-15T00:00:00.000Z',
          };
        },
      },
    } as never);
    const response = new ToolResponseAccumulator();

    await collectWasm.handler(
      {
        params: {
          url: 'https://example.test/wasm',
          timeout: 1234,
          includeRuntimeEvents: false,
        },
      },
      response,
      {getSelectedPage: () => selectedPage} as unknown as Context,
    );

    assert.equal(synchronizedPage, selectedPage);
    assert.equal(receivedPage, selectedPage);
    assert.deepEqual(receivedOptions, {
      url: 'https://example.test/wasm',
      timeout: 1234,
      includeRuntimeEvents: false,
    });
    const content = structuredContent(response);
    assert.equal(content.success, true, content.message);
    assert.match(content.message, /1 个 WASM 模块/);
    assert.match(content.message, /2 个运行时事件/);
  });

  it('rejects when collection never settles', async () => {
    const selectedPage = {} as Page;
    setRuntime({
      syncPageContext: () => undefined,
      wasmCollector: {
        collect: () => new Promise<never>(() => undefined),
      },
    } as never);
    const response = new ToolResponseAccumulator();

    await assert.rejects(
      collectWasm.handler(
        {
          params: {
            url: 'https://example.test/wasm',
            timeout: 20,
          },
        },
        response,
        {getSelectedPage: () => selectedPage} as unknown as Context,
      ),
      (error: unknown) => error instanceof Error && /超时/.test(error.message),
    );
  });
});

describe('wasm_memory_inspect', () => {
  it('finds an exported memory without invoking global getters', async () => {
    const harness = memoryContextHarness();
    const response = new ToolResponseAccumulator();

    await wasmMemoryInspect.handler(
      {
        params: {
          offset: 0,
          length: 8,
          format: 'hex',
          timeoutMs: 500,
        },
      } as never,
      response,
      harness.context,
    );

    assert.equal(vm.runInContext('globalThis.getterCalls', harness.realm), 0);
    const content = structuredContent(response);
    assert.equal(content.success, true, content.message);
    assert.equal(content.data?.hex, '00 00 00 00 00 00 00 00');
  });

  it('rejects when frame evaluation never settles', async () => {
    const evaluate = () => new Promise<never>(() => undefined);
    const frame = {evaluate} as unknown as Frame;
    const page = {evaluate, mainFrame: () => frame} as unknown as Page;
    const context = {
      getSelectedFrame: () => frame,
      getSelectedPage: () => page,
    } as unknown as Context;
    const response = new ToolResponseAccumulator();

    await assert.rejects(
      wasmMemoryInspect.handler(
        {params: {timeoutMs: 20}} as never,
        response,
        context,
      ),
      (error: unknown) => error instanceof Error && /超时/.test(error.message),
    );
  });
});

describe('native WASM tool failures', () => {
  it('reports every missing runtime and optimizer by name', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'browsercli-wasm-tools-'));
    const inputPath = join(tempDir, 'input.wasm');
    await writeFile(
      inputPath,
      Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
    );
    const pathKey =
      Object.keys(process.env).find(key => key.toLowerCase() === 'path') ??
      'PATH';
    const originalPath = process.env[pathKey];
    process.env[pathKey] = tempDir;

    try {
      const offlineResponse = new ToolResponseAccumulator();
      await assert.rejects(
        wasmOfflineRun.handler(
          {
            params: {
              inputPath,
              functionName: 'encrypt',
              runtime: 'auto',
            },
          },
          offlineResponse,
          {} as never,
        ),
        (error: unknown) =>
          error instanceof ToolError &&
          error.code === ErrorCodes.NATIVE_TOOL_MISSING &&
          /wasmtime/.test(error.message) &&
          /wasmer/.test(error.message),
      );

      const optimizeResponse = new ToolResponseAccumulator();
      await assert.rejects(
        wasmOptimize.handler(
          {params: {inputPath}},
          optimizeResponse,
          {} as never,
        ),
        (error: unknown) =>
          error instanceof ToolError &&
          error.code === ErrorCodes.NATIVE_TOOL_MISSING &&
          /wasm-opt/.test(error.message),
      );
    } finally {
      if (originalPath === undefined) {
        delete process.env[pathKey];
      } else {
        process.env[pathKey] = originalPath;
      }
      await rm(tempDir, {recursive: true, force: true});
    }
  });
});
