import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execSync} from 'node:child_process';
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
  if (!fs.existsSync(socketPath)) return false;
  try {
    if (pid !== undefined && pid !== null) {
      execSync(`lsof -p ${pid}`, {stdio: 'ignore'});
      return true;
    }
    execSync(`lsof ${socketPath}`, {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
}

export function serializeArgs(
  options: Record<string, any>,
  argv: Record<string, any>
): string[] {
  const args: string[] = [];
  for (const [name, opt] of Object.entries(options)) {
    const value = argv[name];
    if (value === undefined) continue;
    if (opt.type === 'boolean') {
      if (value) args.push(`--${name}`);
    } else if (Array.isArray(value)) {
      for (const v of value) args.push(`--${name}=${v}`);
    } else {
      args.push(`--${name}=${value}`);
    }
  }
  return args;
}
