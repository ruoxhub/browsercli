/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {createConnection} from 'node:net';
import {fileURLToPath} from 'node:url';

import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

import {
  socketPath,
  IS_WINDOWS,
  isDaemonReady,
  getReadyFilePath,
} from './utils.js';

// Lazy logger to avoid loading debug + third_party at startup
let _logger: ((msg: string, ...args: unknown[]) => void) | undefined;
function getLogger() {
  if (!_logger) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _logger = require('../logger.js').logger;
  }
  return _logger;
}

// 允许测试覆盖 socket 路径
let _testSocketPath: string | undefined;

export function setTestSocketPath(path: string): void {
  _testSocketPath = path;
}

function getSocketPath(): string {
  return _testSocketPath || socketPath;
}

/**
 * 检查 daemon 是否就绪（可接受连接）。
 * 测试模式下（_testSocketPath 覆盖）直接检查 socket 文件是否存在；
 * 生产模式下使用全局 isDaemonReady()（Windows 检查 ready 文件，Unix 检查 socket 文件）。
 */
function checkDaemonReady(): boolean {
  // 测试模式：直接用 statSync 检查 socket 文件
  if (_testSocketPath) {
    try {
      return fs.statSync(_testSocketPath).isSocket();
    } catch {
      return false;
    }
  }
  return isDaemonReady();
}

export async function startDaemon(args: string[]): Promise<void> {
  // 使用 fileURLToPath 正确处理跨平台路径 (WSL2 → Windows)
  const daemonUrl = new URL('./daemon.js', import.meta.url);
  const daemonPath = IS_WINDOWS ? fileURLToPath(daemonUrl) : daemonUrl.pathname;

  // 跨平台启动 daemon：Windows 不支持 nohup，使用 detached + shell
  const child = IS_WINDOWS
    ? spawn('node', [daemonPath, ...args], {
        detached: true,
        shell: true,
        stdio: 'ignore',
        windowsHide: true, // 隐藏 Windows 子进程窗口
      })
    : spawn('nohup', ['node', daemonPath, ...args], {
        detached: true,
        stdio: 'ignore',
      });

  // Handle spawn failure (e.g., node binary not found)
  child.on('error', err => {
    getLogger()(`[CLIENT] Failed to spawn daemon: ${err.message}`);
  });
  child.unref();

  if (child.pid === undefined) {
    throw new Error(
      `Failed to spawn daemon process: node not found or daemon path invalid`,
    );
  }
  console.log(`Daemon PID: ${child.pid}`);

  // 等待 daemon 就绪（最多 25 秒）
  await new Promise<void>((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 250; // 250 * 100ms = 25 秒

    const checkReady = () => {
      attempts++;
      try {
        if (checkDaemonReady()) {
          // daemon 就绪后短暂等待确保完全可接受连接
          setTimeout(resolve, 300);
          return;
        }
      } catch {
        // 检测失败，继续等待
      }
      if (attempts >= maxAttempts) {
        // 最后尝试一次
        try {
          if (checkDaemonReady()) {
            setTimeout(resolve, 300);
            return;
          }
        } catch {
          // 真正的失败
        }
        const detail = IS_WINDOWS
          ? `ready 文件未创建：${getReadyFilePath()}`
          : `socket 文件未创建：${getSocketPath()}`;
        reject(new Error(`Daemon 启动超时，${detail}`));
      } else {
        setTimeout(checkReady, 100);
      }
    };

    checkReady();
  });
}

export async function stopDaemon(): Promise<void> {
  await sendCommand({method: 'shutdown'});
}

export async function sendCommand(request: {
  method: string;
  tool?: string;
  skill?: string;
  args?: Record<string, unknown>;
}): Promise<{success: boolean; result?: string; error?: string}> {
  const socketPath = getSocketPath();

  // Pre-flight check: daemon 必须就绪才能连接
  if (!checkDaemonReady()) {
    throw new Error(
      `后台服务未运行。请先执行：js-reverse start --browserUrl <chrome-debug-url>`,
    );
  }

  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let response = '';
    let settled = false; // Guard against double-settlement

    socket.on('data', chunk => {
      response += chunk.toString();
    });

    socket.on('end', () => {
      // Guard: if already rejected (e.g., by timeout), don't resolve
      if (settled) return;
      settled = true;

      try {
        // Ensure we have complete data before parsing
        // On some systems (especially Windows named pipes), 'end' may fire
        // before all buffered data is flushed, so we wait one tick
        setImmediate(() => {
          try {
            const trimmed = response.trim();
            const nullIndex = trimmed.indexOf('\0');
            const jsonStr =
              nullIndex > 0 ? trimmed.slice(0, nullIndex) : trimmed;
            resolve(JSON.parse(jsonStr));
          } catch (err) {
            reject(
              new Error(
                `响应解析失败：${err}. Response: ${response.slice(0, 200)}`,
              ),
            );
          }
        });
      } catch (err) {
        reject(
          new Error(
            `响应解析失败：${err}. Response: ${response.slice(0, 200)}`,
          ),
        );
      }
    });

    socket.on('error', err => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    socket.setTimeout(5000, () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error('IPC 请求超时'));
    });

    socket.write(JSON.stringify(request) + '\0');
  });
}

export function handleResponse(
  result: CallToolResult,
  format: 'text' | 'json' | 'md',
): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }
  const texts =
    result.content
      ?.filter((c: {type: string}) => c.type === 'text')
      .map(c => (c as {type: string; text?: string}).text)
      .filter((t): t is string => typeof t === 'string') || [];
  return texts.join('\n');
}
