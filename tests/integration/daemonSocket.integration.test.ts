/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 端到端集成测试：真实 detached daemon（build/src/index.js --daemon）
 * + 真实 proxycli CLI（proxycli/build/bin/proxycli.js），
 * 走本地命名管道 / unix socket 的完整生命周期：
 * open → list-tools → call(未知工具) → close。
 */

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// 运行时位置：<repo>/build/tests/integration —— 上溯三级即仓库根。
const repoRoot = path.resolve(here, '../../..');
const cliBin = path.join(
  repoRoot,
  'proxycli',
  'build',
  'bin',
  'proxycli.js',
);
const daemonEntry = path.join(repoRoot, 'build', 'src', 'index.js');

interface SessionConfig {
  name: string;
  version: string;
  protocol: number;
  timestamp: number;
  socketPath: string;
  pid: number;
  workspaceDir?: string;
  consolePort?: number;
}

const SESSION_NAME = 'itest';

async function waitFor<T>(
  probe: () => T | undefined,
  timeoutMs: number,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() - start > timeoutMs)
      throw new Error('timed out waiting for daemon session');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function findSessionFiles(daemonDir: string): SessionConfig[] {
  if (!fs.existsSync(daemonDir)) return [];
  const result: SessionConfig[] = [];
  for (const dirEntry of fs.readdirSync(daemonDir, {withFileTypes: true})) {
    if (!dirEntry.isDirectory()) continue;
    const file = path.join(daemonDir, dirEntry.name, `${SESSION_NAME}.session`);
    if (!fs.existsSync(file)) continue;
    result.push(JSON.parse(fs.readFileSync(file, 'utf-8')) as SessionConfig);
  }
  return result;
}

function findSession(daemonDir: string): SessionConfig | undefined {
  return findSessionFiles(daemonDir)[0];
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Windows 下对已退出但句柄未释放的 pid 可能报 EPERM/EINVAL，视为不存活不稳，
    // 这里只把明确「不存在」当死；EPERM 极少见（本进程自己 spawn 的 child）。
    return code === 'EPERM';
  }
}

describe('daemon socket end-to-end', () => {
  let tmpRoot: string;
  let workspace: string;
  let daemonDir: string;
  let cliEnv: NodeJS.ProcessEnv;
  let daemonPid: number | undefined;

  function runCli(args: string[]): {stdout: string; stderr: string} {
    const stdout = execFileSync(process.execPath, [cliBin, ...args], {
      cwd: workspace,
      env: cliEnv,
      encoding: 'utf-8',
      timeout: 120_000,
    });
    return {stdout, stderr: ''};
  }

  function runCliFailure(args: string[]): {
    status: number | null;
    output: string;
  } {
    try {
      execFileSync(process.execPath, [cliBin, ...args], {
        cwd: workspace,
        env: cliEnv,
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return {status: 0, output: ''};
    } catch (error) {
      const err = error as {
        status?: number;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
      };
      const text = (stream?: string | Buffer): string =>
        typeof stream === 'string' ? stream : (stream?.toString() ?? '');
      // axi-sdk-js 的 renderError 与正常输出同走 stdout，这里合并两个流断言。
      return {
        status: err.status ?? null,
        output: text(err.stdout) + text(err.stderr),
      };
    }
  }

  before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bcli-daemon-e2e-'));
    workspace = path.join(tmpRoot, 'ws');
    fs.mkdirSync(path.join(workspace, '.proxycli'), {recursive: true});
    daemonDir = path.join(tmpRoot, 'daemon');
    cliEnv = {
      ...process.env,
      BROWSERCLI_DAEMON_DIR: daemonDir,
      BROWSERCLI_ENTRY: daemonEntry,
    };
    assert.ok(
      fs.existsSync(cliBin),
      `proxycli bin missing: ${cliBin} (run npm run build first)`,
    );
    assert.ok(
      fs.existsSync(daemonEntry),
      `daemon entry missing: ${daemonEntry}`,
    );
  });

  after(() => {
    // 兜底：强杀残留 daemon，清理临时目录。
    for (const dirEntry of fs.existsSync(daemonDir)
      ? fs.readdirSync(daemonDir)
      : []) {
      const dir = path.join(daemonDir, dirEntry);
      if (!fs.statSync(dir).isDirectory()) continue;
      const sessionFile = path.join(dir, `${SESSION_NAME}.session`);
      if (!fs.existsSync(sessionFile)) continue;
      try {
        const cfg = JSON.parse(
          fs.readFileSync(sessionFile, 'utf-8'),
        ) as SessionConfig;
        process.kill(cfg.pid, 'SIGKILL');
      } catch {
        // 进程已退出 —— 兜底路径本就允许失败。
      }
    }
    fs.rmSync(tmpRoot, {recursive: true, force: true, maxRetries: 5});
  });

  it('open spawns a detached daemon and writes its session file', async () => {
    runCli([`-s=${SESSION_NAME}`, 'open']);
    const cfg = await waitFor(() => findSession(daemonDir), 15_000);
    daemonPid = cfg.pid;
    assert.equal(cfg.name, SESSION_NAME);
    assert.equal(cfg.protocol, 1);
    assert.ok(cfg.socketPath.length > 0);
    assert.ok(
      Number.isFinite(cfg.consolePort) && (cfg.consolePort as number) > 0,
    );
  });

  it('list-tools returns a non-empty tool list over the socket', () => {
    const {stdout} = runCli([`-s=${SESSION_NAME}`, 'list-tools']);
    // axi-sdk-js 以 TOON 编码渲染（renderOutput 无条件 encode），--json 只
    // 控制字段形状而非 JSON 编码；默认列表走 tableOutput → `headers[3]` +
    // `rows[<n>]`，断言行数与已知工具名。
    const match = stdout.match(/^rows\[(\d+)\]/m);
    assert.ok(
      match,
      `expected TOON rows table in stdout, got:\n${stdout.slice(0, 200)}`,
    );
    assert.ok(Number(match[1]) > 0, 'expected non-empty tools list');
    assert.match(stdout, /deobfuscate_code/);
  });

  it('call on an unknown tool exits 1 with UNKNOWN_TOOL in output', () => {
    const {status, output} = runCliFailure([
      `-s=${SESSION_NAME}`,
      'call',
      'no_such_tool_for_e2e',
    ]);
    assert.equal(status, 1);
    assert.match(output, /UNKNOWN_TOOL/);
  });

  it('close removes the session file and stops the daemon process', async () => {
    assert.ok(daemonPid, 'daemon pid recorded by the open test');
    runCli([`-s=${SESSION_NAME}`, 'close']);
    const start = Date.now();
    for (;;) {
      const still = findSession(daemonDir);
      if (!still && !isProcessAlive(daemonPid as number)) break;
      if (Date.now() - start > 5_000) {
        throw new Error(
          `daemon (pid=${daemonPid}) still alive or session file lingering after close`,
        );
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  });
});
