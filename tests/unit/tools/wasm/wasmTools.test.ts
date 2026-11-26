/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';

import type {Page} from 'patchright';

import {setRuntime} from '../../../../src/runtime.js';
import type {Context} from '../../../../src/tools/ToolDefinition.js';
import {
  collectWasm,
  manifest as wasmManifest,
  wasmVmpTrace,
} from '../../../../src/tools/wasm.js';
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

describe('collect_wasm', () => {
  it('exposes collectWasm, wasmDump and wasmVmpTrace in the full WASM manifest', () => {
    assert.deepEqual(
      wasmManifest.tools.map(item => item.handlerName),
      ['collectWasm', 'wasmDump', 'wasmVmpTrace'],
    );
  });

  it('delegates collection options including clearPrevious to the runtime collector', async () => {
    let receivedOptions: unknown;
    let receivedPage: unknown;
    let synchronizedPage: unknown;
    const selectedPage = {} as Page;
    const wasmCollector = {
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
    };
    const response = new ToolResponseAccumulator();

    await collectWasm.handler(
      {
        params: {
          url: 'https://example.test/wasm',
          timeout: 1234,
          includeRuntimeEvents: false,
          clearPrevious: true,
        },
      },
      response,
      {
        getSelectedPage: () => selectedPage,
        syncPageContext: (page: Page) => {
          synchronizedPage = page;
        },
        getWasmCollector: () => wasmCollector,
      } as unknown as Context,
    );

    assert.equal(synchronizedPage, selectedPage);
    assert.equal(receivedPage, selectedPage);
    assert.deepEqual(receivedOptions, {
      url: 'https://example.test/wasm',
      timeout: 1234,
      includeRuntimeEvents: false,
      clearPrevious: true,
    });
    const content = structuredContent(response);
    assert.equal(content.success, true, content.message);
    assert.match(content.message, /1 个 WASM 模块/);
    assert.match(content.message, /2 个运行时事件/);
  });

  it('rejects when collection never settles', async () => {
    const selectedPage = {} as Page;
    const wasmCollector = {
      collect: () => new Promise<never>(() => undefined),
    };
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
        {
          getSelectedPage: () => selectedPage,
          syncPageContext: () => undefined,
          getWasmCollector: () => wasmCollector,
        } as unknown as Context,
      ),
      (error: unknown) => error instanceof Error && /超时/.test(error.message),
    );
  });
});

describe('wasm_vmp_trace', () => {
  it('refreshes incremental events from the selected page by default and filters by module', async () => {
    let refreshedPage: unknown;
    const selectedPage = {} as Page;
    const events = [
      {id: 'e1', type: 'export_call', timestamp: 1, moduleId: 'wasm_a'},
      {id: 'e2', type: 'export_call', timestamp: 2, moduleId: 'wasm_b'},
    ];
    const wasmCollector = {
      refreshFromPage: async (page: unknown) => {
        refreshedPage = page;
        events.push({
          id: 'e3',
          type: 'export_call',
          timestamp: 3,
          moduleId: 'wasm_a',
        });
        return {addedEvents: 1};
      },
      getRuntimeEvents: () => events,
      getModules: () => [{id: 'wasm_a', hash: 'aaaa', size: 16}],
    };
    const response = new ToolResponseAccumulator();

    await wasmVmpTrace.handler(
      {params: {filterModule: 'wasm_a', maxEvents: 10}},
      response,
      {
        getSelectedPage: () => selectedPage,
        getWasmCollector: () => wasmCollector,
      } as unknown as Context,
    );

    assert.equal(refreshedPage, selectedPage);
    const content = structuredContent(response);
    assert.equal(content.success, true, content.message);
    assert.equal(content.data?.totalEvents, 3);
    assert.equal(content.data?.filteredEvents, 2);
  });

  it('skips live page refresh when refresh is false', async () => {
    let refreshCalled = false;
    const selectedPage = {} as Page;
    const wasmCollector = {
      refreshFromPage: async () => {
        refreshCalled = true;
        return {addedEvents: 0};
      },
      getRuntimeEvents: () => [
        {id: 'e1', type: 'instantiate', timestamp: 1, moduleId: 'wasm_a'},
      ],
      getModules: () => [],
    };
    const response = new ToolResponseAccumulator();

    await wasmVmpTrace.handler({params: {refresh: false}}, response, {
      getSelectedPage: () => selectedPage,
      getWasmCollector: () => wasmCollector,
    } as unknown as Context);

    assert.equal(refreshCalled, false);
    const content = structuredContent(response);
    assert.equal(content.success, true, content.message);
    assert.equal(content.data?.totalEvents, 1);
  });
});
