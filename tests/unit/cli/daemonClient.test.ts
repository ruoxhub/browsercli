/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectDaemonPids,
  DaemonConnection,
  ensureDaemon,
  isDaemonRunning,
  isPidAlive,
  killPidForce,
  normalizeCandidatePath,
  resolveEntryPath,
  spawnDaemon,
  verifyDaemonVersion,
  waitForDaemonReady,
} from '../../../src/cli/daemonClient.js';
import {makePipePath} from '../../../src/cli/sessionPaths.js';

/** 起一个假 daemon：逐行解析请求，按 handler 回包。 */
async function startFakeDaemon(
  handler: (msg: Record<string, unknown>, conn: net.Socket) => void,
): Promise<{socketPath: string; close: () => Promise<void>}> {
  const socketPath = makePipePath(
    crypto.randomBytes(8).toString('hex'),
    `t-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    let buf = '';
    socket.on('data', chunk => {
      buf += chunk.toString();
      let idx = buf.indexOf('\n');
      while (idx !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line) handler(JSON.parse(line) as Record<string, unknown>, socket);
        idx = buf.indexOf('\n');
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });
  return {
    socketPath,
    close: () =>
      new Promise<void>(resolve => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

test('connect + request("hello") 解析 result', async () => {
  const fake = await startFakeDaemon((msg, socket) => {
    if (msg.method === 'hello')
      socket.write(`${JSON.stringify({id: msg.id, result: {protocol: 1}})}\n`);
  });
  const conn = await DaemonConnection.connect(fake.socketPath, 3000);
  const result = await conn.request<{protocol: number}>('hello');
  assert.deepStrictEqual(result, {protocol: 1});
  conn.close();
  await fake.close();
});

test('error 响应使 request 抛出含 code 的错误', async () => {
  const fake = await startFakeDaemon((msg, socket) => {
    socket.write(
      `${JSON.stringify({id: msg.id, error: {code: 'TOOL_NOT_FOUND', message: 'nope'}})}\n`,
    );
  });
  const conn = await DaemonConnection.connect(fake.socketPath, 3000);
  await assert.rejects(
    () => conn.request('tool.invoke', {tool: 'x'}),
    (err: unknown) =>
      err instanceof Error &&
      err.message.includes('TOOL_NOT_FOUND') &&
      err.message.includes('nope'),
  );
  conn.close();
  await fake.close();
});

test('server 不回包时 request 以超时错误 reject', async () => {
  const fake = await startFakeDaemon(() => {
    /* 故意不回包 */
  });
  const conn = await DaemonConnection.connect(fake.socketPath, 3000);
  await assert.rejects(
    () => conn.request('hello', undefined, 200),
    (err: unknown) => err instanceof Error && /超时|timeout/i.test(err.message),
  );
  conn.close();
  await fake.close();
});

test('onEvent 收到推送，off 后不再收', async () => {
  let push: (() => void) | undefined;
  const fake = await startFakeDaemon((msg, socket) => {
    push = () =>
      socket.write(
        `${JSON.stringify({type: 'event', channel: 'log', payload: {m: 1}, ts: 1})}\n`,
      );
    if (msg.method === 'hello')
      socket.write(`${JSON.stringify({id: msg.id, result: 'ok'})}\n`);
  });
  const conn = await DaemonConnection.connect(fake.socketPath, 3000);
  const events: Array<{channel?: string}> = [];
  const off = conn.onEvent(ev => events.push(ev));
  // 发一个请求使假 daemon 注册 push 回调
  await conn.request('hello');
  push!();
  await new Promise(r => setTimeout(r, 100));
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].channel, 'log');

  off();
  push!();
  await new Promise(r => setTimeout(r, 100));
  assert.strictEqual(events.length, 1);
  conn.close();
  await fake.close();
});

test('resolveEntryPath 优先取 PROXYCLI_ENTRY / BROWSERCLI_ENTRY，缺失时报错带恢复建议', () => {
  const prevProxyEntry = process.env.PROXYCLI_ENTRY;
  const prevBrowserEntry = process.env.BROWSERCLI_ENTRY;
  const prevProxyConfigDir = process.env.PROXYCLI_CONFIG_DIR;
  const prevBrowserConfigDir = process.env.BROWSERCLI_CONFIG_DIR;
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browsercli-cfg-'));
  try {
    delete process.env.PROXYCLI_ENTRY;
    delete process.env.BROWSERCLI_ENTRY;
    delete process.env.PROXYCLI_CONFIG_DIR;
    delete process.env.BROWSERCLI_CONFIG_DIR;

    const probe = path.join(configDir, 'entry.js');
    fs.writeFileSync(probe, '', 'utf-8');

    // 1. PROXYCLI_ENTRY
    process.env.PROXYCLI_ENTRY = probe;
    assert.strictEqual(resolveEntryPath(), probe);

    // 2. BROWSERCLI_ENTRY 后向兼容
    delete process.env.PROXYCLI_ENTRY;
    process.env.BROWSERCLI_ENTRY = probe;
    assert.strictEqual(resolveEntryPath(), probe);

    // 3. 均未配置时报错且带恢复建议
    delete process.env.BROWSERCLI_ENTRY;
    process.env.PROXYCLI_CONFIG_DIR = configDir;
    assert.throws(
      () => resolveEntryPath(),
      (err: unknown) => {
        const e = err as Error & {suggestions?: string[]};
        return (
          e.message.includes('workerEntry') &&
          (e.suggestions ?? []).some(s =>
            s.includes('browsercli config --set workerEntry='),
          )
        );
      },
    );

    // 4. 配置文件中的 workerEntry 生效
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({workerEntry: probe}),
      'utf-8',
    );
    assert.strictEqual(resolveEntryPath(), probe);
  } finally {
    if (prevProxyEntry === undefined) delete process.env.PROXYCLI_ENTRY;
    else process.env.PROXYCLI_ENTRY = prevProxyEntry;
    if (prevBrowserEntry === undefined) delete process.env.BROWSERCLI_ENTRY;
    else process.env.BROWSERCLI_ENTRY = prevBrowserEntry;
    if (prevProxyConfigDir === undefined)
      delete process.env.PROXYCLI_CONFIG_DIR;
    else process.env.PROXYCLI_CONFIG_DIR = prevProxyConfigDir;
    if (prevBrowserConfigDir === undefined)
      delete process.env.BROWSERCLI_CONFIG_DIR;
    else process.env.BROWSERCLI_CONFIG_DIR = prevBrowserConfigDir;
    fs.rmSync(configDir, {recursive: true, force: true});
  }
});

test('normalizeCandidatePath 跨平台路径转换', () => {
  assert.strictEqual(normalizeCandidatePath(undefined), undefined);
  assert.strictEqual(normalizeCandidatePath(''), undefined);

  // 临时文件实际存在
  const tmpFile = path.join(os.tmpdir(), `probe-${process.pid}.js`);
  fs.writeFileSync(tmpFile, '', 'utf-8');
  try {
    assert.strictEqual(normalizeCandidatePath(tmpFile), tmpFile);
    if (process.platform === 'linux' && tmpFile.startsWith('/mnt/')) {
      // 构造 Windows 路径形如 D:\... 或 D:/...
      const drive = tmpFile[5].toUpperCase();
      const winPath = `${drive}:${tmpFile.slice(6)}`;
      assert.strictEqual(normalizeCandidatePath(winPath), tmpFile);
    }
  } finally {
    fs.rmSync(tmpFile, {force: true});
  }
});

test('spawnDaemon 用假 entry 走通就绪握手并写出 session 文件', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'browsercli-ws-'));
  const daemonDir = path.join(workspace, 'daemon');
  const session = `sp-${process.pid}`;
  const socketPath = makePipePath('fixturespawn', session);
  // 假 entry：先写 session 文件，再打印就绪行，然后挂起（模拟 detached daemon）
  const entry = path.join(workspace, 'fake-entry.js');
  fs.writeFileSync(
    entry,
    [
      'const fs=require("node:fs");',
      `fs.writeFileSync(${JSON.stringify(path.join(daemonDir, `${session}.session`))}, JSON.stringify({name:${JSON.stringify(session)},version:"0.0.0",protocol:1,timestamp:Date.now(),socketPath:${JSON.stringify(socketPath)},pid:process.pid}), "utf-8");`,
      `console.log("Daemon listening on ${socketPath}");`,
      'setInterval(() => {}, 1000);',
    ].join('\n'),
    'utf-8',
  );
  const prevProxyEntry = process.env.PROXYCLI_ENTRY;
  const prevBrowserEntry = process.env.BROWSERCLI_ENTRY;
  try {
    delete process.env.BROWSERCLI_ENTRY;
    process.env.PROXYCLI_ENTRY = entry;
    const cfg = await spawnDaemon({
      session,
      spawnFlags: [],
      cwd: workspace,
      daemonDir,
    });
    assert.strictEqual(cfg.name, session);
    assert.strictEqual(cfg.socketPath, socketPath);
    assert.ok(fs.existsSync(path.join(daemonDir, `${session}.session`)));

    execFileSync(
      process.platform === 'win32' ? 'taskkill' : 'kill',
      process.platform === 'win32'
        ? ['/PID', String(cfg.pid), '/F']
        : [String(cfg.pid)],
      {stdio: 'ignore'},
    );
  } finally {
    if (prevProxyEntry === undefined) delete process.env.PROXYCLI_ENTRY;
    else process.env.PROXYCLI_ENTRY = prevProxyEntry;
    if (prevBrowserEntry === undefined) delete process.env.BROWSERCLI_ENTRY;
    else process.env.BROWSERCLI_ENTRY = prevBrowserEntry;
    if (process.platform !== 'win32')
      await fs.promises.unlink(socketPath).catch(() => undefined);
    fs.rmSync(workspace, {recursive: true, force: true});
  }
});

test('collectDaemonPids 命中含 --browsercli-daemon 或 --browsercli-daemon 的行（pid 为首列）', () => {
  assert.deepStrictEqual(
    collectDaemonPids([
      '111 node build/src/index.js --daemon --browsercli-daemon --session default',
      '222 node build/src/index.js --daemon',
      '333 grep --browsercli-daemon',
      '444 node other.js --browsercli-daemon',
    ]),
    [111, 444],
  );
});

test('isPidAlive 准确探测进程存活状态', () => {
  assert.strictEqual(isPidAlive(process.pid), true);
  assert.strictEqual(isPidAlive(99999999), false);
  assert.strictEqual(isPidAlive(0), false);
  assert.strictEqual(isPidAlive(-1), false);
});

test('killPidForce 对无效或不存在的 pid 幂等且不抛错', () => {
  assert.doesNotThrow(() => killPidForce(99999999));
  assert.doesNotThrow(() => killPidForce(0));
});

test('ensureDaemon 并发调用具备启动互斥锁，复用同一 session 不重复 spawn', async () => {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), 'browsercli-concur-ws-'),
  );
  const daemonDir = path.join(workspace, 'daemon');
  const session = `concur-${process.pid}`;
  const socketPath = makePipePath('concurtest', session);
  const countFile = path.join(workspace, 'spawn-count.txt');

  // 假 entry：每次拉起时 countFile 递增，监听 socket 并写 session
  const entry = path.join(workspace, 'fake-concurrent-entry.js');
  fs.writeFileSync(
    entry,
    [
      'const fs = require("node:fs");',
      'const net = require("node:net");',
      `const countFile = ${JSON.stringify(countFile)};`,
      'let count = 0;',
      'try { count = Number(fs.readFileSync(countFile, "utf-8")) || 0; } catch {}',
      'fs.writeFileSync(countFile, String(count + 1), "utf-8");',
      `const socketPath = ${JSON.stringify(socketPath)};`,
      'const server = net.createServer(socket => {',
      '  socket.on("data", d => {',
      '    try {',
      '      const msg = JSON.parse(d.toString().trim());',
      '      socket.write(JSON.stringify({id: msg.id, result: {ok: true}}) + "\\n");',
      '    } catch {}',
      '  });',
      '});',
      'server.listen(socketPath, () => {',
      `  fs.writeFileSync(${JSON.stringify(path.join(daemonDir, `${session}.session`))}, JSON.stringify({name:${JSON.stringify(session)},version:"0.0.0",protocol:1,timestamp:Date.now(),socketPath,pid:process.pid}), "utf-8");`,
      `  console.log("Daemon listening on " + socketPath);`,
      '});',
      'setInterval(() => {}, 1000);',
    ].join('\n'),
    'utf-8',
  );

  const prevProxyEntry = process.env.PROXYCLI_ENTRY;
  const prevBrowserEntry = process.env.BROWSERCLI_ENTRY;
  let pidToKill: number | undefined;
  try {
    delete process.env.BROWSERCLI_ENTRY;
    process.env.PROXYCLI_ENTRY = entry;

    // 并发触发 3 次 ensureDaemon
    const [cfg1, cfg2, cfg3] = await Promise.all([
      ensureDaemon({session, spawnFlags: [], cwd: workspace, daemonDir}),
      ensureDaemon({session, spawnFlags: [], cwd: workspace, daemonDir}),
      ensureDaemon({session, spawnFlags: [], cwd: workspace, daemonDir}),
    ]);

    assert.strictEqual(cfg1.name, session);
    assert.strictEqual(cfg2.name, session);
    assert.strictEqual(cfg3.name, session);
    assert.strictEqual(cfg1.pid, cfg2.pid);
    assert.strictEqual(cfg2.pid, cfg3.pid);
    pidToKill = cfg1.pid;

    // 关键断言：即使 3 个并发调用同时触发，fake entry 仅被真正 spawn 启动了 1 次！
    const finalCount = Number(fs.readFileSync(countFile, 'utf-8'));
    assert.strictEqual(finalCount, 1);
  } finally {
    if (pidToKill) killPidForce(pidToKill);
    if (prevProxyEntry === undefined) delete process.env.PROXYCLI_ENTRY;
    else process.env.PROXYCLI_ENTRY = prevProxyEntry;
    if (prevBrowserEntry === undefined) delete process.env.BROWSERCLI_ENTRY;
    else process.env.BROWSERCLI_ENTRY = prevBrowserEntry;
    if (process.platform !== 'win32')
      await fs.promises.unlink(socketPath).catch(() => undefined);
    fs.rmSync(workspace, {recursive: true, force: true});
  }
});

test('isDaemonRunning 与 verifyDaemonVersion 正确探活与核验版本', async () => {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), 'browsercli-verify-ws-'),
  );
  const daemonDir = path.join(workspace, 'daemon');
  fs.mkdirSync(daemonDir, {recursive: true});
  const session = `verify-${process.pid}`;

  // 1. 无 session 文件时返回 false
  assert.strictEqual(await isDaemonRunning(session, daemonDir), false);

  // 2. 起一个 fake daemon 监听 status
  const server = await startFakeDaemon((msg, socket) => {
    if (msg.method === 'status' || msg.method === 'hello') {
      socket.write(
        JSON.stringify({
          id: msg.id,
          result: {
            version: '2.0.0',
            protocol: 1,
            pid: process.pid,
            session,
            socketPath: server.socketPath,
            startDate: new Date().toISOString(),
            uptimeMs: 1234,
            args: ['--test'],
          },
        }) + '\n',
      );
    }
  });

  try {
    fs.writeFileSync(
      path.join(daemonDir, `${session}.session`),
      JSON.stringify({
        name: session,
        version: '2.0.0',
        protocol: 1,
        timestamp: Date.now(),
        socketPath: server.socketPath,
        pid: process.pid,
      }),
      'utf-8',
    );

    // 活跃状态下 isDaemonRunning 返回 true
    assert.strictEqual(await isDaemonRunning(session, daemonDir), true);

    // waitForDaemonReady 成功返回配置
    const readyCfg = await waitForDaemonReady(session, daemonDir, 3000);
    assert.strictEqual(readyCfg.name, session);

    // verifyDaemonVersion: 版本一致时返回 undefined
    const noWarn = await verifyDaemonVersion(session, '2.0.0', daemonDir);
    assert.strictEqual(noWarn, undefined);

    // verifyDaemonVersion: 版本不一致时返回 warning 文本
    const warn = await verifyDaemonVersion(session, '1.0.0', daemonDir);
    assert.ok(warn);
    assert.match(
      warn,
      /Warning: Daemon server version \(2\.0\.0\) does not match CLI version \(1\.0\.0\)/,
    );
  } finally {
    await server.close();
    fs.rmSync(workspace, {recursive: true, force: true});
  }
});
