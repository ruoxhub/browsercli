/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CloakBrowser 集成：源码层（C++ 二进制 patch）反检测。
 *
 * 仅在 worker 启动时传入 `--cloak` 才启用。不传时 Browser 走系统 Chrome
 * + Patchright 协议层反检测（默认路径，零 JS 注入）。
 *
 * 默认模式与 cloak 模式使用不同的持久化 profile 目录（`chrome-profile` vs
 * `cloak-profile`），因为两者是不同的 Chromium 二进制，混用 state 会引发启动
 * race 和会话崩溃。详见 browser-helpers.ts::resolveUserDataDir。
 *
 * 移植自 D:/crawler-rpc/browsercli-mcp/src/cloak.ts，仅替换 logger 路径。
 */

import {randomInt} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

interface CloakBrowserModule {
  ensureBinary(): Promise<string>;
  binaryInfo(): {installed: boolean};
}

async function loadCloakBrowser(): Promise<CloakBrowserModule> {
  try {
    return (await import('cloakbrowser')) as unknown as CloakBrowserModule;
  } catch {
    throw new Error(
      '--cloak requires the `cloakbrowser` package. ' +
        'Install it with `npm install cloakbrowser`, or re-run via ' +
        '`browsercli start --cloak` to pull it as an optional dependency.',
    );
  }
}

/**
 * Redirect `console.log` / `console.info` to stderr for the duration of `fn`.
 *
 * Browser worker 的 stdout 是 Sekiro RPC 协议通道 —— 任何非协议字节
 * 都会让 Server 端断帧、客户端掉线。cloakbrowser 的 `ensureBinary()` 把
 * 下载进度写进 `console.log`（stdout），所以必须在它运行时重定向到 stderr。
 * 进度仍然可见（stderr 会进入 worker 日志面板）。
 */
export async function withStdoutRedirectedToStderr<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const origLog = console.log;
  const origInfo = console.info;
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);
  try {
    return await fn();
  } finally {
    console.log = origLog;
    console.info = origInfo;
  }
}

function getOrCreateSeed(profileDir: string): number {
  const seedFile = path.join(profileDir, '.cloak-seed');
  if (existsSync(seedFile)) {
    const parsed = Number.parseInt(readFileSync(seedFile, 'utf8').trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, {recursive: true});
  }
  const seed = randomInt(10000, 100000);
  writeFileSync(seedFile, String(seed), 'utf8');
  return seed;
}

export interface CloakSetup {
  executablePath: string;
  args: string[];
}

/**
 * Resolve the CloakBrowser binary and build the cloak-specific args.
 *
 * 当 profileDir 存在时，指纹种子落到该目录下，让同一个 profile 永远呈现相同的
 * 虚拟身份（稳定的"回访访客"）。当 undefined（`--isolated` 模式），只生成本
 * 次启动用的随机种子。
 *
 * 始终伪装为 Windows 桌面（即便实际运行在 macOS/Linux）。CloakBrowser 在
 * Windows/Linux 上有 57 个 C++ patch，在 macOS 上只有 26 个（其 README 明确
 * 说 macOS 构建保留真实 GPU 字符串、spoof 值反而更易被识别）。对本项目的用例
 * （调试强反爬站点），完整 Windows 指纹预设是更稳的选择。
 */
export async function setupCloak(
  profileDir: string | undefined,
): Promise<CloakSetup> {
  const cloak = await loadCloakBrowser();

  const executablePath = await withStdoutRedirectedToStderr(async () => {
    if (!cloak.binaryInfo().installed) {
      process.stderr.write(
        '[browser] Downloading CloakBrowser stealth binary (~200MB, one-time setup)...\n',
      );
    }
    return cloak.ensureBinary();
  });

  const seed = profileDir
    ? getOrCreateSeed(profileDir)
    : randomInt(10000, 100000);

  const platform = 'windows';

  return {
    executablePath,
    args: [`--fingerprint=${seed}`, `--fingerprint-platform=${platform}`],
  };
}
