/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {mkdtempSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, it} from 'node:test';

import {MitmModule} from '../../../../src/modules/proxy/MitmModule.js';
import type {SystemProxyManager} from '../../../../src/modules/proxy/SystemProxyManager.js';

function makeSystemProxyMock() {
  const state = {
    enabled: false,
    restored: 0,
    residualChecked: 0,
    lastPort: 0,
  };
  const manager = {
    isActive: () => state.enabled,
    enable: async (port: number) => {
      state.enabled = true;
      state.lastPort = port;
    },
    restore: async () => {
      state.enabled = false;
      state.restored += 1;
    },
    restoreSync: () => {
      state.enabled = false;
      state.restored += 1;
    },
    checkResidual: async () => {
      state.residualChecked += 1;
      return false;
    },
  } as unknown as SystemProxyManager;
  return {manager, state};
}

describe('MitmModule Local Apps 门面', () => {
  const activeModules: MitmModule[] = [];

  function makeModule() {
    const proxy = makeSystemProxyMock();
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-local-apps-'));
    const mod = new MitmModule(dir, undefined, proxy.manager);
    activeModules.push(mod);
    return {mod, proxy};
  }

  afterEach(async () => {
    while (activeModules.length > 0) {
      const m = activeModules.pop();
      if (m) {
        await m.stop();
      }
    }
  });

  it('初始状态：全关', () => {
    const {mod} = makeModule();
    const s = mod.getLocalAppsStatus();
    assert.deepStrictEqual(s, {
      enabled: false,
      targets: [],
      systemProxyActive: false,
      trackerDegraded: false,
      systemProxyUnsupported: process.platform !== 'win32',
    });
  });

  it('configureLocalApps({enabled:true}) 自动启动代理并接管系统代理', async () => {
    const {mod, proxy} = makeModule();
    const result = await mod.configureLocalApps({
      enabled: true,
      targets: ['wechat.exe'],
      port: 0,
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(proxy.state.enabled, true);
    assert.strictEqual(proxy.state.lastPort, mod.status().data.port);
    assert.deepStrictEqual(result.data?.targets, ['wechat.exe']);
    assert.strictEqual(result.data?.systemProxyActive, true);
  });

  it('configureLocalApps({enabled:false}) 还原系统代理', async () => {
    const {mod, proxy} = makeModule();
    await mod.configureLocalApps({enabled: true, port: 0});
    await mod.configureLocalApps({enabled: false});
    assert.strictEqual(proxy.state.enabled, false);
    assert.strictEqual(mod.getLocalAppsStatus().enabled, false);
  });

  it('只更新 targets 不动开关', async () => {
    const {mod} = makeModule();
    await mod.configureLocalApps({enabled: true, targets: ['a.exe'], port: 0});
    await mod.configureLocalApps({targets: ['b.exe', 'c.exe']});
    const s = mod.getLocalAppsStatus();
    assert.strictEqual(s.enabled, true);
    assert.deepStrictEqual(s.targets, ['b.exe', 'c.exe']);
  });

  it('stop() 时若 Local Apps 活跃先还原系统代理', async () => {
    const {mod, proxy} = makeModule();
    await mod.configureLocalApps({enabled: true, port: 0});
    await mod.stop();
    assert.strictEqual(proxy.state.enabled, false, 'stop 必须还原系统代理');
    assert.strictEqual(mod.getLocalAppsStatus().enabled, false);
  });

  it('systemProxyUnsupported 传播到状态', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-local-apps-'));
    const unsupported = {
      isActive: () => false,
      enable: async () => {
        throw new Error('systemProxyUnsupported');
      },
      restore: async () => undefined,
      restoreSync: () => undefined,
      checkResidual: async () => false,
    } as unknown as SystemProxyManager;
    const mod = new MitmModule(dir, undefined, unsupported);
    activeModules.push(mod);
    const result = await mod.configureLocalApps({enabled: true, port: 0});
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.data?.systemProxyUnsupported, true);
  });
});
