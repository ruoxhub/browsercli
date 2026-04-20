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

/**
 * Windows Named Pipe 不会在文件系统上创建 socket 文件，
 * 因此需要使用 ready 标记文件来表示 daemon 已就绪。
 * Unix 系统可直接检测 .sock 文件，无需 ready 文件。
 */
const readyFilePath = path.join(os.tmpdir(), 'js-reverse-mcp.ready');

export function getPidFilePath(): string {
  return path.join(os.tmpdir(), 'js-reverse-mcp.pid');
}

export function getSocketPath(): string {
  return socketPath;
}

export function getReadyFilePath(): string {
  return readyFilePath;
}

/** 写入 ready 标记文件（daemon socket 服务器成功 listen 后调用） */
export function writeReadyFile(): void {
  fs.writeFileSync(readyFilePath, Date.now().toString());
}

/** 删除 ready 标记文件（daemon 退出时调用） */
export function removeReadyFile(): void {
  try {
    fs.unlinkSync(readyFilePath);
  } catch {
    // ignore
  }
}

/** 检查 daemon 是否就绪（socket 可达） */
export function isDaemonReady(): boolean {
  if (IS_WINDOWS) {
    // Windows: Named Pipe 不产生文件系统 socket 文件，用 ready 标记判断
    return fs.existsSync(readyFilePath);
  }
  // Unix: 直接检查 socket 文件
  try {
    return fs.statSync(socketPath).isSocket();
  } catch {
    return false;
  }
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
  // 首要检查：daemon 是否就绪（socket 文件/Named Pipe 可达）
  if (isDaemonReady()) {
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
  if (isDaemonReady()) {
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
