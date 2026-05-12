/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  WorkerGuardian,
  DEFAULT_RESTART_POLICY,
} from '../../../src/cli/worker-guardian.js';

describe('WorkerGuardian', () => {
  it('初始健康状态为 healthy', () => {
    const g = new WorkerGuardian();
    assert.strictEqual(g.getHealth(), 'healthy');
    assert.strictEqual(g.getUptimeSeconds(), 0);
  });

  it('markStarted 后 uptime >= 0', () => {
    const g = new WorkerGuardian();
    g.markStarted();
    assert.ok(g.getUptimeSeconds() >= 0);
  });

  it('正常退出(code=0, no signal)不应重启', () => {
    const g = new WorkerGuardian();
    assert.strictEqual(g.shouldRestart(0, null), false);
  });

  it('异常退出(code=1)应重启', () => {
    const g = new WorkerGuardian();
    assert.strictEqual(g.shouldRestart(1, null), true);
  });

  it('被信号杀死应重启', () => {
    const g = new WorkerGuardian();
    assert.strictEqual(g.shouldRestart(null, 'SIGKILL'), true);
  });

  it('超过 maxRestarts 后不应重启', () => {
    const g = new WorkerGuardian({maxRestarts: 2, restartWindowMs: 60_000});
    assert.strictEqual(g.shouldRestart(1, null), true);
    assert.strictEqual(g.shouldRestart(1, null), true);
    // 第 3 次超限
    assert.strictEqual(g.shouldRestart(1, null), false);
  });

  it('重启次数超出窗口后应重置计数', async () => {
    const g = new WorkerGuardian({
      maxRestarts: 2,
      restartDelayMs: 10,
      restartWindowMs: 50,
    });
    assert.strictEqual(g.shouldRestart(1, null), true);
    assert.strictEqual(g.shouldRestart(1, null), true);
    // 第 3 次被拒绝
    assert.strictEqual(g.shouldRestart(1, null), false);

    // 等待窗口过期
    await new Promise(r => setTimeout(r, 60));

    // 可以再次重启
    assert.strictEqual(g.shouldRestart(1, null), true);
  });

  it('返回默认重启策略', () => {
    const g = new WorkerGuardian();
    const snap = g.getSnapshot();
    assert.deepStrictEqual(snap.policy, DEFAULT_RESTART_POLICY);
    assert.strictEqual(snap.totalRestarts, 0);
    assert.strictEqual(snap.restartCount, 0);
  });

  it('自定义策略生效', () => {
    const g = new WorkerGuardian({
      maxRestarts: 3,
      restartDelayMs: 5000,
      restartWindowMs: 120_000,
    });
    const snap = g.getSnapshot();
    assert.strictEqual(snap.policy.maxRestarts, 3);
    assert.strictEqual(snap.policy.restartDelayMs, 5000);
    assert.strictEqual(snap.policy.restartWindowMs, 120_000);
  });

  it('一次重启后健康状态变为 degraded', () => {
    const g = new WorkerGuardian({maxRestarts: 4});
    g.shouldRestart(1, null);
    assert.strictEqual(g.getHealth(), 'degraded');
  });

  it('snapshot 包含正确的 restartCount', () => {
    const g = new WorkerGuardian({maxRestarts: 5});
    g.shouldRestart(1, null);
    g.shouldRestart(1, null);
    const snap = g.getSnapshot();
    assert.strictEqual(snap.restartCount, 2);
    assert.strictEqual(snap.totalRestarts, 2);
  });

  it('getRestartDelay 返回配置的延迟', () => {
    const g = new WorkerGuardian({restartDelayMs: 3000});
    assert.strictEqual(g.getRestartDelay(), 3000);
  });
});
