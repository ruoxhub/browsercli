/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Daemon 会话注册表门面。
 * 共享核心实现统一收敛于 src/cli/sessionPaths.ts，本模块保留并转接原有导出以兼容 Worker 及测试。
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  assertValidSessionName,
  computeBaseDaemonDir,
  computeClientInfo,
  computeWorkspaceDir,
  explicitSessionName,
  isPidAlive,
  isWorkspaceIsolationEnabled,
  killPidForce,
  loadSession,
  makePipePath,
  resolveSessionName,
  type ClientInfo,
  type SessionConfig,
} from '../cli/sessionPaths.js';

export interface SessionFile {
  file: string;
  daemonDir: string;
  config: SessionConfig;
}

export {
  assertValidSessionName,
  computeBaseDaemonDir,
  computeClientInfo,
  computeWorkspaceDir,
  explicitSessionName,
  isPidAlive,
  isWorkspaceIsolationEnabled,
  killPidForce,
  makePipePath,
  resolveSessionName,
  type ClientInfo,
  type SessionConfig,
};

export async function saveSessionFile(
  info: ClientInfo,
  config: SessionConfig,
): Promise<SessionFile> {
  assertValidSessionName(config.name);
  await fs.promises.mkdir(info.daemonDir, {recursive: true, mode: 0o700});
  const file = path.join(info.daemonDir, `${config.name}.session`);
  await fs.promises.writeFile(file, JSON.stringify(config, null, 2), 'utf-8');
  return {file, daemonDir: info.daemonDir, config};
}

export async function loadSessionFile(
  info: ClientInfo,
  name: string,
): Promise<SessionFile | undefined> {
  assertValidSessionName(name);
  const config = await loadSession(info.daemonDir, name);
  if (!config) return undefined;
  const file = path.join(info.daemonDir, `${name}.session`);
  return {
    file,
    daemonDir: info.daemonDir,
    config,
  };
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
