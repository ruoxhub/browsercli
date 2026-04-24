/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {deobfuscateCode} from '../../../src/tools/analyzer/deobfuscate.js';
import {ToolContextProvider} from '../../../src/worker/ToolContextProvider.js';

describe('ToolContextProvider', () => {
  it('provides analyzer runtime services for deobfuscate_code', async () => {
    const runtime = new ToolContextProvider();

    const result = await deobfuscateCode(runtime, {
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
    });

    assert.equal(result.success, true);
    assert.equal(result.tooltype, 'deobfuscate');
    assert.match(result.message, /completed/i);
    assert.ok(typeof result.data.code === 'string');
    assert.ok(result.data.code.includes('console'));
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
});
