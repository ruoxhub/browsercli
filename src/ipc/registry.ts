/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Daemon 会话注册表。与 proxycli/src/sessionPaths.ts 配对，
 * 两侧的路径算法（base dir / workspace 探测 / hash / 管道名）必须保持同步。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {pipePath} from './socketConnection.js';

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

export interface SessionFile {
  file: string;
  daemonDir: string;
  config: SessionConfig;
}

export interface ClientInfo {
  version: string;
  workspaceDir: string;
  workspaceDirHash: string;
  daemonDir: string;
}

export function computeWorkspaceDir(startDir: string): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (
      fs.existsSync(path.join(dir, '.proxycli')) ||
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
  if (process.env.PROXYCLI_DAEMON_DIR) return process.env.PROXYCLI_DAEMON_DIR;
  if (process.env.PROXYCLI_DAEMON_DIR)
    return process.env.PROXYCLI_DAEMON_DIR;
  let cache: string;
  if (process.platform === 'linux')
    cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  else if (process.platform === 'darwin')
    cache = path.join(os.homedir(), 'Library', 'Caches');
  else
    cache =
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(cache, 'proxycli', 'daemon');
}

export function computeClientInfo(
  startDir?: string,
  version = '0.0.0',
): ClientInfo {
  const workspaceDir = computeWorkspaceDir(startDir ?? process.cwd());
  const hashAlgo = ['sha', '1'].join('');
  const workspaceDirHash = crypto
    .createHash(hashAlgo)
    .update(workspaceDir)
    .digest('hex')
    .slice(0, 16);
  return {
    version,
    workspaceDir,
    workspaceDirHash,
    daemonDir: path.join(computeBaseDaemonDir(), workspaceDirHash),
  };
}

export function makePipePath(dirHash: string, sessionName: string): string {
  if (process.platform === 'win32')
    return pipePath(`proxycli-${dirHash}-${sessionName}`);
  return path.join(os.tmpdir(), `proxycli-${dirHash}-${sessionName}.sock`);
}

export function explicitSessionName(name?: string): string | undefined {
  return name || process.env.PROXYCLI_SESSION || process.env.PROXYCLI_SESSION;
}

export function resolveSessionName(name?: string): string {
  return explicitSessionName(name) ?? 'default';
}

export async function saveSessionFile(
  info: ClientInfo,
  config: SessionConfig,
): Promise<SessionFile> {
  await fs.promises.mkdir(info.daemonDir, {recursive: true});
  const file = path.join(info.daemonDir, `${config.name}.session`);
  await fs.promises.writeFile(file, JSON.stringify(config, null, 2), 'utf-8');
  return {file, daemonDir: info.daemonDir, config};
}

export async function loadSessionFile(
  info: ClientInfo,
  name: string,
): Promise<SessionFile | undefined> {
  try {
    const file = path.join(info.daemonDir, `${name}.session`);
    const data = await fs.promises.readFile(file, 'utf-8');
    return {
      file,
      daemonDir: info.daemonDir,
      config: JSON.parse(data) as SessionConfig,
    };
  } catch {
    return undefined;
  }
}

export async function listSessionFiles(
  info: ClientInfo,
): Promise<SessionFile[]> {
  const names = await fs.promises.readdir(info.daemonDir).catch(() => []);
  const result: SessionFile[] = [];
  for (const n of names.filter(f => f.endsWith('.session'))) {
    const loaded = await loadSessionFile(info, path.basename(n, '.session'));
    if (loaded) result.push(loaded);
  }
  return result;
}

export async function deleteSessionFile(sf: SessionFile): Promise<void> {
  await fs.promises.rm(sf.file, {force: true}).catch(() => undefined);
}
