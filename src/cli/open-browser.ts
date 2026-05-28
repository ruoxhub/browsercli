/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {spawn} from 'node:child_process';

/**
 * 跨平台打开默认浏览器访问指定 URL。
 * 失败时不抛错，仅返回 false，调用方自行决定是否提示用户手动打开。
 */
export function openInBrowser(url: string): boolean {
  try {
    const platform = process.platform;
    let command: string;
    let args: string[];

    if (platform === 'win32') {
      command = 'cmd';
      args = ['/c', 'start', '""', url];
    } else if (platform === 'darwin') {
      command = 'open';
      args = [url];
    } else {
      command = 'xdg-open';
      args = [url];
    }

    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
      shell: false,
    });
    child.on('error', () => {
      // 忽略：调用方已通过返回值或日志感知失败
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
