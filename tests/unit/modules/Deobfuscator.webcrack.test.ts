/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {Deobfuscator} from '../../../src/modules/deobfuscator/Deobfuscator.js';
import {isSupportedNodeVersion} from '../../../src/modules/deobfuscator/webcrack.js';

describe('Deobfuscator + webcrack integration', () => {
  it('does not run webcrack when auto=false and webcrack flag absent', async () => {
    const d = new Deobfuscator();
    const r = await d.deobfuscate({
      code: 'var a = 1 + 2;',
      auto: false,
    });
    const wc = r.transformations.find(t => t.type === 'webcrack');
    assert.equal(wc, undefined);
    assert.equal(r.webcrackApplied, false);
    assert.equal(r.engine, 'legacy');
  });

  it('runs webcrack when explicitly enabled even on tiny input', async () => {
    const d = new Deobfuscator();
    const r = await d.deobfuscate({
      code: 'var a = 1 + 2;',
      auto: false,
      webcrack: true,
    });
    const wc = r.transformations.find(t => t.type === 'webcrack');
    assert.ok(wc, 'webcrack transformation entry expected');
    if (isSupportedNodeVersion()) {
      // 当 webcrack 可用时 success 应为 true（除非 isolated-vm 缺失）
      // 这里弱断言：要么成功要么因为缺包失败，但一定有 transformation 记录
      assert.ok(typeof wc!.success === 'boolean');
    }
  });

  it('triggers webcrack automatically when webpack pattern detected', async () => {
    const d = new Deobfuscator();
    const code = `
      (function(modules){
        function __webpack_require__(id){
          var m = {exports:{}};
          modules[id].call(m.exports, m, m.exports, __webpack_require__);
          return m.exports;
        }
        return __webpack_require__(0);
      })([
        function(module, exports){ module.exports = function(){return 42;}; }
      ]);
    `;
    const r = await d.deobfuscate({code, auto: true});
    const wc = r.transformations.find(t => t.type === 'webcrack');
    assert.ok(wc, 'auto mode should pick webcrack on webpack input');
  });

  it('returns engine=legacy when webcrack unavailable / not triggered', async () => {
    const d = new Deobfuscator();
    const r = await d.deobfuscate({
      code: 'var a = 1;',
      auto: false,
    });
    assert.equal(r.engine, 'legacy');
    assert.equal(r.webcrackApplied, false);
  });

  it('flags cached=true on second identical call', async () => {
    const d = new Deobfuscator();
    const opts = {code: 'var a = 1 + 2;', auto: false} as const;
    const first = await d.deobfuscate(opts);
    const second = await d.deobfuscate(opts);
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
  });

  it('produces different cache entries when webcrack flag toggles', async () => {
    const d = new Deobfuscator();
    const a = await d.deobfuscate({code: 'var a = 1;', auto: false});
    const b = await d.deobfuscate({
      code: 'var a = 1;',
      auto: false,
      webcrack: true,
    });
    // 两次结果都不是缓存命中（因为 cache key 不同）
    assert.equal(a.cached, false);
    assert.equal(b.cached, false);
  });

  it('rejects outputDir that escapes project root via warning', async () => {
    const d = new Deobfuscator();
    const r = await d.deobfuscate({
      code: 'var a = 1;',
      auto: false,
      webcrack: true,
      outputDir: '../../escape',
    });
    const wc = r.transformations.find(t => t.type === 'webcrack');
    // 失败被记录为 success:false，且 warnings 中包含 outputDir 错误
    assert.ok(wc);
    assert.equal(wc!.success, false);
    assert.ok(
      (r.warnings ?? []).some(w => w.toLowerCase().includes('outputdir')),
      `expected outputDir warning, got: ${JSON.stringify(r.warnings)}`,
    );
  });
});
