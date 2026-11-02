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

import {cliCommands} from '../../../src/cli/app.js';
import {startCommand} from '../../../src/cli/commands/start.js';
import {statusCommand} from '../../../src/cli/commands/status.js';
import {stopCommand} from '../../../src/cli/commands/stop.js';
import type {AxiStructuredOutput} from '../../../src/cli/output.js';
import {
  loadSession,
  makePipePath,
  type SessionConfig,
} from '../../../src/cli/sessionPaths.js';
import type {WorkerContext} from '../../../src/cli/types.js';

function killPid(pid: number): void {
  try {
    execFileSync(
      process.platform === 'win32' ? 'taskkill' : 'kill',
      process.platform === 'win32'
        ? ['/PID', String(pid), '/F']
        : [String(pid)],
      {stdio: 'ignore'},
    );
  } catch (err) {
    void err;
  }
}

/** 会响应 status, hello, browser.status, browser.connect, stop 的 fake daemon */
async function startLiveDaemon(options?: {
  browserConnected?: boolean;
}): Promise<{
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
          const msg = JSON.parse(line) as {
            id: number;
            method: string;
            params?: unknown;
          };
          let result: unknown = {protocol: 1, method: msg.method};
          if (msg.method === 'status' || msg.method === 'hello') {
            result = {
              protocol: 1,
              version: '1.0.0',
              pid: 999_999,
              uptimeMs: 1234,
              startDate: new Date().toISOString(),
            };
          } else if (msg.method === 'browser.status') {
            result = {
              connected: options?.browserConnected ?? false,
              mode: options?.browserConnected ? 'launch' : 'disconnected',
              pages: options?.browserConnected ? 1 : 0,
            };
          } else if (msg.method === 'browser.connect') {
            result = {
              connected: true,
              mode: 'launch',
              pages: 1,
            };
          } else if (msg.method === 'stop') {
            result = {stopped: true};
          }
          socket.write(`${JSON.stringify({id: msg.id, result})}\n`);
        }
        idx = buf.indexOf('\n');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  return {server, socketPath};
}

describe('startCommand / stopCommand / statusCommand 生命周期测试（带 Live Socket）', () => {
  const baseDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'bcli-live-lifecycle-'),
  );
  let live: {server: net.Server; socketPath: string};
  const session = `sess-live-${process.pid}`;

  before(async () => {
    live = await startLiveDaemon({browserConnected: true});
    fs.mkdirSync(baseDir, {recursive: true});
    fs.writeFileSync(
      path.join(baseDir, `${session}.session`),
      JSON.stringify({
        name: session,
        version: '1.0.0',
        protocol: 1,
        timestamp: Date.now(),
        socketPath: live.socketPath,
        pid: 999_999,
      } satisfies SessionConfig),
      'utf-8',
    );
  });

  after(async () => {
    live.server.close();
    if (process.platform !== 'win32')
      await fs.promises.unlink(live.socketPath).catch(() => undefined);
    fs.rmSync(baseDir, {recursive: true, force: true});
  });

  it('status 检查运行中会话，包含进程状态与浏览器状态', async () => {
    const ctx: WorkerContext = {
      session,
      daemonDir: baseDir,
      connect: async () => {
        throw new Error('不应被调用');
      },
    };
    const output = (await statusCommand(
      ['--json'],
      ctx,
    )) as AxiStructuredOutput;
    assert.strictEqual(output.command, 'status');
    assert.strictEqual(output.session, session);
    assert.strictEqual(output.online, true);
    assert.ok(Array.isArray(output.sessions));
    assert.strictEqual(output.sessions.length, 1);
    assert.strictEqual(output.sessions[0].status, 'open');
    assert.ok(output.browser);
    assert.strictEqual(
      (output.browser as {connected: boolean}).connected,
      true,
    );
  });

  it('stop 停止当前会话并通过 socket 触发 graceful stop', async () => {
    const ctx: WorkerContext = {
      session,
      daemonDir: baseDir,
      connect: async () => {
        throw new Error('不应被调用');
      },
    };
    const output = (await stopCommand([], ctx)) as AxiStructuredOutput;
    assert.strictEqual(output.command, 'stop');
    assert.strictEqual(output.session, session);
    assert.strictEqual(output.stopped, true);
  });

  it('stop 未运行的会话返回 stopped:false', async () => {
    const ctx: WorkerContext = {
      session: 'non-existent',
      daemonDir: baseDir,
      connect: async () => {
        throw new Error('不应被调用');
      },
    };
    const output = (await stopCommand([], ctx)) as AxiStructuredOutput;
    assert.strictEqual(output.command, 'stop');
    assert.strictEqual(output.stopped, false);
    assert.ok((output.message as string).includes('未运行'));
  });

  it('stop --all 批量停止会话', async () => {
    const ctx: WorkerContext = {
      session: 'any',
      daemonDir: baseDir,
      connect: async () => {
        throw new Error('不应被调用');
      },
    };
    const output = (await stopCommand(['--all'], ctx)) as AxiStructuredOutput;
    assert.strictEqual(output.command, 'stop');
    assert.strictEqual(output.action, 'stop-all');
    assert.strictEqual(output.stopped, true);
  });
});

