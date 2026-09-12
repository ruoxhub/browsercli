/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {ProcessConnectionTracker} from '../../../../src/modules/proxy/ProcessConnectionTracker.js';

/** 中文 netstat 输出样本（本地化差异是真实风险，解析必须容错）。 */
const NETSTAT_SAMPLE = [
  '',
  '活动连接',
  '',
  '  协议  本地地址          外部地址        状态           PID',
  '  TCP    127.0.0.1:54321    203.0.113.7:443    ESTABLISHED     14220',
  '  TCP    192.168.1.5:54322  93.184.216.34:80   ESTABLISHED     8940',
  '  TCP    [::1]:54323        [::1]:8888         ESTABLISHED     14220',
  '',
].join('\r\n');

const TASKLIST_WECHAT =
  '"WeChat.exe","14220","Console","1","123,456 bytes"\r\n';
const TASKLIST_EDGE = '"msedge.exe","8940","Console","1","654,321 bytes"\r\n';

function makeTracker(
  outputs: string[],
  failures = 0,
): {
  tracker: ProcessConnectionTracker;
  calls: Array<{cmd: string; args: string[]}>;
} {
  const calls: Array<{cmd: string; args: string[]}> = [];
  let i = 0;
  let failed = 0;
  const tracker = new ProcessConnectionTracker(async (cmd, args) => {
    calls.push({cmd, args});
    if (failed < failures) {
      failed += 1;
      throw new Error('command unavailable');
    }
    // 如果是 tasklist，按 pid 匹配返回样本
    if (cmd === 'tasklist') {
      const fi = args.find(a => a.startsWith('PID eq'));
      if (fi?.includes('14220')) return TASKLIST_WECHAT;
      if (fi?.includes('8940')) return TASKLIST_EDGE;
      return '';
    }
    const out = outputs[Math.min(i, outputs.length - 1)];
    i += 1;
    return out;
  });
  return {tracker, calls};
}

describe('ProcessConnectionTracker', () => {
  it('refresh 解析 netstat 输出并按本地端口建索引（含进程名补全）', async () => {
    const {tracker} = makeTracker([NETSTAT_SAMPLE]);
    await tracker.refresh();
    assert.deepStrictEqual(tracker.getProcessByPortSync(54321), {
      pid: 14220,
      name: 'WeChat.exe',
      path: undefined,
    });
    assert.strictEqual(tracker.getProcessByPortSync(54322)?.pid, 8940);
    assert.strictEqual(tracker.getProcessByPortSync(54322)?.name, 'msedge.exe');
  });

  it('IPv6 [::1]:port 也能索引', async () => {
    const {tracker} = makeTracker([NETSTAT_SAMPLE]);
    await tracker.refresh();
    assert.strictEqual(tracker.getProcessByPortSync(54323)?.pid, 14220);
  });

  it('未刷新或端口不存在返回 null（纯内存，不触发命令）', async () => {
    const {tracker, calls} = makeTracker([NETSTAT_SAMPLE]);
    assert.strictEqual(tracker.getProcessByPortSync(9999), null);
    assert.strictEqual(calls.length, 0);
  });

  it('条目超过 1500ms 视为过期返回 null', async () => {
    const {tracker} = makeTracker([NETSTAT_SAMPLE]);
    await tracker.refresh();
    // 把 lastRefresh 时间戳改老
    (
      tracker as unknown as {
        portEntries: Map<number, {pid: number; at: number}>;
      }
    ).portEntries.set(54321, {pid: 14220, at: Date.now() - 2000});
    assert.strictEqual(tracker.getProcessByPortSync(54321), null);
  });

  it('refresh 失败保留上次快照，连续 10 次后 isDegraded', async () => {
    let fail = false;
    const tracker = new ProcessConnectionTracker(async (cmd, _args) => {
      if (fail) throw new Error('command unavailable');
      if (cmd === 'tasklist') return TASKLIST_WECHAT;
      return NETSTAT_SAMPLE;
    });
    await tracker.refresh(); // 成功一次
    assert.strictEqual(tracker.isDegraded(), false);
    fail = true;
    for (let i = 0; i < 9; i++) await tracker.refresh();
    assert.strictEqual(tracker.isDegraded(), false);
    await tracker.refresh(); // 第 10 次失败
    assert.strictEqual(tracker.isDegraded(), true);
    // 快照仍在（失败不清缓存）
    assert.strictEqual(tracker.getProcessByPortSync(54321)?.pid, 14220);
  });

  it('listActiveNetworkProcesses 去重并排除 selfPid', async () => {
    const {tracker} = makeTracker([NETSTAT_SAMPLE]);
    const list = await tracker.listActiveNetworkProcesses(8940);
    const pids = list.map(p => p.pid);
    assert.ok(pids.includes(14220));
    assert.ok(!pids.includes(8940), '应排除代理自身 pid');
    assert.strictEqual(pids.filter(p => p === 14220).length, 1, 'pid 去重');
  });

  it('getProcessByPort 未在同步缓存中时主动触发 refresh 溯源', async () => {
    const {tracker, calls} = makeTracker([NETSTAT_SAMPLE]);
    // 初始状态未刷新，端口 54321 尚未在内存
    assert.strictEqual(tracker.getProcessByPortSync(54321), null);
    assert.strictEqual(calls.length, 0);

    const meta = await tracker.getProcessByPort(54321);
    assert.deepStrictEqual(meta, {
      pid: 14220,
      name: 'WeChat.exe',
      path: undefined,
    });
    assert.ok(calls.length > 0, '未命中时必须主动触发命令刷新');
  });

  it('refresh 并发调用时自动合并（单飞 promise coalescing）', async () => {
    let netstatCount = 0;
    const tracker = new ProcessConnectionTracker(async cmd => {
      if (cmd === 'netstat') {
        netstatCount += 1;
        await new Promise(r => setTimeout(r, 10));
        return NETSTAT_SAMPLE;
      }
      return TASKLIST_WECHAT;
    });

    await Promise.all([
      tracker.refresh(),
      tracker.refresh(),
      tracker.refresh(),
    ]);
    assert.strictEqual(netstatCount, 1, '多次并发调用应合并为 1 次底层执行');
  });
});
