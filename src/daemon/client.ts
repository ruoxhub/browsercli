import {createConnection} from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {socketPath} from './utils.js';
import {logger} from '../logger.js';
import type {CallToolResult} from '../third_party/index.js';

const execAsync = promisify(execFile);

// 允许测试覆盖 socket 路径
let _testSocketPath: string | undefined;

export function setTestSocketPath(path: string): void {
  _testSocketPath = path;
}

function getSocketPath(): string {
  return _testSocketPath || socketPath;
}

export async function startDaemon(args: string[]): Promise<void> {
  const daemonPath = new URL('./js-reverse-mcp.js', import.meta.url).pathname;
  logger(`启动 Daemon: node ${daemonPath} ${args.join(' ')}`);
  await execAsync('node', [daemonPath, ...args]);
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

    socket.on('data', (chunk) => {
      response += chunk.toString();
    });

    socket.on('end', () => {
      try {
        resolve(JSON.parse(response.trim()));
      } catch (err) {
        reject(new Error(`响应解析失败：${err}`));
      }
    });

    socket.on('error', reject);
    socket.setTimeout(30000, () => {
      socket.destroy();
      reject(new Error('IPC 请求超时'));
    });

    socket.write(JSON.stringify(request) + '\n');
  });
}

export function handleResponse(result: CallToolResult, format: 'text' | 'json' | 'md'): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }
  const texts = result.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text) || [];
  return texts.join('\n');
}
