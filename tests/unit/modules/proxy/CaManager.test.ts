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

import {CaManager} from '../../../../src/modules/proxy/CaManager.js';

describe('CaManager', () => {
  it('init 生成根 CA 并持久化到磁盘', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-'));
    try {
      const ca = new CaManager(dir);
      await ca.init();
      assert.strictEqual(ca.isInitialized(), true);
      assert.strictEqual(existsSync(path.join(dir, 'ca-cert.pem')), true);
      assert.strictEqual(existsSync(path.join(dir, 'ca-key.pem')), true);
      assert.ok(ca.getCaCertPath().endsWith('ca-cert.pem'));
      assert.ok(ca.getCaCertDer().length > 0);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('同域名二次取 SecureContext 命中缓存（同一实例）', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-'));
    try {
      const ca = new CaManager(dir);
      await ca.init();
      const first = ca.getSecureContextForHost('example.com');
      const second = ca.getSecureContextForHost('example.com');
      assert.strictEqual(first, second);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('再次 init 从磁盘加载既有 CA（不重新生成）', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-'));
    try {
      const ca1 = new CaManager(dir);
      await ca1.init();
      const path1 = ca1.getCaCertPath();

      const ca2 = new CaManager(dir);
      await ca2.init();
      assert.strictEqual(ca2.getCaCertPath(), path1);
      assert.strictEqual(ca2.isInitialized(), true);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
