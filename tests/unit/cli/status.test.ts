/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';

import {statusCommand} from '../../../src/cli/commands/status.js';
import type {AxiStructuredOutput} from '../../../src/cli/output.js';
import {loadSession} from '../../../src/cli/sessionPaths.js';
import {
  makePipePath,
  type SessionConfig,
} from '../../../src/cli/sessionPaths.js';
import type {WorkerContext} from '../../../src/cli/types.js';

function fakeSession(name: string, socketPath: string): SessionConfig {
  return {
    name,
    version: '1.0.0',
    protocol: 1,
    timestamp: Date.now(),
    socketPath,
    pid: process.pid,
    consolePort: name === 'live' ? 8765 : undefined,
  };
}

describe('statusCommand (registry probe + stale GC)', () => {
  const daemonDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'proxycli-status-'),
  );
  let liveServer: net.Server;
  let livePath: string;

  before(async () => {
    livePath = makePipePath(
      crypto.randomBytes(8).toString('hex'),
      `status-live-${process.pid}`,
    );
    liveServer = net.createServer(socket => {
      let buf = '';
      socket.on('data', chunk => {
        buf += chunk.toString();
        let idx = buf.indexOf('\n');
        while (idx !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line) {
            const msg = JSON.parse(line) as {id: number; method: string};
            if (msg.method === 'hello') {
              socket.write(
                `${JSON.stringify({id: msg.id, result: {protocol: 1}})}\n`,
              );
            }
          }
          idx = buf.indexOf('\n');
        }
      });
    });
    await new Promise<void>(resolve => liveServer.listen(livePath, resolve));

    fs.writeFileSync(
      path.join(daemonDir, 'live.session'),
      JSON.stringify(fakeSession('live', livePath)),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(daemonDir, 'stale.session'),
      JSON.stringify(
        fakeSession(
          'stale',
          makePipePath(
            crypto.randomBytes(8).toString('hex'),
            `status-stale-${process.pid}`,
          ),
        ),
      ),
      'utf-8',
    );
  });

  after(async () => {
    liveServer.close();
    if (process.platform !== 'win32')
      await fs.promises.unlink(livePath).catch(() => undefined);
    fs.rmSync(daemonDir, {recursive: true, force: true});
  });

  it('探活成功计 open、失败计 closed-stale 并 GC session 文件', async () => {
    const ctx: WorkerContext = {
      session: 'default',
      daemonDir,
      connect: async () => {
        throw new Error('不应被调用');
      },
    };
    const output = (await statusCommand(
      ['--json'],
      ctx,
    )) as AxiStructuredOutput;
    assert.strictEqual(output.command, 'status');
    assert.strictEqual(output.online, true);
    const sessions = output.sessions as Array<{
      session: string;
      status: string;
      console: string;
    }>;
    const live = sessions.find(s => s.session === 'live');
    const stale = sessions.find(s => s.session === 'stale');
    assert.strictEqual(live?.status, 'open');
    assert.strictEqual(live?.console, '127.0.0.1:8765');
    assert.strictEqual(stale?.status, 'closed-stale');
    // stale session 文件应被 GC，live 保留
    assert.strictEqual(await loadSession(daemonDir, 'stale'), undefined);
    assert.ok(await loadSession(daemonDir, 'live'));
  });

  it('无会话时输出空表且 online=false', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'proxycli-empty-'));
    try {
      const ctx: WorkerContext = {
        session: 'default',
        daemonDir: empty,
        connect: async () => {
          throw new Error('不应被调用');
        },
      };
      const output = (await statusCommand(
        ['--json'],
        ctx,
      )) as AxiStructuredOutput;
      assert.strictEqual(output.online, false);
      assert.deepEqual(output.sessions, []);
      assert.ok(output.message);
    } finally {
      fs.rmSync(empty, {recursive: true, force: true});
    }
  });

  it('默认输出为 Session/PID/Console/Status 表格', async () => {
    // 重新造一个 stale 文件供表格用例（上一用例已 GC 掉 stale）
    fs.writeFileSync(
      path.join(daemonDir, 'stale2.session'),
      JSON.stringify(
        fakeSession(
          'stale2',
          makePipePath(
            crypto.randomBytes(8).toString('hex'),
            `status-stale2-${process.pid}`,
          ),
        ),
      ),
      'utf-8',
    );
    const ctx: WorkerContext = {
      session: 'default',
      daemonDir,
      connect: async () => {
        throw new Error('不应被调用');
      },
    };
    const output = (await statusCommand([], ctx)) as AxiStructuredOutput;
    assert.deepEqual(output.headers, ['Session', 'PID', 'Console', 'Status']);
    assert.ok(Array.isArray(output.rows));
    assert.strictEqual(output.rows?.length, 2);
    const staleRow = output.rows?.find(r => r[0] === 'stale2');
    assert.strictEqual(staleRow?.[3], 'closed-stale');
  });
});
