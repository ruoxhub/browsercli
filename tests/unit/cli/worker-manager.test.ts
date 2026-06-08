/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WorkerManager 状态自愈单元测试
 *
 * 覆盖场景：
 * - PID 文件存在但进程已死 → isRunning 返回 false，并清理 PID 文件
 * - stop 时检测到 PID 残留但进程已死 → 抛"未运行"且清理
 * - start 入口会先清理残留 PID 文件再启动
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {RUNTIME_DIR_NAME} from '../../../src/config.js';

// 把 WorkerManager 加载进来，但要在加载前注入一个假的 RUNTIME_DIR / PID_FILE。
// 这里采取另一条路：直接 import WorkerManager，通过子进程方式控制。
// 为简化，我们直接 import 并覆盖 getPid/isPidAliveWindows 行为：使用极慢的不可达 PID。

import {WorkerManager} from '../../../src/cli/worker-manager.js';

const RUNTIME_DIR = path.join(os.tmpdir(), RUNTIME_DIR_NAME);
const PID_FILE = path.join(RUNTIME_DIR, 'worker.pid');

function writePidFile(pid: number): void {
  fs.mkdirSync(RUNTIME_DIR, {recursive: true});
  fs.writeFileSync(PID_FILE, String(pid), 'utf-8');
}

function readPidFile(): number | null {
  try {
    const v = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function pidFileExists(): boolean {
  try {
    fs.statSync(PID_FILE);
    return true;
  } catch {
    return false;
  }
}

describe('WorkerManager 状态自愈', () => {
  beforeEach(() => {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      // ignore
    }
  });

  it('残留 PID 文件但进程已死 → isRunning 返回 false 并清理 PID 文件', () => {
    // 1. 模拟上次崩溃留下的 PID 文件，PID 选用一个几乎不可能存活的极大数
    const deadPid = 999_999_999;
    writePidFile(deadPid);
    assert.strictEqual(pidFileExists(), true);

    const mgr = new WorkerManager();
    const running = mgr.isRunning();

    assert.strictEqual(running, false, '死进程应判定为未运行');
    assert.strictEqual(pidFileExists(), false, '自愈后 PID 文件应被清理');
  });

  it('getPid 在 PID 文件存在时返回数字', () => {
    writePidFile(12345);
    const mgr = new WorkerManager();
    assert.strictEqual(mgr.getPid(), 12345);
  });

  it('getPid 在 PID 文件缺失时返回 null', () => {
    const mgr = new WorkerManager();
    assert.strictEqual(mgr.getPid(), null);
  });

  it('stop 在 PID 残留但进程已死时自愈并抛"未运行"', async () => {
    // 留一个僵尸 PID
    writePidFile(999_999_998);
    const mgr = new WorkerManager();

    await assert.rejects(
      () => mgr.stop(),
      (err: unknown) => err instanceof Error && /未运行/.test(err.message),
    );

    // 自愈后 PID 文件应被清理
    assert.strictEqual(pidFileExists(), false);
  });

  it('stop 在无任何 PID 记录时直接抛"未运行"', async () => {
    const mgr = new WorkerManager();
    await assert.rejects(
      () => mgr.stop(),
      (err: unknown) => err instanceof Error && /未运行/.test(err.message),
    );
  });

  it('start 入口在残留 PID 时会先清理 PID 文件（前提 isRunning 已为 false）', async () => {
    // 模拟一个 isRunning 主动返回 false 的场景（自愈后状态），
    // start 仍应走"清理残留 → spawn"的路径：
    // 由于 spawn 需要 child_process，这里我们仅验证"残留 PID 被清掉"。
    writePidFile(999_999_997);

    const mgr = new WorkerManager();
    // 强制让 isRunning 返回 false（绕过 Windows tasklist 偶发命中）
    // 我们的自愈逻辑写在 start() 内：isRunning 为 false 时直接 removePidFile()
    // 但 start 还会真正 spawn —— 这会失败，因为缺少 RPC。我们用 catch 吞掉。
    try {
      await mgr.start({
        rpcHost: 'ws://127.0.0.1:1',
        group: 'self-heal-test',
      });
    } catch {
      // expected — spawn 失败 / ready 超时均可
    }

    // 关键断言：start 失败后应清理 PID 文件（不能留作下次启动的负担）
    assert.strictEqual(pidFileExists(), false, 'start 失败后 PID 文件应被清理');
  });
});
