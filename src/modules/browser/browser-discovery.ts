/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {logger} from '../../utils/logger.js';

/**
 * TCP 端口探测（避免触发 Chrome 安全弹窗）
 */
export function checkPort(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection(port, '127.0.0.1');
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * 获取 DevToolsActivePort 文件的可能路径列表（跨平台）
 */
export function getDevToolsActivePortPaths(userDataDir?: string): string[] {
  if (userDataDir) {
    return [path.join(userDataDir, 'DevToolsActivePort')];
  }
  const platform = os.platform();
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';

  if (platform === 'darwin') {
    return [
      path.join(
        home,
        'Library/Application Support/Citro Labs/ego lite/User Data/DevToolsActivePort',
      ),
      path.join(
        home,
        'Library/Application Support/Citro Labs/ego/User Data/DevToolsActivePort',
      ),
      path.join(
        home,
        'Library/Application Support/Google/Chrome/DevToolsActivePort',
      ),
      path.join(
        home,
        'Library/Application Support/Google/Chrome Canary/DevToolsActivePort',
      ),
      path.join(
        home,
        'Library/Application Support/Chromium/DevToolsActivePort',
      ),
      path.join(
        home,
        'Library/Application Support/Microsoft Edge/DevToolsActivePort',
      ),
    ];
  }

  if (platform === 'linux') {
    return [
      path.join(home, '.config/citro-labs/ego-lite/DevToolsActivePort'),
      path.join(home, '.config/citro-labs/ego/DevToolsActivePort'),
      path.join(home, '.config/google-chrome/DevToolsActivePort'),
      path.join(home, '.config/chromium/DevToolsActivePort'),
      path.join(home, '.config/microsoft-edge/DevToolsActivePort'),
    ];
  }

  if (platform === 'win32') {
    return [
      path.join(
        localAppData,
        'Citro Labs/ego lite/User Data/DevToolsActivePort',
      ),
      path.join(localAppData, 'Citro Labs/ego/User Data/DevToolsActivePort'),
      path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
      path.join(localAppData, 'Google/Chrome SxS/User Data/DevToolsActivePort'),
      path.join(localAppData, 'Chromium/User Data/DevToolsActivePort'),
      path.join(localAppData, 'Microsoft/Edge/User Data/DevToolsActivePort'),
      path.join(
        localAppData,
        'Microsoft/Edge Beta/User Data/DevToolsActivePort',
      ),
      path.join(
        localAppData,
        'Microsoft/Edge Dev/User Data/DevToolsActivePort',
      ),
      path.join(
        localAppData,
        'Microsoft/Edge SxS/User Data/DevToolsActivePort',
      ),
      path.join(
        localAppData,
        'BraveSoftware/Brave-Browser/User Data/DevToolsActivePort',
      ),
    ];
  }

  return [];
}

/**
 * 寻找并验证 TCP 探活通过的 DevToolsActivePort。
 */
export async function findActiveDevToolsPort(options?: {
  userDataDir?: string;
  expectedPort?: number;
  checkLiveness?: boolean;
}): Promise<{port: number; wsPath: string} | null> {
  const checkLiveness = options?.checkLiveness ?? true;
  for (const filePath of getDevToolsActivePortPaths(options?.userDataDir)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      const lines = content.split('\n').filter(Boolean);
      const port = parseInt(lines[0] ?? '', 10);
      const wsPath = (lines[1] ?? '').trim();
      if (port > 0 && port < 65536 && wsPath.startsWith('/')) {
        if (options?.expectedPort && port !== options.expectedPort) {
          continue;
        }
        if (checkLiveness) {
          const ok = await checkPort(port);
          if (!ok) {
            logger.debug(
              `[findActiveDevToolsPort] 端口 ${port} (${filePath}) 无法响应，跳过`,
            );
            continue;
          }
        }
        logger.debug(
          `[findActiveDevToolsPort] 发现活跃调试端口：${port}${wsPath} (${filePath})`,
        );
        return {port, wsPath};
      }
    } catch {
      // 文件不存在或不可读，继续尝试下一个
    }
  }
  return null;
}

/**
 * Pure-file reader for `DevToolsActivePort`. Returns the first profile whose
 * file is well-formed, or `null` if none are.
 */
export function readDevToolsActivePort(
  userDataDirOrOptions?: string | {userDataDir?: string; expectedPort?: number},
  expectedPortParam?: number,
): {
  port: number;
  wsPath: string;
} | null {
  const userDataDir =
    typeof userDataDirOrOptions === 'string'
      ? userDataDirOrOptions
      : userDataDirOrOptions?.userDataDir;
  const expectedPort =
    typeof userDataDirOrOptions === 'object'
      ? userDataDirOrOptions.expectedPort
      : expectedPortParam;

  for (const filePath of getDevToolsActivePortPaths(userDataDir)) {
    try {
      const lines = fs
        .readFileSync(filePath, 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean);
      const port = parseInt(lines[0] ?? '', 10);
      const wsPath = (lines[1] ?? '').trim();
      if (port > 0 && port < 65536 && wsPath.startsWith('/')) {
        if (expectedPort && port !== expectedPort) {
          continue;
        }
        return {port, wsPath};
      }
    } catch {
      // 文件不存在或不可读，继续尝试下一个
    }
  }
  return null;
}

