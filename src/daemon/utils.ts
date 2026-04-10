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

export function isDaemonRunning(pid?: number | null): boolean {
  if (pid === null || pid === undefined) pid = getDaemonPid() ?? undefined;

  // 先检查 socket 文件（最可靠的指标）
  if (fs.existsSync(socketPath)) {
    return true;
  }

  // socket 不存在时，检查 PID
  if (pid !== undefined && pid !== null) {
    try {
      // 使用 kill 0 检查进程是否存在（不发送信号）
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
