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
  computeClientInfo,
  computeWorkspaceDir,
  deleteSession,
  listSessions,
  loadSession,
  makePipePath,
  resolveSessionName,
  type SessionConfig,
} from '../../src/sessionPaths.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'browsercli-test-'));
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

test('computeWorkspaceDir 优先命中含 .browsercli 的祖先目录', () => {
  const root = makeTempDir();
  try {
    const marker = path.join(root, 'a');
    const deep = path.join(marker, 'b', 'c');
    fs.mkdirSync(path.join(marker, '.browsercli'), {recursive: true});
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
    // mock existsSync 隔离环境：本机 home 层就有 ~/.browsercli，直接向上搜会命中。
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

test('computeClientInfo 的 hash 为 sha1(workspaceDir) 前 16 位且受 BROWSERCLI_DAEMON_DIR 覆盖', () => {
  const root = makeTempDir();
  const prev = process.env.BROWSERCLI_DAEMON_DIR;
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    process.env.BROWSERCLI_DAEMON_DIR = path.join(root, 'daemon');
    const info = computeClientInfo(root);
    // 与 node:crypto 独立算一遍比对（workspaceDir 具体值受环境标记影响，只验算法一致性）
    const expectedHash = crypto
      .createHash('sha1')
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
    assert.ok(p.startsWith('\\\\.\\pipe\\browsercli-abc123def4567890-default'));
  } else {
    assert.ok(p.endsWith('browsercli-abc123def4567890-default.sock'));
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
