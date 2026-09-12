/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  SystemProxyManager,
  resolvePowerShellPath,
} from '../../../../src/modules/proxy/SystemProxyManager.js';

/**
 * 内存注册表 mock：键值存 Map，reg query/add/delete 直接操作它。
 * 命令序列断言靠 calls 记录。
 */
function makeManager(initial?: Record<string, string>) {
  const reg = new Map<string, string>(initial ? Object.entries(initial) : []);
  const calls: Array<{cmd: string; args: string[]}> = [];
  const readReg = (args: string[]): string => {
    // reg query "<path>" /v <name>
    const name = args[args.length - 1];
    const v = reg.get(name);
    if (v === undefined) return ''; // reg query 找不到键时输出为空（解析层容错）
    const type = name === 'ProxyEnable' ? 'REG_DWORD' : 'REG_SZ';
    return `\r\n    ${name}    ${type}    ${v}\r\n`;
  };

  const runSync = (cmd: string, args: string[]): string => {
    calls.push({cmd, args});
    if (cmd === 'reg' && args[0] === 'query') return readReg(args);
    if (cmd === 'reg' && args[0] === 'add') {
      // reg add "<path>" /v <name> /t <type> /d <data> /f
      const vIndex = args.indexOf('/v');
      const name = args[vIndex + 1];
      const dIndex = args.indexOf('/d');
      const data = dIndex !== -1 ? args[dIndex + 1] : '';
      reg.set(name, data ?? '');
      return '';
    }
    if (cmd === 'reg' && args[0] === 'delete') {
      const vIndex = args.indexOf('/v');
      const name = vIndex !== -1 ? args[vIndex + 1] : args[args.length - 1];
      reg.delete(name);
      return '';
    }
    if (cmd === 'powershell') return '';
    throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
  };
  const manager = new SystemProxyManager({
    platform: 'win32',
    runCommand: async (cmd, args) => runSync(cmd, args),
    runCommandSync: runSync,
  });
  return {manager, reg, calls};
}

const PROXY_ON = {
  ProxyEnable: '1',
  ProxyServer: 'proxy.corp:8080',
  ProxyOverride: 'corp.local',
  AutoConfigURL: 'http://pac.corp/wpad.dat',
};

describe('SystemProxyManager', () => {
  it('enable 备份四项原始值并写入接管配置', async () => {
    const {manager, reg} = makeManager(PROXY_ON);
    await manager.enable(8888);
    assert.strictEqual(reg.get('ProxyEnable'), '1');
    assert.strictEqual(reg.get('ProxyServer'), '127.0.0.1:8888');
    assert.strictEqual(
      reg.get('ProxyOverride'),
      'localhost;127.0.0.1;<-loopback>',
    );
    assert.strictEqual(reg.get('AutoConfigURL'), '');
    assert.ok(reg.get('ReverserProxyOwner'), 'marker 必须写入');
    assert.strictEqual(manager.isActive(), true);
  });

  it('restore 原子还原四项（含 PAC 与 Override）', async () => {
    const {manager, reg} = makeManager(PROXY_ON);
    await manager.enable(8888);
    await manager.restore();
    assert.strictEqual(reg.get('ProxyServer'), 'proxy.corp:8080');
    assert.strictEqual(reg.get('ProxyOverride'), 'corp.local');
    assert.strictEqual(reg.get('AutoConfigURL'), 'http://pac.corp/wpad.dat');
    assert.strictEqual(
      reg.get('ReverserProxyOwner'),
      undefined,
      '还原后删 marker',
    );
    assert.strictEqual(manager.isActive(), false);
  });

  it('restoreSync 用 spawnSync 完成同样还原（退出钩子路径）', async () => {
    const {manager, reg} = makeManager(PROXY_ON);
    await manager.enable(8888);
    manager.restoreSync();
    assert.strictEqual(reg.get('ProxyServer'), 'proxy.corp:8080');
    assert.strictEqual(reg.get('ReverserProxyOwner'), undefined);
  });

  it('checkResidual：marker 存在则按快照还原（不看端口），无 marker 绝不触碰', async () => {
    // 场景：上次非默认端口 9999 崩溃残留，本次启动端口 8888 也必须清理
    const snapshot = JSON.stringify({
      version: 1,
      originalState: {
        enabled: false,
        server: '',
        override: '',
        autoConfigUrl: '',
      },
    });
    const {manager, reg} = makeManager({
      ProxyEnable: '1',
      ProxyServer: '127.0.0.1:9999',
      ReverserProxyOwner: snapshot,
    });
    const cleaned = await manager.checkResidual();
    assert.strictEqual(cleaned, true);
    assert.strictEqual(reg.get('ProxyEnable'), '0');
    assert.strictEqual(reg.get('ProxyServer'), '');
    assert.strictEqual(reg.get('ReverserProxyOwner'), undefined);

    // 无 marker：用户自己的代理配置，绝不触碰
    const {manager: m2, reg: reg2} = makeManager({
      ProxyEnable: '1',
      ProxyServer: 'user-proxy:1080',
    });
    const cleaned2 = await m2.checkResidual();
    assert.strictEqual(cleaned2, false);
    assert.strictEqual(reg2.get('ProxyServer'), 'user-proxy:1080');
  });

  it('marker 存在且代理活跃时二次 enable 被拒', async () => {
    const snapshot = JSON.stringify({
      version: 1,
      originalState: {
        enabled: false,
        server: '',
        override: '',
        autoConfigUrl: '',
      },
    });
    const {manager, reg} = makeManager({
      ProxyEnable: '1',
      ProxyServer: '127.0.0.1:9999',
      ReverserProxyOwner: snapshot,
    });
    await assert.rejects(() => manager.enable(8888), /系统代理已被接管|active/);
    assert.strictEqual(
      reg.get('ProxyServer'),
      '127.0.0.1:9999',
      '被拒时不得改写',
    );
  });

  it('enable 后注册 exit/uncaughtException 钩子，且不注册 SIGINT/SIGTERM', async () => {
    const {manager} = makeManager(PROXY_ON);
    const before = {
      exit: process.listenerCount('exit'),
      sigint: process.listenerCount('SIGINT'),
      sigterm: process.listenerCount('SIGTERM'),
    };
    await manager.enable(8888);
    assert.strictEqual(process.listenerCount('exit'), before.exit + 1);
    assert.strictEqual(process.listenerCount('uncaughtException') > 0, true);
    assert.strictEqual(
      process.listenerCount('SIGINT'),
      before.sigint,
      '不得注册 SIGINT',
    );
    assert.strictEqual(
      process.listenerCount('SIGTERM'),
      before.sigterm,
      '不得注册 SIGTERM',
    );
    await manager.restore();
    assert.strictEqual(process.listenerCount('exit'), before.exit);
  });

  it('非 Windows 平台 enable 抛 systemProxyUnsupported', async () => {
    const manager = new SystemProxyManager({platform: 'linux'});
    await assert.rejects(() => manager.enable(8888), /unsupported/i);
  });

  it('resolvePowerShellPath 在 win32 下能返回合法路径或命令', () => {
    const ps = resolvePowerShellPath();
    assert.strictEqual(typeof ps, 'string');
    assert.ok(ps.length > 0);
  });
});
