/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const socketPath = path.join(os.tmpdir(), 'js-reverse-mcp.sock');
export const IS_WINDOWS = os.platform() === 'win32';
export const DAEMON_CLIENT_NAME = 'js-reverse-daemon';

// 获取项目根目录的 index.js 路径（daemon 启动的 MCP 服务器）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const INDEX_SCRIPT_PATH = path.resolve(__dirname, '../index.js');

export function getPidFilePath(): string {
  return path.join(os.tmpdir(), 'js-reverse-mcp.pid');
}

export function getSocketPath(): string {
  return socketPath;
}

export function getDaemonPid(): number | null {
  const pidFilePath = getPidFilePath();
  if (!fs.existsSync(pidFilePath)) return null;
  const pid = fs.readFileSync(pidFilePath, 'utf-8').trim();
  return parseInt(pid, 10) || null;
}

/**
 * 检查 daemon 是否正在运行且可达。
 *
 * 优先级：
 * 1. socket 文件存在 → daemon 可达，运行中
 * 2. socket 不存在但 PID 文件存在 → daemon 不可达（可能是孤儿进程或 socket 已清理）
 * 3. socket 和 PID 文件都不存在 → 未运行
 *
 * 注意：仅凭 PID + kill(pid,0) 无法可靠判断，因为任何进程存在都会返回 true。
 * 必须以 socket 文件存在性为主要依据。
 */
export function isDaemonRunning(pid?: number | null): boolean {
  // 首要检查：socket 文件是否存在（daemon 可达的必要条件）
  if (fs.existsSync(socketPath)) {
    return true;
  }

  // socket 不存在时，说明 daemon 不可达，不再检查 PID
  //（可能是孤儿进程或上次异常退出残留的 PID 文件）
  return false;
}

/**
 * 获取 daemon 的可达性状态。
 * - 'running': socket 存在，daemon 可达
 * - 'orphaned': socket 不存在但 PID 进程仍存在（孤儿进程）
 * - 'stopped': 完全未运行
 */
export function getDaemonReachability(): 'running' | 'orphaned' | 'stopped' {
  if (fs.existsSync(socketPath)) {
    return 'running';
  }

  const pid = getDaemonPid();
  if (pid !== null) {
    try {
      process.kill(pid, 0);
      return 'orphaned';
    } catch {
      // PID 进程不存在，返回 stopped
    }
  }

  return 'stopped';
}
