/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {MitmModule} from '../../../../src/modules/proxy/MitmModule.js';

describe('MitmModule', () => {
  it('status 未启动时返回 running=false 且 capturedCount=0', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    try {
      const mod = new MitmModule(dir);
      const result = mod.status();
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.running, false);
      assert.strictEqual(result.data.capturedCount, 0);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('clear 未捕获时返回 clearedCount=0', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    try {
      const mod = new MitmModule(dir);
      const result = mod.clear();
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.clearedCount, 0);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('exportCa 把 pem 写入目标路径并返回字节数', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'mitm-out-'));
    try {
      const mod = new MitmModule(dir);
      const outPath = path.join(outDir, 'ca.pem');
      const result = await mod.exportCa({format: 'pem', outputPath: outPath});
      assert.strictEqual(result.success, true);
      assert.ok(result.data.bytes > 0);
      assert.ok(existsSync(outPath));
    } finally {
      rmSync(dir, {recursive: true, force: true});
      rmSync(outDir, {recursive: true, force: true});
    }
  });
});
