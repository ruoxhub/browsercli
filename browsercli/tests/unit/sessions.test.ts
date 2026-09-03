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
import {after, before, describe, it} from 'node:test';
import {AxiError} from 'axi-sdk-js';

import {
  closeCommand,
  listSessionsCommand,
  openCommand,
} from '../../src/commands/sessions.js';
import {
  loadSession,
  makePipePath,
  type SessionConfig,
} from '../../src/sessionPaths.js';
import type {AxiStructuredOutput} from '../../src/output.js';
import type {WorkerContext} from '../../src/types.js';

function killPid(pid: number): void {
  try {
    execFileSync(
      process.platform === 'win32' ? 'taskkill' : 'kill',
      process.platform === 'win32'
        ? ['/PID', String(pid), '/F']
        : [String(pid)],
      {stdio: 'ignore'},
    );
  } catch {
    // 已退出
  }
}

/** 会响应 hello 的最小活体 fake daemon（真实 net 监听）。 */
async function startLiveDaemon(): Promise<{
  server: net.Server;
  socketPath: string;
}> {
  const socketPath = makePipePath(
    crypto.randomBytes(8).toString('hex'),
    `sess-live-${process.pid}`,
  );
  const server = net.createServer(socket => {
    let buf = '';
    socket.on('data', chunk => {
      buf += chunk.toString();
      let idx = buf.indexOf('\n');
      while (idx !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line) {
          const msg = JSON.parse(line) as {id: number; method: string};
          socket.write(
            `${JSON.stringify({id: msg.id, result: {protocol: 1, method: msg.method}})}\n`,
          );
        }
        idx = buf.indexOf('\n');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  return {server, socketPath};
}

describe('open 真实 spawn（假 entry + 注入 daemonDir）', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'browsercli-sess-'));
  const daemonDir = path.join(workspace, 'daemon');
  const session = `sess-${process.pid}`;

  before(() => {
    // 假 daemon entry（CJS，位于 repo 外，不受 type:module 影响）：
    // 写 session 文件 → 打印就绪行 → 挂起
    const socketPath = makePipePath('fixturespawn000000', session);
    const entry = path.join(workspace, 'fake-entry.js');
    fs.writeFileSync(
      entry,
      [
        'const fs=require("node:fs");',
        `fs.writeFileSync(${JSON.stringify(path.join(daemonDir, `${session}.session`))}, JSON.stringify({name:${JSON.stringify(session)},version:"0.0.0",protocol:1,timestamp:Date.now(),socketPath:${JSON.stringify(socketPath)},pid:process.pid,workspaceDir:${JSON.stringify(workspace)}}), "utf-8");`,
        `console.log("Daemon listening on ${socketPath}");`,
        'setInterval(() => {}, 1000);',
      ].join('\n'),
      'utf-8',
    );
    process.env.BROWSERCLI_ENTRY = entry;
  });

  after(() => {
    delete process.env.BROWSERCLI_ENTRY;
    const file = path.join(daemonDir, `${session}.session`);
    if (fs.existsSync(file)) {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf-8')) as SessionConfig;
      killPid(cfg.pid);
    }
    fs.rmSync(workspace, {recursive: true, force: true});
  });

  it('open 走真实 spawn 拉起 daemon 并回显会话信息', async () => {
    const ctx: WorkerContext = {
      session,
      daemonDir,
      connect: async () => {
        throw new Error('不应被调用');
      },
    };
    const output = (await openCommand([], ctx)) as AxiStructuredOutput;
    assert.strictEqual(output.command, 'open');
    assert.strictEqual(output.session, session);
    assert.ok(typeof output.pid === 'number' && (output.pid as number) > 0);
    const cfg = await loadSession(daemonDir, session);
    assert.ok(cfg);
    assert.strictEqual(cfg?.protocol, 1);
  });
});

describe('open/close/list 注册表分支', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browsercli-sess2-'));
  let live: {server: net.Server; socketPath: string};

  before(async () => {
    live = await startLiveDaemon();
  });

  after(async () => {
    live.server.close();
    if (process.platform !== 'win32')
      await fs.promises.unlink(live.socketPath).catch(() => undefined);
    fs.rmSync(baseDir, {recursive: true, force: true});
  });

  function writeSession(dir: string, cfg: SessionConfig): void {
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(
      path.join(dir, `${cfg.name}.session`),
      JSON.stringify(cfg),
      'utf-8',
    );
  }

  it('open 遇到活会话报 SESSION_ALREADY_OPEN 并给出 close 建议', async () => {
    const dir = path.join(baseDir, 'opened');
    writeSession(dir, {
      name: 'busy',
      version: '0.0.0',
      protocol: 1,
      timestamp: Date.now(),
      socketPath: live.socketPath,
      pid: process.pid,
    });
    const ctx: WorkerContext = {
      session: 'busy',
      daemonDir: dir,
      connect: async () => {
        throw new Error('不应被调用');
      },
    };
    await assert.rejects(
      async () => openCommand([], ctx),
      (err: unknown) =>
        err instanceof AxiError &&
        err.code === 'SESSION_ALREADY_OPEN' &&
        (err.suggestions ?? []).some(s => s.includes('close')),
    );
  });

  it('close 无注册会话时返回 stopped:false', async () => {
    const dir = path.join(baseDir, 'empty');
    fs.mkdirSync(dir, {recursive: true});
    const ctx: WorkerContext = {
      session: 'ghost',
      daemonDir: dir,
      connect: async () => {
        throw new Error('不应被调用');
      },
    };
    const output = (await closeCommand([], ctx)) as AxiStructuredOutput;
    assert.strictEqual(output.command, 'close');
    assert.strictEqual(output.stopped, false);
    assert.ok((output.message as string).includes('未运行'));
  });

  it('close 对死 pid 会话走兜底并 GC session 文件', async () => {
    const dir = path.join(baseDir, 'deadpid');
    writeSession(dir, {
      name: 'deadpid',
      version: '0.0.0',
      protocol: 1,
      timestamp: Date.now(),
      socketPath: makePipePath(
        crypto.randomBytes(8).toString('hex'),
        `sess-dead-${process.pid}`,
      ),
      // 几乎不可能存在的 pid：stopSession 的 process.kill(pid,0) 立即失败 → GC
      pid: 999_999,
    });
    const ctx: WorkerContext = {
      session: 'deadpid',
      daemonDir: dir,
      connect: async () => {
        throw new Error('不应被调用');
      },
    };
    const output = (await closeCommand([], ctx)) as AxiStructuredOutput;
    assert.strictEqual(output.stopped, true);
    assert.strictEqual(await loadSession(dir, 'deadpid'), undefined);
  });

  it('list 探活失败标记 closed-stale 并输出表格', async () => {
    const dir = path.join(baseDir, 'listing');
    writeSession(dir, {
      name: 'dead',
      version: '0.0.0',
      protocol: 1,
      timestamp: Date.now(),
      socketPath: makePipePath(
        crypto.randomBytes(8).toString('hex'),
        `sess-list-${process.pid}`,
      ),
      pid: 999_999,
    });
    writeSession(dir, {
      name: 'up',
      version: '0.0.0',
      protocol: 1,
      timestamp: Date.now(),
      socketPath: live.socketPath,
      pid: process.pid,
      consolePort: 9321,
    });
    const ctx: WorkerContext = {
      session: 'up',
      daemonDir: dir,
      connect: async () => {
        throw new Error('不应被调用');
      },
    };
    const output = (await listSessionsCommand([], ctx)) as AxiStructuredOutput;
    assert.strictEqual(output.command, 'list');
    assert.deepEqual(output.headers, ['Session', 'PID', 'Console', 'Status']);
    const rows = output.sessions as Array<{session: string; status: string}>;
    assert.strictEqual(rows.find(r => r.session === 'up')?.status, 'open');
    assert.strictEqual(
      rows.find(r => r.session === 'dead')?.status,
      'closed-stale',
    );
    const consoleRow = (output.rows as string[][]).find(r => r[0] === 'up');
    assert.strictEqual(consoleRow?.[2], '127.0.0.1:9321');
  });
});
