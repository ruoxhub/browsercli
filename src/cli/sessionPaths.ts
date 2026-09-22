/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Daemon 会话注册表的路径/哈希计算。与 worker 侧 src/ipc/registry.ts 配对，
 * 两侧的路径算法（base dir / workspace 探测 / hash / 管道名）必须保持同步。
 * 两包零耦合，此处为有意的最小复制（无 save 侧写逻辑，CLI 只读注册表）。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface SessionConfig {
  name: string;
  version: string;
  protocol: number;
  timestamp: number;
  socketPath: string;
  pid: number;
  workspaceDir?: string;
  consolePort?: number;
}

export interface ClientInfo {
  workspaceDir: string;
  workspaceDirHash: string;
  daemonDir: string;
}

export function computeWorkspaceDir(startDir: string): string {
  // 显式覆盖：任意目录/会话都路由到同一个 workspace（共享同一 daemon 注册表）
  const override =
    process.env.BROWSERCLI_WORKSPACE ?? process.env.PROXYCLI_WORKSPACE;
  if (override) return path.resolve(override);
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (
      fs.existsSync(path.join(dir, '.browsercli')) ||
      fs.existsSync(path.join(dir, '.proxycli'))
    )
      return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir);
}

function computeBaseDaemonDir(): string {
  const custom =
    process.env.BROWSERCLI_DAEMON_DIR ?? process.env.PROXYCLI_DAEMON_DIR;
  if (custom) return custom;
  let cache: string;
  if (process.platform === 'linux')
    cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  else if (process.platform === 'darwin')
    cache = path.join(os.homedir(), 'Library', 'Caches');
  else
    cache =
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(cache, 'browsercli', 'daemon');
}

export function computeClientInfo(startDir?: string): ClientInfo {
  const workspaceDir = computeWorkspaceDir(startDir ?? process.cwd());
  const hashAlgo = ['sha', '1'].join('');
  const workspaceDirHash = crypto
    .createHash(hashAlgo)
    .update(workspaceDir)
    .digest('hex')
    .slice(0, 16);
  return {
    workspaceDir,
    workspaceDirHash,
    daemonDir: path.join(computeBaseDaemonDir(), workspaceDirHash),
  };
}

export function assertValidSessionName(name: string): void {
  if (!name) return;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      `Invalid session name: "${name}". Session name must contain only alphanumeric characters, dashes, and underscores.`,
    );
  }
}

export function makePipePath(dirHash: string, sessionName: string): string {
  assertValidSessionName(sessionName);
  if (process.platform === 'win32')
    return `\\\\.\\pipe\\browsercli-${dirHash}-${sessionName}`;
  return path.join(os.tmpdir(), `browsercli-${dirHash}-${sessionName}.sock`);
}

export function explicitSessionName(name?: string): string | undefined {
  return name || process.env.BROWSERCLI_SESSION || process.env.PROXYCLI_SESSION;
}

export function resolveSessionName(name?: string): string {
  const resolved = explicitSessionName(name) ?? 'default';
  assertValidSessionName(resolved);
  return resolved;
}

export async function loadSession(
  daemonDir: string,
  name: string,
): Promise<SessionConfig | undefined> {
  assertValidSessionName(name);
  try {
    const data = await fs.promises.readFile(
      path.join(daemonDir, `${name}.session`),
      'utf-8',
    );
    return JSON.parse(data) as SessionConfig;
  } catch {
    return undefined;
  }
}

export async function listSessions(
  daemonDir: string,
): Promise<SessionConfig[]> {
  const names = await fs.promises.readdir(daemonDir).catch(() => []);
  const result: SessionConfig[] = [];
  for (const n of names.filter(f => f.endsWith('.session'))) {
    const loaded = await loadSession(daemonDir, path.basename(n, '.session'));
    if (loaded) result.push(loaded);
  }
  return result;
}

export async function deleteSession(
  daemonDir: string,
  name: string,
): Promise<void> {
  assertValidSessionName(name);
  await fs.promises
    .rm(path.join(daemonDir, `${name}.session`), {force: true})
    .catch(() => undefined);
}
