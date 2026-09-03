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
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.browsercli'))) return dir;
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
  if (process.env.BROWSERCLI_DAEMON_DIR)
    return process.env.BROWSERCLI_DAEMON_DIR;
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
  const workspaceDirHash = crypto
    .createHash('sha1')
    .update(workspaceDir)
    .digest('hex')
    .slice(0, 16);
  return {
    workspaceDir,
    workspaceDirHash,
    daemonDir: path.join(computeBaseDaemonDir(), workspaceDirHash),
  };
}

export function makePipePath(dirHash: string, sessionName: string): string {
  if (process.platform === 'win32')
    return `\\\\.\\pipe\\browsercli-${dirHash}-${sessionName}`;
  return path.join(os.tmpdir(), `browsercli-${dirHash}-${sessionName}.sock`);
}

export function explicitSessionName(name?: string): string | undefined {
  return name || process.env.BROWSERCLI_SESSION;
}

export function resolveSessionName(name?: string): string {
  return explicitSessionName(name) ?? 'default';
}

export async function loadSession(
  daemonDir: string,
  name: string,
): Promise<SessionConfig | undefined> {
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
  await fs.promises
    .rm(path.join(daemonDir, `${name}.session`), {force: true})
    .catch(() => undefined);
}
