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
import {createWebCommand, webCommand} from '../../../src/cli/commands/web.js';
import type {AxiStructuredOutput} from '../../../src/cli/output.js';
import {
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

/** 会响应 hello 的活体 fake daemon（真实 net 监听）。 */
async function startLiveDaemon(): Promise<{
  server: net.Server;
  socketPath: string;
}> {
  const socketPath = makePipePath(
    crypto.randomBytes(8).toString('hex'),
    `sess-live-web-${process.pid}`,
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

describe('webCommand', () => {
  it('注册为顶层 web 命令', () => {
    assert.strictEqual(cliCommands.web, webCommand);
  });

  it('缺少上下文时抛出 INTERNAL', async () => {
    await assert.rejects(
      async () => webCommand([], undefined as unknown as WorkerContext),
      (err: unknown) => err instanceof AxiError && err.code === 'INTERNAL',
    );
  });

  it('传入未知子命令时抛出 VALIDATION_ERROR', async () => {
    const ctx: WorkerContext = {
      session: 'default',
      connect: async () => {
        throw new Error('不应被调用');
      },
    };
    await assert.rejects(
      async () => webCommand(['unknown-sub'], ctx),
      (err: unknown) =>
        err instanceof AxiError &&
        err.code === 'VALIDATION_ERROR' &&
        err.message.includes('未知子命令') &&
        (err.suggestions ?? []).some(s => s.includes('web [status|stop]')),
    );
  });

  it('传入无效端口时抛出 VALIDATION_ERROR', async () => {
    const ctx: WorkerContext = {
      session: 'default',
      connect: async () => {
        throw new Error('不应被调用');
      },
    };
    for (const invalid of ['0', '-1', 'abc', '70000']) {
      await assert.rejects(
        async () => webCommand(['--port', invalid], ctx),
        (err: unknown) =>
          err instanceof AxiError &&
          err.code === 'VALIDATION_ERROR' &&
          err.message.includes('无效的端口号'),
      );
    }
  });

  describe('已有活跃会话场景', () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browsercli-web-'));
    let live: {server: net.Server; socketPath: string};

    before(async () => {
      live = await startLiveDaemon();
    });

    after(async () => {
      live.server.close();
      if (process.platform !== 'win32') {
        await fs.promises.unlink(live.socketPath).catch(() => undefined);
      }
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

    it('web status 在会话未运行时报告 online=false', async () => {
      const dir = path.join(baseDir, 'not-running');
      fs.mkdirSync(dir, {recursive: true});
      const ctx: WorkerContext = {
        session: 'offline',
        daemonDir: dir,
        connect: async () => {
          throw new Error('不应被调用');
        },
      };

      const resText = (await webCommand(
        ['status'],
        ctx,
      )) as AxiStructuredOutput;
      assert.strictEqual(resText.online, false);

      const resJson = (await webCommand(
        ['status', '--json'],
        ctx,
      )) as AxiStructuredOutput;
      assert.strictEqual(resJson.online, false);
      assert.strictEqual(resJson.port, null);
      assert.strictEqual(resJson.url, null);
    });

    it('web stop 在会话未运行时报告 stopped=false', async () => {
      const dir = path.join(baseDir, 'stop-not-running');
      fs.mkdirSync(dir, {recursive: true});
      const ctx: WorkerContext = {
        session: 'offline-stop',
        daemonDir: dir,
        connect: async () => {
          throw new Error('不应被调用');
        },
      };

      let stoppedCalled = false;
      const cmd = createWebCommand({
        stopSession: async () => {
          stoppedCalled = true;
        },
      });

      const resText = (await cmd(['stop'], ctx)) as AxiStructuredOutput;
      assert.strictEqual(resText.command, 'web stop');
      assert.strictEqual(resText.stopped, false);
      assert.strictEqual(resText.online, false);
      assert.ok(
        typeof resText.message === 'string' &&
          resText.message.includes('未运行'),
      );
      assert.strictEqual(stoppedCalled, false);

      const resJson = (await cmd(
        ['stop', '--json'],
        ctx,
      )) as AxiStructuredOutput;
      assert.strictEqual(resJson.command, 'web stop');
      assert.strictEqual(resJson.stopped, false);
      assert.strictEqual(resJson.online, false);
    });

    it('web stop / close 在会话运行时执行停止并清理', async () => {
      const dir = path.join(baseDir, 'stop-running');
      writeSession(dir, {
        name: 'stopping-sess',
        version: '0.0.0',
        protocol: 1,
        timestamp: Date.now(),
        socketPath: live.socketPath,
        pid: process.pid,
        consolePort: 8765,
      });
      const ctx: WorkerContext = {
        session: 'stopping-sess',
        daemonDir: dir,
        connect: async () => {
          throw new Error('不应被调用');
        },
      };

      let stoppedSessionName: string | undefined;
      let stoppedDir: string | undefined;
      const cmd = createWebCommand({
        stopSession: async (cfg, d) => {
          stoppedSessionName = cfg.name;
          stoppedDir = d;
        },
      });

      const res = (await cmd(['stop', '--json'], ctx)) as AxiStructuredOutput;
      assert.strictEqual(res.command, 'web stop');
      assert.strictEqual(res.session, 'stopping-sess');
      assert.strictEqual(res.stopped, true);
      assert.strictEqual(res.online, false);
      assert.strictEqual(res.pid, process.pid);
      assert.strictEqual(res.port, 8765);
      assert.strictEqual(stoppedSessionName, 'stopping-sess');
      assert.strictEqual(stoppedDir, dir);

      // 测试 close 别名
      stoppedSessionName = undefined;
      const resClose = (await cmd(['close'], ctx)) as AxiStructuredOutput;
      assert.strictEqual(resClose.command, 'web stop');
      assert.strictEqual(resClose.stopped, true);
      assert.strictEqual(resClose.online, false);
      assert.ok(
        typeof resClose.message === 'string' &&
          resClose.message.includes('已停止'),
      );
      assert.strictEqual(stoppedSessionName, 'stopping-sess');
    });

    it('web status 在会话运行时报告 online=true 及端口信息', async () => {
      const dir = path.join(baseDir, 'running');
      writeSession(dir, {
        name: 'active',
        version: '0.0.0',
        protocol: 1,
        timestamp: Date.now(),
        socketPath: live.socketPath,
        pid: process.pid,
        consolePort: 8765,
      });
      const ctx: WorkerContext = {
        session: 'active',
        daemonDir: dir,
        connect: async () => {
          throw new Error('不应被调用');
        },
      };

      const res = (await webCommand(
        ['status', '--json'],
        ctx,
      )) as AxiStructuredOutput;
      assert.strictEqual(res.online, true);
      assert.strictEqual(res.port, 8765);
      assert.strictEqual(res.url, 'http://127.0.0.1:8765');
      assert.strictEqual(res.pid, process.pid);
    });

    it('会话已在运行时打开浏览器并返回 already-running 状态', async () => {
      const dir = path.join(baseDir, 'already');
      writeSession(dir, {
        name: 'running-sess',
        version: '0.0.0',
        protocol: 1,
        timestamp: Date.now(),
        socketPath: live.socketPath,
        pid: process.pid,
        consolePort: 8765,
      });
      const ctx: WorkerContext = {
        session: 'running-sess',
        daemonDir: dir,
        connect: async () => {
          throw new Error('不应被调用');
        },
      };

      let openedUrl: string | undefined;
      const cmd = createWebCommand({
        openBrowser: url => {
          openedUrl = url;
          return true;
        },
      });

      const res = (await cmd(['--json'], ctx)) as AxiStructuredOutput;
      assert.strictEqual(res.command, 'web');
      assert.strictEqual(res.session, 'running-sess');
      assert.strictEqual(res.status, 'success');
      assert.strictEqual(res.port, 8765);
      assert.strictEqual(res.url, 'http://127.0.0.1:8765');
      assert.strictEqual(res.opened, true);
      assert.strictEqual(openedUrl, 'http://127.0.0.1:8765');
    });

    it('支持 --no-open 阻止自动打开浏览器', async () => {
      const dir = path.join(baseDir, 'no-open');
      writeSession(dir, {
        name: 'noopen-sess',
        version: '0.0.0',
        protocol: 1,
        timestamp: Date.now(),
        socketPath: live.socketPath,
        pid: process.pid,
        consolePort: 8765,
      });
      const ctx: WorkerContext = {
        session: 'noopen-sess',
        daemonDir: dir,
        connect: async () => {
          throw new Error('不应被调用');
        },
      };

      let called = false;
      const cmd = createWebCommand({
        openBrowser: () => {
          called = true;
          return true;
        },
      });

      const res = (await cmd(
        ['--no-open', '--json'],
        ctx,
      )) as AxiStructuredOutput;
      assert.strictEqual(called, false);
      assert.strictEqual(res.opened, false);
    });

    it('会话以 --no-console 运行时抛出 WEB_CONSOLE_DISABLED 错误', async () => {
      const dir = path.join(baseDir, 'no-console');
      writeSession(dir, {
        name: 'headless-sess',
        version: '0.0.0',
        protocol: 1,
        timestamp: Date.now(),
        socketPath: live.socketPath,
        pid: process.pid,
        // consolePort 为 undefined
      });
      const ctx: WorkerContext = {
        session: 'headless-sess',
        daemonDir: dir,
        connect: async () => {
          throw new Error('不应被调用');
        },
      };

      await assert.rejects(
        async () => webCommand([], ctx),
        (err: unknown) =>
          err instanceof AxiError &&
          err.code === 'WEB_CONSOLE_DISABLED' &&
          (err.suggestions ?? []).some(s => s.includes('close')),
      );
    });
  });

  describe('未运行拉起场景（假 entry）', () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'browsercli-web-spawn-'),
    );
    const daemonDir = path.join(workspace, 'daemon');
    const session = `sess-web-${process.pid}`;

    before(() => {
      const socketPath = makePipePath('fixturespawnweb00', session);
      const entry = path.join(workspace, 'fake-entry.js');
      // 假 daemon entry：解析 argv 中的 --console-port，写入 session 文件
      fs.writeFileSync(
        entry,
        [
          'const fs=require("node:fs");',
          'let consolePort = 8765;',
          'for (const arg of process.argv) {',
          '  if (arg.startsWith("--console-port=")) {',
          '    consolePort = parseInt(arg.slice("--console-port=".length), 10);',
          '  }',
          '}',
          `fs.writeFileSync(${JSON.stringify(path.join(daemonDir, `${session}.session`))}, JSON.stringify({name:${JSON.stringify(session)},version:"0.0.0",protocol:1,timestamp:Date.now(),socketPath:${JSON.stringify(socketPath)},pid:process.pid,workspaceDir:${JSON.stringify(workspace)},consolePort}), "utf-8");`,
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

    it('未运行时自动拉起 daemon 并使用指定端口打开 Web 控制台', async () => {
      const ctx: WorkerContext = {
        session,
        daemonDir,
        connect: async () => {
          throw new Error('不应被调用');
        },
      };

      let openedUrl: string | undefined;
      const cmd = createWebCommand({
        openBrowser: url => {
          openedUrl = url;
          return true;
        },
      });

      const res = (await cmd(
        ['--port', '9876', '--json'],
        ctx,
      )) as AxiStructuredOutput;
      assert.strictEqual(res.command, 'web');
      assert.strictEqual(res.session, session);
      assert.strictEqual(res.port, 9876);
      assert.strictEqual(res.url, 'http://127.0.0.1:9876');
      assert.strictEqual(res.opened, true);
      assert.strictEqual(openedUrl, 'http://127.0.0.1:9876');
    });
  });
});
