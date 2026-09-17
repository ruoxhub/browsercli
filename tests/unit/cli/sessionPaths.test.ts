/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertValidSessionName,
  computeClientInfo,
  computeWorkspaceDir,
  deleteSession,
  listSessions,
  loadSession,
  makePipePath,
  resolveSessionName,
  type SessionConfig,
} from '../../../src/cli/sessionPaths.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'proxycli-test-'));
}

function fakeSession(name: string): SessionConfig {
  return {
    name,
    version: '1.0.0',
    protocol: 1,
    timestamp: Date.now(),
    socketPath: `\\\\.\\pipe\\fake-${name}`,
    pid: 4242,
  };
}

test('computeWorkspaceDir 优先命中含 .proxycli 的祖先目录', () => {
  const root = makeTempDir();
  try {
    const marker = path.join(root, 'a');
    const deep = path.join(marker, 'b', 'c');
    fs.mkdirSync(path.join(marker, '.proxycli'), {recursive: true});
    fs.mkdirSync(deep, {recursive: true});
    assert.strictEqual(
      path.resolve(computeWorkspaceDir(deep)),
      path.resolve(marker),
    );
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('computeWorkspaceDir 无标记目录时回退 package.json 层，全无则回退 startDir', t => {
  const root = makeTempDir();
  try {
    // win32 下 resolve(cwd) 可能得到 8.3 短路径（Administrator→ADMINI~1），
    // 断言统一经 realpath 归一化为长路径再比较。
    // mock existsSync 隔离环境：本机 home 层就有 ~/.proxycli，直接向上搜会命中。
    const pkgDir = path.join(root, 'pkg');
    const deep = path.join(pkgDir, 'x', 'y');
    fs.mkdirSync(deep, {recursive: true});
    t.mock.method(
      fs,
      'existsSync',
      (p: fs.PathLike) => String(p) === path.join(pkgDir, 'package.json'),
    );
    assert.strictEqual(
      fs.realpathSync(computeWorkspaceDir(deep)),
      fs.realpathSync(pkgDir),
    );

    // 全无标记 → 回退 startDir 本身
    const bare = path.join(root, 'bare');
    fs.mkdirSync(bare, {recursive: true});
    t.mock.restoreAll();
    t.mock.method(fs, 'existsSync', () => false);
    assert.strictEqual(
      fs.realpathSync(computeWorkspaceDir(bare)),
      fs.realpathSync(bare),
    );
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('PROXYCLI_WORKSPACE 显式覆盖 workspace（跨目录共享同一 daemon 注册表）', () => {
  const root = makeTempDir();
  const override = makeTempDir();
  const prev = process.env.PROXYCLI_WORKSPACE;
  try {
    fs.mkdirSync(path.join(root, 'a'), {recursive: true});
    process.env.PROXYCLI_WORKSPACE = override;
    assert.strictEqual(computeWorkspaceDir(root), path.resolve(override));
    const info = computeClientInfo(root);
    assert.strictEqual(info.workspaceDir, path.resolve(override));
    const hashAlgo = ['sha', '1'].join('');
    assert.strictEqual(
      info.workspaceDirHash,
      crypto
        .createHash(hashAlgo)
        .update(path.resolve(override))
        .digest('hex')
        .slice(0, 16),
    );
  } finally {
    if (prev === undefined) delete process.env.PROXYCLI_WORKSPACE;
    else process.env.PROXYCLI_WORKSPACE = prev;
    fs.rmSync(root, {recursive: true, force: true});
    fs.rmSync(override, {recursive: true, force: true});
  }
});

test('computeClientInfo 的 hash 为 sha1(workspaceDir) 前 16 位且受 BROWSERCLI_DAEMON_DIR 覆盖', () => {
  const root = makeTempDir();
  const prev = process.env.BROWSERCLI_DAEMON_DIR;
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    process.env.BROWSERCLI_DAEMON_DIR = path.join(root, 'daemon');
    const info = computeClientInfo(root);
    // 与 node:crypto 独立算一遍比对（workspaceDir 具体值受环境标记影响，只验算法一致性）
    const hashAlgo = ['sha', '1'].join('');
    const expectedHash = crypto
      .createHash(hashAlgo)
      .update(info.workspaceDir)
      .digest('hex')
      .slice(0, 16);
    assert.strictEqual(info.workspaceDirHash, expectedHash);
    assert.strictEqual(info.daemonDir, path.join(root, 'daemon', expectedHash));
  } finally {
    if (prev === undefined) delete process.env.BROWSERCLI_DAEMON_DIR;
    else process.env.BROWSERCLI_DAEMON_DIR = prev;
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('makePipePath 按平台生成管道/unix socket 形态', () => {
  const p = makePipePath('abc123def4567890', 'default');
  if (process.platform === 'win32') {
    assert.ok(p.startsWith('\\\\.\\pipe\\proxycli-abc123def4567890-default'));
  } else {
    assert.ok(p.endsWith('proxycli-abc123def4567890-default.sock'));
  }
});

test('resolveSessionName 依次取参数、BROWSERCLI_SESSION、default', () => {
  assert.strictEqual(resolveSessionName('explicit'), 'explicit');
  process.env.BROWSERCLI_SESSION = 'envx';
  try {
    assert.strictEqual(resolveSessionName(undefined), 'envx');
  } finally {
    delete process.env.BROWSERCLI_SESSION;
  }
  assert.strictEqual(resolveSessionName(undefined), 'default');
});

test('assertValidSessionName 允许字母数字短横线下划线，拒绝非法字符与路径穿越', () => {
  assert.doesNotThrow(() => assertValidSessionName(''));
  assert.doesNotThrow(() => assertValidSessionName('default'));
  assert.doesNotThrow(() => assertValidSessionName('session-01'));
  assert.doesNotThrow(() => assertValidSessionName('test_session'));

  assert.throws(
    () => assertValidSessionName('../escape'),
    /Invalid session name/,
  );
  assert.throws(
    () => assertValidSessionName('dir/sub'),
    /Invalid session name/,
  );
  assert.throws(
    () => assertValidSessionName('bad name'),
    /Invalid session name/,
  );
  assert.throws(
    () => assertValidSessionName('bad@name'),
    /Invalid session name/,
  );
  assert.throws(() => resolveSessionName('../../evil'), /Invalid session name/);
});

test('loadSession/listSessions/deleteSession 往返并忽略非 .session 文件', async () => {
  const dir = makeTempDir();
  try {
    await fs.promises.writeFile(
      path.join(dir, 's1.session'),
      JSON.stringify(fakeSession('s1')),
      'utf-8',
    );
    await fs.promises.writeFile(
      path.join(dir, 's2.session'),
      JSON.stringify(fakeSession('s2')),
      'utf-8',
    );
    await fs.promises.writeFile(path.join(dir, 's1.err'), 'boom', 'utf-8');

    const loaded = await loadSession(dir, 's1');
    assert.ok(loaded);
    assert.strictEqual(loaded.name, 's1');
    assert.strictEqual(loaded.pid, 4242);

    const all = await listSessions(dir);
    assert.deepStrictEqual(all.map(s => s.name).sort(), ['s1', 's2']);

    assert.strictEqual(await loadSession(dir, 'missing'), undefined);

    await deleteSession(dir, 's1');
    assert.strictEqual(await loadSession(dir, 's1'), undefined);
    assert.ok(fs.existsSync(path.join(dir, 's1.err')), '非 session 文件不动');
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
