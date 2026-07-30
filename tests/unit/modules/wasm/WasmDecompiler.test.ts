/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {WasmDecompiler} from '../../../../src/modules/wasm/WasmDecompiler.js';

const ADD_MODULE = Uint8Array.from([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7,
  7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11,
]);

describe('WasmDecompiler', () => {
  it('counts exports when wabt renders them inline', async () => {
    const result = await new WasmDecompiler().decompile(ADD_MODULE, {
      inlineExport: true,
    });

    assert.strictEqual(result.functionCount, 1);
    assert.strictEqual(result.exportCount, 1);
  });

  it('counts exports in the default top-level rendering', async () => {
    const result = await new WasmDecompiler().decompile(ADD_MODULE);

    assert.strictEqual(result.functionCount, 1);
    assert.strictEqual(result.exportCount, 1);
  });
});
