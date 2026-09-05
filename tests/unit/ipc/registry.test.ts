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
import {describe, it} from 'node:test';

import {
  computeClientInfo,
  computeWorkspaceDir,
  deleteSessionFile,
  listSessionFiles,
  loadSessionFile,
  makePipePath,
  resolveSessionName,
  saveSessionFile,
  type SessionConfig,
} from '../../../src/ipc/registry.js';

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcli-registry-'));
  return fs.realpathSync(dir);
}

/**
 * 造 root/x1/.../xn 深链并返回最深目录。深链保证 computeWorkspaceDir 的
 * 10 级上溯不会逃出 temp 区碰到主机上真实的 package.json / .browsercli。
 */
function deepChain(root: string, depth: number): string {
  let dir = root;
  for (let i = 0; i < depth; i++) {
    dir = path.join(dir, `x${i}`);
  }
  fs.mkdirSync(dir, {recursive: true});
  return dir;
}

function testConfig(name: string): SessionConfig {
  return {
    name,
    version: '1.0.0',
    protocol: 1,
    timestamp: Date.now(),
    socketPath: makePipePath('deadbeefdeadbeef', name),
    pid: process.pid,
  };
}

describe('computeWorkspaceDir', () => {
  it('finds the ancestor containing .browsercli', () => {
    const root = tempDir();
    const marker = path.join(root, 'a');
    const deep = path.join(marker, 'b', 'c');
    fs.mkdirSync(path.join(marker, '.browsercli'), {recursive: true});
    fs.mkdirSync(deep, {recursive: true});
    assert.equal(computeWorkspaceDir(deep), marker);
  });

  it('falls back to the package.json ancestor', () => {
    const root = tempDir();
    const pkg = path.join(root, 'pkg');
    fs.mkdirSync(pkg, {recursive: true});
    fs.writeFileSync(path.join(pkg, 'package.json'), '{}');
    // 深链 6 级：距 pkg 在 10 级上溯窗口内，同时 root 距系统盘根 >10 级，
    // 不会向上逃逸碰到主机目录
    const deep = deepChain(pkg, 6);
    assert.equal(computeWorkspaceDir(deep), pkg);
  });

  it('returns the start dir when nothing is found', () => {
    const root = tempDir();
    const deep = deepChain(root, 12);
    assert.equal(computeWorkspaceDir(deep), deep);
  });
});

describe('computeClientInfo', () => {
  it('hashes the workspace dir with sha1 (16 hex chars)', () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    // 深链 6 级：root 在上溯 10 级窗口内
    const deep = deepChain(root, 6);
    const info = computeClientInfo(deep);
    const expected = crypto
      .createHash('sha1')
      .update(root)
      .digest('hex')
      .slice(0, 16);
    assert.equal(info.workspaceDir, root);
    assert.equal(info.workspaceDirHash, expected);
    assert.ok(info.daemonDir.endsWith(expected));
  });

  it('honors BROWSERCLI_DAEMON_DIR', () => {
    const root = tempDir();
    const override = tempDir();
    const prev = process.env.BROWSERCLI_DAEMON_DIR;
    process.env.BROWSERCLI_DAEMON_DIR = override;
    try {
      const info = computeClientInfo(root);
      assert.ok(info.daemonDir.startsWith(override));
    } finally {
      if (prev === undefined) delete process.env.BROWSERCLI_DAEMON_DIR;
      else process.env.BROWSERCLI_DAEMON_DIR = prev;
    }
  });
});

describe('makePipePath', () => {
  it('uses the windows pipe form on win32, a .sock file elsewhere', () => {
    const p = makePipePath('abc123', 'default');
    if (process.platform === 'win32') {
      assert.equal(p, '\\\\.\\pipe\\proxycli-abc123-default');
    } else {
      assert.ok(p.endsWith('proxycli-abc123-default.sock'));
      assert.ok(p.startsWith(os.tmpdir()));
    }
  });
});

describe('resolveSessionName', () => {
  it('prefers explicit name, then BROWSERCLI_SESSION, then default', () => {
    const prev = process.env.BROWSERCLI_SESSION;
    try {
      process.env.BROWSERCLI_SESSION = 'envx';
      assert.equal(resolveSessionName(undefined), 'envx');
      assert.equal(resolveSessionName('given'), 'given');
      delete process.env.BROWSERCLI_SESSION;
      assert.equal(resolveSessionName(undefined), 'default');
    } finally {
      if (prev !== undefined) process.env.BROWSERCLI_SESSION = prev;
    }
  });
});

describe('session file round-trip', () => {
  it('save/load/delete with list filtering non-.session files', async () => {
    const root = tempDir();
    const daemonDir = tempDir();
    const prev = process.env.BROWSERCLI_DAEMON_DIR;
    process.env.BROWSERCLI_DAEMON_DIR = daemonDir;
    try {
      const info = computeClientInfo(root);
      const config = testConfig('s1');
      const saved = await saveSessionFile(info, config);
      assert.ok(saved.file.endsWith('s1.session'));

      const loaded = await loadSessionFile(info, 's1');
      assert.deepEqual(loaded?.config, config);

      assert.equal(await loadSessionFile(info, 'missing'), undefined);

      fs.writeFileSync(path.join(info.daemonDir, '1.err'), 'noise');
      const list = await listSessionFiles(info);
      assert.equal(list.length, 1);
      assert.equal(list[0].config.name, 's1');

      await deleteSessionFile(saved);
      assert.equal(await loadSessionFile(info, 's1'), undefined);
    } finally {
      if (prev === undefined) delete process.env.BROWSERCLI_DAEMON_DIR;
      else process.env.BROWSERCLI_DAEMON_DIR = prev;
    }
  });
});