describe('startCommand 真实 spawn 流程', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bcli-spawn-'));
  const daemonDir = path.join(workspace, 'daemon');
  const session = `sess-spawn-${process.pid}`;

  before(() => {
    const socketPath = makePipePath('fixturespawn111111', session);
    const entry = path.join(workspace, 'fake-entry.js');
    fs.writeFileSync(
      entry,
      [
        'const fs=require("node:fs");',
        `fs.writeFileSync(${JSON.stringify(path.join(daemonDir, `${session}.session`))}, JSON.stringify({name:${JSON.stringify(session)},version:"1.0.0",protocol:1,timestamp:Date.now(),socketPath:${JSON.stringify(socketPath)},pid:process.pid,workspaceDir:${JSON.stringify(workspace)}}), "utf-8");`,
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

  it('start 启动 daemon 并返回会话信息', async () => {
    const ctx: WorkerContext = {
      session,
      daemonDir,
      connect: async () => {
        throw new Error('不应被调用');
      },
    };
    const output = (await startCommand([], ctx)) as AxiStructuredOutput;
    assert.strictEqual(output.command, 'start');
    assert.strictEqual(output.action, 'start');
    assert.strictEqual(output.session, session);
    assert.ok(typeof output.pid === 'number' && (output.pid as number) > 0);

    const cfg = await loadSession(daemonDir, session);
    assert.ok(cfg);
    assert.strictEqual(cfg?.protocol, 1);
  });
});

describe('废弃旧命令友好提示拦截', () => {
  const dummyCtx: WorkerContext = {
    session: 'default',
    connect: async () => {
      throw new Error('不应被调用');
    },
  };

  for (const [cmd, expectedReplacement] of [
    ['open', 'browsercli start'],
    ['close', 'browsercli stop'],
    ['list', 'browsercli status'],
    ['kill-all', 'browsercli stop --all'],
    ['browser', 'browsercli start'],
  ] as const) {
    it(`调用废弃命令 '${cmd}' 抛出 COMMAND_DEPRECATED 并提供替代建议`, async () => {
      const handler = cliCommands[cmd];
      assert.ok(handler, `应注册废弃命令拦截器 ${cmd}`);
      await assert.rejects(
        async () => handler([], dummyCtx),
        (err: unknown) => {
          assert.ok(err instanceof AxiError);
          assert.strictEqual(err.code, 'COMMAND_DEPRECATED');
          assert.ok(
            err.suggestions?.some(s => s.includes(expectedReplacement)),
          );
          return true;
        },
      );
    });
  }
});
