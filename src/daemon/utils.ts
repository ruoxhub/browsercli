import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execSync} from 'node:child_process';

export const socketPath = path.join(os.tmpdir(), 'js-reverse-mcp.sock');

export function isDaemonRunning(): boolean {
  if (!fs.existsSync(socketPath)) return false;
  try {
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
