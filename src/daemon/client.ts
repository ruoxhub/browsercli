import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {socketPath, IS_WINDOWS} from './utils.js';
import {fileURLToPath} from 'node:url';
import type {CallToolResult} from '../third_party/index.js';
import fs from 'node:fs';

// 允许测试覆盖 socket 路径
let _testSocketPath: string | undefined;

export function setTestSocketPath(path: string): void {
  _testSocketPath = path;
}

function getSocketPath(): string {
  return _testSocketPath || socketPath;
}

export async function startDaemon(args: string[]): Promise<void> {
  // 使用 fileURLToPath 正确处理跨平台路径 (WSL2 → Windows)
  const daemonUrl = new URL('./daemon.js', import.meta.url);
  const daemonPath = IS_WINDOWS ? fileURLToPath(daemonUrl) : daemonUrl.pathname;

  // 使用 spawn 后台启动 daemon 进程，不等待其退出
  const child = spawn('node', [daemonPath, ...args], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // 等待 socket 文件创建（最多 5 秒，WSL2 环境可能需要更长时间）
  await new Promise<void>((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 50; // 50 * 100ms = 5 秒
    const targetSocketPath = getSocketPath();

    const checkSocket = () => {
      attempts++;
      try {
        fs.accessSync(targetSocketPath, fs.constants.F_OK);
        resolve();
      } catch {
        if (attempts >= maxAttempts) {
          reject(
            new Error(
              `Daemon 启动超时，socket 文件未创建：${targetSocketPath}`,
            ),
          );
        } else {
          setTimeout(checkSocket, 100);
        }
      }
    };

    checkSocket();
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
  return new Promise((resolve, reject) => {
    const socket = createConnection(getSocketPath());
    let response = '';

    socket.on('data', chunk => {
      response += chunk.toString();
    });

    socket.on('end', () => {
      try {
        // PipeTransport uses \0 as delimiter, response may have trailing \0
        const trimmed = response.trim();
        const nullIndex = trimmed.indexOf('\0');
        const jsonStr = nullIndex > 0 ? trimmed.slice(0, nullIndex) : trimmed;
        resolve(JSON.parse(jsonStr));
      } catch (err) {
        reject(
          new Error(
            `响应解析失败：${err}. Response: ${response.slice(0, 200)}`,
          ),
        );
      }
    });

    socket.on('error', reject);
    socket.setTimeout(30000, () => {
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
      ?.filter((c: any) => c.type === 'text')
      .map((c: any) => c.text) || [];
  return texts.join('\n');
}
