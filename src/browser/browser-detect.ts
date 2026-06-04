/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';

import {logger} from '../utils/logger.js';

interface BrowserInfo {
  name: string;
  path: string;
}

/**
 * macOS/Linux 浏览器候选路径
 */
const UNIX_BROWSER_CANDIDATES: BrowserInfo[] = [
  // macOS
  {
    name: 'Chrome (macOS)',
    path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  },
  {
    name: 'Edge (macOS)',
    path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  },
  // Linux
  {name: 'Chrome (linux)', path: '/usr/bin/google-chrome'},
  {name: 'Chrome (linux)', path: '/usr/bin/google-chrome-stable'},
  {name: 'Chromium (linux)', path: '/usr/bin/chromium-browser'},
  {name: 'Chromium (linux)', path: '/usr/bin/chromium'},
  {name: 'Edge (linux)', path: '/usr/bin/microsoft-edge'},
];

/**
 * Windows 浏览器路径模板
 */
const WINDOWS_BROWSER_TEMPLATES = [
  {
    name: 'Chrome',
    paths: [
      'Google\\Chrome\\Application\\chrome.exe',
      'Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
  },
  {
    name: 'Edge',
    paths: [
      'Microsoft\\Edge\\Application\\msedge.exe',
      'Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
  },
] as const;

/**
 * 检测所有可用浏览器
 */
export function detectAllBrowsers(browserPath?: string): BrowserInfo[] {
  // 使用配置的浏览器路径（如果指定）
  if (browserPath) {
    try {
      if (fs.existsSync(browserPath)) {
        return [{name: 'Custom Browser', path: browserPath}];
      }
    } catch {
      // 忽略错误，继续使用默认检测
    }
  }

  // Unix 平台
  if (process.platform !== 'win32') {
    return UNIX_BROWSER_CANDIDATES.filter(candidate =>
      fs.existsSync(candidate.path),
    );
  }

  // Windows: 扫描常见驱动器号
  const foundBrowsers: BrowserInfo[] = [];
  const driveLetters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  for (const drive of driveLetters) {
    for (const template of WINDOWS_BROWSER_TEMPLATES) {
      for (const browserPath of template.paths) {
        const fullPath = `${drive}:\\${browserPath}`;
        if (fs.existsSync(fullPath)) {
          foundBrowsers.push({
            name: `${template.name} (${drive}:)`,
            path: fullPath,
          });
        }
      }
    }
  }

  return foundBrowsers;
}

/**
 * 启动浏览器进程并等待就绪
 */
export async function launchBrowserProcess(
  port: number,
  browserPath: string,
  waitForBrowser: (port: number) => Promise<void>,
): Promise<void> {
  logger.debug(`Launching browser: ${browserPath}`);
  logger.debug(`Remote debugging port: ${port}`);

  const {spawn} = await import('node:child_process');
  const browserProcess = spawn(
    browserPath,
    [
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    {
      detached: true,
      stdio: 'ignore',
    },
  );

  browserProcess.unref();

  await waitForBrowser(port);
  logger.debug('Browser launched successfully');
}

/**
 * 等待浏览器就绪（轮询 /json/version）
 */
export async function waitForBrowserReady(
  port: number,
  timeoutMs: number,
  pollMs: number,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // 浏览器尚未就绪，重试
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }

  throw new Error('Browser failed to start within timeout');
}