/**
 * 发现 Chrome 调试端口
 * 1. 读取 DevToolsActivePort 文件（跨平台）
 * 2. 扫描常见端口 [9222, 9229, 9333]
 * 3. 使用 TCP 探测避免触发 Chrome 安全弹窗
 */
export async function discoverChromeDebugPort(options?: {
  userDataDir?: string;
}): Promise<{
  port: number;
  wsPath?: string;
} | null> {
  // 1. 尝试读取 DevToolsActivePort 文件并探活
  const active = await findActiveDevToolsPort({
    userDataDir: options?.userDataDir,
  });
  if (active) {
    return {port: active.port, wsPath: active.wsPath};
  }

  // 2. 扫描常见端口
  const commonPorts = [9222, 9229, 9333];
  for (const port of commonPorts) {
    const ok = await checkPort(port);
    if (ok) {
      logger.debug(
        `[discoverChromeDebugPort] 扫描发现 Chrome 调试端口：${port}`,
      );
      return {port, wsPath: undefined};
    }
  }

  return null;
}

/**
 * 通过 HTTP 端点获取 WebSocket 调试 URL
 */
async function getWsEndpointFromHttp(
  browserURL: string,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  try {
    const response = await fetchImpl(`${browserURL}/json/version`);
    if (!response.ok) {
      return undefined;
    }
    const payload = (await response.json()) as {
      webSocketDebuggerUrl?: string;
    };
    return payload.webSocketDebuggerUrl;
  } catch {
    return undefined;
  }
}

/**
 * 探测候选列表中的第一个可用浏览器端点
 */
async function probeCandidates(
  candidates: string[],
  fetchImpl: typeof fetch,
): Promise<{browserURL: string; wsEndpoint?: string} | undefined> {
  for (const candidate of candidates) {
    const wsEndpoint = await getWsEndpointFromHttp(candidate, fetchImpl);
    if (wsEndpoint !== undefined) {
      return {browserURL: candidate, wsEndpoint};
    }
  }
  return undefined;
}

export async function resolveAutoConnectTarget(options?: {
  candidates?: string[];
  fetchImpl?: typeof fetch;
  userDataDir?: string;
}): Promise<{browserURL: string; wsEndpoint?: string} | undefined> {
  const fetchImpl = options?.fetchImpl ?? fetch;

  // 1. 如果提供了 candidates 参数，优先使用 candidates（测试模式）
  if (options?.candidates && options.candidates.length > 0) {
    return probeCandidates(options.candidates, fetchImpl);
  }

  // 2. 自动发现 Chrome 调试端口（生产模式）
  const discovered = await discoverChromeDebugPort({
    userDataDir: options?.userDataDir,
  });
  if (discovered) {
    const {port, wsPath} = discovered;
    const browserURL = `http://127.0.0.1:${port}`;

    // 尝试获取完整的 WebSocket URL
    try {
      const response = await fetchImpl(`${browserURL}/json/version`);
      if (response.ok) {
        const payload = (await response.json()) as {
          webSocketDebuggerUrl?: string;
        };
        return {
          browserURL,
          wsEndpoint:
            payload.webSocketDebuggerUrl || wsPath
              ? `ws://127.0.0.1:${port}${wsPath || '/devtools/browser'}`
              : undefined,
        };
      }
    } catch {
      // ignore — handled by wsPath fallback below
    }

    // /json/version 失败（404/网络错）。Chrome 144+/147+ 在 Way 1 模式下
    // 故意禁用了 HTTP /json/* 发现端点，但 DevToolsActivePort 文件里的
    // wsPath 仍可直连。`discoverChromeDebugPort` 已经验证过 TCP 端口可达，
    // 这里再读一次 wsPath 合成 ws:// 端点，绕过 Playwright 的二次探测。
    const active = await findActiveDevToolsPort({
      userDataDir: options?.userDataDir,
      expectedPort: port,
    });
    if (active && active.port === port && active.wsPath) {
      logger.debug(
        `[resolveAutoConnectTarget] /json/version unavailable, using DevToolsActivePort wsPath for port ${port}`,
      );
      return {
        browserURL,
        wsEndpoint: `ws://127.0.0.1:${port}${active.wsPath}`,
      };
    }
    return {browserURL};
  }

  // 3. 回退到默认候选列表
  const defaultCandidates = [
    'http://127.0.0.1:9222',
    'http://127.0.0.1:9223',
    'http://127.0.0.1:9224',
    'http://127.0.0.1:9225',
  ];

  return probeCandidates(defaultCandidates, fetchImpl);
}
