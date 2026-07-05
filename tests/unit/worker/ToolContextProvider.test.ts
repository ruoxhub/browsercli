/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {ToolResponseAccumulator} from '../../../src/worker/ToolResponse.js';
import {deobfuscateCode} from '../../../src/tools/analyzer/deobfuscate.js';
import {ToolContextProvider} from '../../../src/worker/ToolContext.js';

describe('ToolContextProvider', () => {
  it('provides analyzer runtime services for deobfuscate_code', async () => {
    const response = new ToolResponseAccumulator();
    await deobfuscateCode.handler(
      {
        params: {
          code: [
            "function _0x5c1a(){const _0x2f8b=['log','Hello, JSReverser-MCP!'];",
            '_0x5c1a=function(){return _0x2f8b;};return _0x5c1a();}',
            'function _0x1f4d(_0x31f4f6,_0x4df9ff){const _0x5c1af4=_0x5c1a();',
            'return _0x1f4d=function(_0x1f4d7d,_0x2dcf8d){_0x1f4d7d=_0x1f4d7d-0x0;',
            'return _0x5c1af4[_0x1f4d7d];},_0x1f4d(_0x31f4f6,_0x4df9ff);}',
            'console[_0x1f4d(0x0)](_0x1f4d(0x1));',
          ].join(''),
          aggressive: true,
          renameVariables: true,
        },
      },
      response,
      {} as never,
    );

    const result = response.toJSON().structuredContent as {
      success: boolean;
      tooltype: string;
      message: string;
      data: {code: string};
    };
    assert.equal(result.success, true);
    assert.equal(result.tooltype, 'deobfuscate');
    assert.match(result.message, /completed/i);
    assert.ok(typeof result.data.code === 'string');
    assert.ok(result.data.code.includes('console'));
  });

  it('provides analyzer runtime services for deobfuscate_code with scriptId', async () => {
    const response = new ToolResponseAccumulator();
    const mockDebugger = {
      getScriptSource: async (id: string) => {
        if (id === 'test-script-123') {
          return 'console.log("deobfuscate this!");';
        }
        return null;
      },
    };
    const mockContext = {
      getDebuggerContext: async () => mockDebugger,
    };

    await deobfuscateCode.handler(
      {
        params: {
          scriptId: 'test-script-123',
          aggressive: true,
          renameVariables: true,
        },
      },
      response,
      mockContext as any,
    );

    const result = response.toJSON().structuredContent as {
      success: boolean;
      tooltype: string;
      message: string;
      data: {code: string};
    };
    assert.equal(result.success, true);
    assert.equal(result.tooltype, 'deobfuscate');
    assert.match(result.message, /completed/i);
    assert.ok(typeof result.data.code === 'string');
  });

  it('reuses debugger context for the same page', async () => {
    const runtime = new ToolContextProvider();
    const client = {
      on: () => undefined,
      off: () => undefined,
      send: async () => undefined,
      detach: async () => undefined,
    };
    const page = {
      isClosed: () => false,
      mainFrame: () => null,
      context: () => ({
        newCDPSession: async () => client,
      }),
      once: () => undefined,
    };

    runtime.setSelectedPage(page as never);

    const first = await runtime.getDebuggerContext();
    const second = await runtime.getDebuggerContext();

    assert.equal(first, second);
  });

  it('resets the selected frame to the new page main frame when switching pages', () => {
    const runtime = new ToolContextProvider();
    const oldFrame = {name: 'old-frame'};
    const newFrame = {name: 'new-main-frame'};
    const newPage = {
      mainFrame: () => newFrame,
      on: () => undefined,
      once: () => undefined,
      setDefaultTimeout: () => undefined,
      setDefaultNavigationTimeout: () => undefined,
    };

    runtime.setSelectedFrame(oldFrame as never);
    runtime.selectPage(newPage as never);
    assert.equal(runtime.getSelectedFrame(), newFrame);

    runtime.setSelectedFrame(oldFrame as never);
    runtime.syncPageContext(newPage as never);
    assert.equal(runtime.getSelectedFrame(), newFrame);
  });

  it('reads network requests from the requested page index', () => {
    const runtime = new ToolContextProvider();
    const selectedPage = {id: 'selected', mainFrame: () => null};
    const targetPage = {id: 'target', mainFrame: () => null};
    const selectedRequest = {url: () => 'https://example.test/selected'};
    const targetRequest = {url: () => 'https://example.test/target'};

    runtime.setPages([selectedPage as never, targetPage as never]);
    runtime.setSelectedPage(selectedPage as never);

    // 通过 NetworkRequestCollector 的测试 seed 接口写入数据，
    // 避免依赖 ToolContextProvider 的内部 WeakMap 字段。
    runtime.networkCollector.seedPageData(selectedPage as never, [
      [{stableId: 1, request: selectedRequest as never}],
    ]);
    runtime.networkCollector.seedPageData(targetPage as never, [
      [{stableId: 2, request: targetRequest as never}],
    ]);

    const requests = runtime.getNetworkRequests(false, 1);

    assert.deepStrictEqual(requests, [targetRequest]);
    assert.equal(runtime.getNetworkRequestStableId(targetRequest), 2);
    assert.equal(runtime.getNetworkRequestById(2), targetRequest);
  });
});
