/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';

import {resolveConfig} from '../../config.js';
import {parseArgs, getFlag, getBoolFlag} from '../args-parser.js';
import {openInBrowser} from '../open-browser.js';
import {successOutput} from '../output.js';
import {SekiroInvoker} from '../sekiro-invoker.js';
import type {WorkerContext} from '../types.js';

const DEFAULT_CONSOLE_PORT = 8765;

function findWebDistRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (existsSync(join(dir, 'package.json'))) {
      return resolve(dir, 'apps/web/dist');
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const BROWSER_POLL_ATTEMPTS = 60;
const BROWSER_POLL_INTERVAL_MS = 500;
const BROWSER_FETCH_TIMEOUT_MS = 3000;

async function waitForBrowserReachable(browserUrl: string): Promise<void> {
  for (let attempt = 1; attempt <= BROWSER_POLL_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(`${browserUrl}/json/version`, {
        signal: AbortSignal.timeout(BROWSER_FETCH_TIMEOUT_MS),
      });
      if (resp.ok) return;
    } catch {
      // not ready yet
    }
    if (attempt < BROWSER_POLL_ATTEMPTS) {
      await new Promise(resolve =>
        setTimeout(resolve, BROWSER_POLL_INTERVAL_MS),
      );
    }
  }
  throw new AxiError(
    `等待浏览器连接超时 (${(BROWSER_POLL_ATTEMPTS * BROWSER_POLL_INTERVAL_MS) / 1000}s)`,
    'BROWSER_TIMEOUT',
    [
      `确认 Chrome 已启动并监听：${browserUrl}`,
      '需要启动标志：--remote-debugging-port=9222',
      '示例：chrome --remote-debugging-port=9222',
    ],
  );
}

export const startCommand: AxiCliCommand<WorkerContext> = async (args, ctx) => {
  const parsed = parseArgs(args);
  const browserUrl = getFlag(parsed, 'browserUrl');
  const wsEndpoint = getFlag(parsed, 'wsEndpoint');
  const headless = getBoolFlag(parsed, 'headless');
  const executablePath = getFlag(parsed, 'executablePath');
  const databaseUrl = getFlag(parsed, 'databaseUrl');
  const waitForBrowser = getBoolFlag(parsed, 'wait-for-browser');
  const cloak = getBoolFlag(parsed, 'cloak');
  const jsStealth = getBoolFlag(parsed, 'js-stealth');
  const fullStealthArgs = getBoolFlag(parsed, 'full-stealth-args');
  const traceOutput = getFlag(parsed, 'traceOutput') as
    | 'errors'
    | 'all'
    | undefined;

  // 合并配置：CLI 参数 > 环境变量 > 配置文件 > 默认值
  const cfg = resolveConfig({
    rpcHost: getFlag(parsed, 'rpcHost') || ctx?.resolvedConfig.rpcHost,
    group: getFlag(parsed, 'group') || ctx?.resolvedConfig.group,
    browserUrl: browserUrl || ctx?.resolvedConfig.browserUrl,
    wsEndpoint: wsEndpoint || ctx?.resolvedConfig.wsEndpoint,
    headless: headless || undefined,
    executablePath: executablePath || ctx?.resolvedConfig.executablePath,
    databaseUrl: databaseUrl || ctx?.resolvedConfig.databaseUrl,
    cloak: cloak || ctx?.resolvedConfig.cloak,
    jsStealth: jsStealth || ctx?.resolvedConfig.jsStealth,
    fullStealthArgs: fullStealthArgs || ctx?.resolvedConfig.fullStealthArgs,
  });

  // 1. 检查 Sekiro Server 是否可用
  const invoker = ctx?.invoker ?? new SekiroInvoker({rpcHost: cfg.rpcHost});
  const serverAvailable = await invoker.isServerAvailable();
  if (!serverAvailable) {
    throw new AxiError(
      `Sekiro Server 不可用: ${cfg.rpcHost} (HTTP: ${invoker.getHttpUrl()})`,
      'SEKIRO_UNAVAILABLE',
      [
        '请先启动 rpc-go Server',
        '下载地址: https://github.com/yint-tech/rpc-go',
        '默认启动: ./rpc-go --port 5612',
        `确认端口监听: netstat -ano | findstr "${cfg.rpcHost.split(':').pop()}"`,
      ],
    );
  }

  // 2. 检查 Worker 是否已在运行
  const workerManager = ctx?.workerManager;
  if (workerManager?.isRunning()) {
    throw new AxiError('Worker 已经在运行中', 'WORKER_ALREADY_RUNNING', [
      '如需重启，请先执行：browsercli stop',
    ]);
  }

  // 3. spawn Worker 进程
  if (workerManager) {
    await workerManager.start({
      rpcHost: cfg.rpcHost,
      group: cfg.group,
      browserUrl: cfg.browserUrl,
      wsEndpoint: cfg.wsEndpoint,
      headless: cfg.headless,
      executablePath: cfg.executablePath,
      databaseUrl: cfg.databaseUrl,
      cloak: cfg.cloak,
      jsStealth: cfg.jsStealth,
      fullStealthArgs: cfg.fullStealthArgs,
      traceOutput,
    });
  }

  // 4. 等待浏览器连接（如果指定）
  if (waitForBrowser && cfg.browserUrl) {
    await waitForBrowserReachable(cfg.browserUrl);
  }

  // 5. 轮询等待 Worker 注册到 Sekiro Server
  const workerReady = await waitForWorkerRegistered(invoker, cfg.group);
  if (!workerReady) {
    throw new AxiError(
      'Worker 启动后未能注册到 Sekiro Server',
      'WORKER_REGISTER_TIMEOUT',
    );
  }

  // 6. 自动打开 Web 控制台（除非显式 --no-open）
  const noOpen = getBoolFlag(parsed, 'no-open');
  const consolePort =
    parseInt(getFlag(parsed, 'console-port') ?? '', 10) || DEFAULT_CONSOLE_PORT;
  const consoleUrl = `http://127.0.0.1:${consolePort}`;
  let consoleOpened = false;
  let consoleHint: string | undefined;

  if (!noOpen) {
    const distRoot = findWebDistRoot();
    if (distRoot && existsSync(join(distRoot, 'index.html'))) {
      consoleOpened = openInBrowser(consoleUrl);
    } else {
      consoleHint =
        '前台资源未构建，运行 `npm run web:build` 后再启动，或访问 http://127.0.0.1:5173 (Vite 开发模式)';
    }
  }

  return successOutput({
    command: 'start',
    message: 'Worker 启动成功，已连接到 Sekiro Server',
    rpcHost: cfg.rpcHost,
    group: cfg.group,
    consoleUrl,
    consoleOpened,
    ...(consoleHint && {consoleHint}),
    ...(waitForBrowser &&
      cfg.browserUrl && {browserUrl: cfg.browserUrl, waitedForBrowser: true}),
  });
};

/**
 * 等待 Worker 注册到 Sekiro Server
 */
async function waitForWorkerRegistered(
  invoker: SekiroInvoker,
  group: string,
  maxAttempts = 20,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = (await invoker.listClients(group)) as {
        data?: unknown[];
        clients?: unknown[];
        status?: number;
      };
      // Sekiro clientQueue 返回格式: {data: [...], status: 0}
      const clientList = result.data ?? result.clients;
      if (Array.isArray(clientList) && clientList.length > 0) {
        return true;
      }
    } catch {
      // ignore
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}
