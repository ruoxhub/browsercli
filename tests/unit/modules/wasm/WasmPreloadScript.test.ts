/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';
import vm from 'node:vm';

import {buildPreloadScript} from '../../../../src/modules/wasm/WasmPreloadScript.js';

describe('WasmPreloadScript', () => {
  it('returns a non-empty string', () => {
    const script = buildPreloadScript();
    assert.strictEqual(typeof script, 'string');
    assert.ok(script.length > 1000, 'preload script should be substantial');
  });

  it('is wrapped in an IIFE', () => {
    const script = buildPreloadScript();
    assert.ok(
      script.trimStart().startsWith('(() =>'),
      'preload script should start with an IIFE',
    );
    assert.ok(
      script.trimEnd().endsWith('})();'),
      'preload script should end with IIFE invocation',
    );
  });

  it('contains expected installation guard marker', () => {
    const script = buildPreloadScript();
    assert.ok(
      script.includes('__jshookWasmCaptureInstalled__'),
      'should contain the installation guard global',
    );
  });

  it('contains the shared capture state global', () => {
    const script = buildPreloadScript();
    assert.ok(
      script.includes('__jshookWasmCapture__'),
      'should expose the capture state global',
    );
  });

  it('hooks the WebAssembly.compile / instantiate entry points', () => {
    const script = buildPreloadScript();
    assert.ok(
      script.includes('WebAssembly.compile') &&
        script.includes('WebAssembly.instantiate') &&
        script.includes('WebAssembly.compileStreaming') &&
        script.includes('WebAssembly.instantiateStreaming'),
      'should hook all four WebAssembly entry points',
    );
  });

  it('installs typed-array and DataView tracking', () => {
    const script = buildPreloadScript();
    assert.ok(
      script.includes('installTypedArrayTracking'),
      'should reference typed-array tracking installer',
    );
    assert.ok(script.includes('DataView'), 'should patch DataView');
  });

  it('installs network tracking (fetch + XHR)', () => {
    const script = buildPreloadScript();
    assert.ok(
      script.includes('installNetworkTracking'),
      'should reference network tracking installer',
    );
    assert.ok(script.includes('XMLHttpRequest'), 'should patch XMLHttpRequest');
  });

  it('is idempotent across invocations', () => {
    const a = buildPreloadScript();
    const b = buildPreloadScript();
    assert.strictEqual(a, b, 'repeated calls return identical script');
  });

  it('keeps the exported memory buffer getter callable through its proxy', async () => {
    const context = vm.createContext({
      Response,
      WebAssembly,
      btoa,
    });
    vm.runInContext(buildPreloadScript(), context);
    const byteLength = await vm.runInContext(
      `WebAssembly.instantiate(new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0,
        5, 3, 1, 0, 1,
        7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0
      ])).then(result => result.instance.exports.memory.buffer.byteLength)`,
      context,
    );

    assert.equal(byteLength, 65_536);
  });
});
