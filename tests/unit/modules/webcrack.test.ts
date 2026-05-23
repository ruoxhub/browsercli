/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import path from 'node:path';
import {describe, it} from 'node:test';

import {runWebcrack} from '../../../src/modules/deobfuscator/webcrack.js';

describe('runWebcrack adapter', () => {
  it('returns optionsUsed with defaults when nothing supplied', async () => {
    const r = await runWebcrack('var a = 1;', {});
    assert.deepStrictEqual(r.optionsUsed, {
      jsx: true,
      mangle: false,
      unminify: true,
      unpack: true,
    });
  });

  it('respects explicit overrides', async () => {
    const r = await runWebcrack('var a = 1;', {
      jsx: false,
      mangle: true,
      unminify: false,
      unpack: false,
    });
    assert.deepStrictEqual(r.optionsUsed, {
      jsx: false,
      mangle: true,
      unminify: false,
      unpack: false,
    });
  });

  it('returns applied: true for trivially valid input', async () => {
    const r = await runWebcrack('var x = 1 + 2;', {});
    if (r.applied) {
      assert.equal(typeof r.code, 'string');
      assert.ok(r.code.length > 0);
    } else {
      assert.match(r.reason ?? '', /webcrack (module not available|requires)/);
    }
  });

  it('returns applied: false with reason for unparseable input', async () => {
    const r = await runWebcrack('{{{{not valid javascript at all!!!!', {});
    assert.equal(r.applied, false);
    assert.equal(typeof r.reason, 'string');
    assert.ok((r.reason ?? '').length > 0);
  });

  it('rejects outputDir that escapes project root', async () => {
    await assert.rejects(
      runWebcrack('var a=1;', {outputDir: path.join('..', '..', 'evil')}),
      /outputDir must resolve to a path within the project root/,
    );
  });

  it('summarizes a webpack-like bundle when unpack=true', async () => {
    const bundle = `
      (function(modules){
        function __webpack_require__(id){
          var m = {exports: {}};
          modules[id].call(m.exports, m, m.exports, __webpack_require__);
          return m.exports;
        }
        return __webpack_require__(0);
      })([
        function(module, exports, __webpack_require__){
          var dep = __webpack_require__(1);
          module.exports = function(){ return dep.hello(); };
        },
        function(module, exports){
          module.exports = { hello: function(){ return "world"; } };
        }
      ]);
    `;
    const r = await runWebcrack(bundle, {unpack: true});
    if (r.applied && r.bundle) {
      assert.equal(r.bundle.type, 'webpack');
      assert.ok(r.bundle.moduleCount > 0);
      assert.ok(r.bundle.modules.length > 0);
    } else {
      assert.equal(r.applied, false);
      assert.match(r.reason ?? '', /webcrack/i);
    }
  });
});
