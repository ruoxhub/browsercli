/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Daemon 模式入口：由 src/index.ts 在 argv 含 `--daemon` 时调用。
 * 复用 main() 的启动序列（配置播种 → runtime → contextProvider →
 * 自动连接 → ToolAdapter），随后监听命名管道并写会话注册表。
 * stdout 的就绪行 `Daemon listening on <socketPath>` 是 CLI 的 spawn
 * 成功判据 —— 在此之前不得向 stdout 输出任何协议外内容。
 */

import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  loadCachedRuntimeConfig,
  shouldAutoConnectOnStartup,
} from '../config/runtimeConfigPersistence.js';
import {getRuntimeConfigStore} from '../config/RuntimeConfigStore.js';
import {type GlobalConfig} from '../config/schema.js';
import {getBrowserManagerConfig} from '../config/servicesConfig.js';
import type {DaemonPlan} from '../ipc/daemonArgs.js';
import {startDaemonServer, type DaemonHandle} from '../ipc/daemonServer.js';
import {
  computeClientInfo,
  deleteSessionFile,
  makePipePath,
  saveSessionFile,
  type SessionFile,
} from '../ipc/registry.js';
import {PROTOCOL_VERSION} from '../ipc/socketConnection.js';
import {getRuntime} from '../runtime.js';
import {
  ensureToolsMeta,
  getAllToolsMeta,
  getToolMeta,
} from '../tools/tools-meta.js';
import {ConsoleServer} from '../web/ConsoleServer.js';
import {WsHub} from '../web/ws/WsHub.js';

import {connectBrowser} from './BrowserConnectionManager.js';
import {JobStore} from './JobStore.js';
import {ToolAdapter} from './ToolAdapter.js';
import {ToolContextProvider} from './ToolContext.js';
import {parseWorkerArgs} from './WorkerArgs.js';
import {createGracefulShutdown} from './WorkerLifecycle.js';

const DEFAULT_CONSOLE_PORT = 8765;

export interface DaemonRunResult {
  handle: DaemonHandle;
  stop: () => Promise<void>;
}

function readPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as {
          version?: string;
        };
        if (typeof parsed.version === 'string') return parsed.version;
      } catch {
        // 损坏的 package.json 视为无版本，落回默认
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

/** 播种配置：CLI/env flag → 透传 spawnFlags → 上次持久化的连接设置。 */
function seedConfig(plan: DaemonPlan): GlobalConfig {
  const cliConfig = parseWorkerArgs(plan.spawnFlags);
  const seed: GlobalConfig = {...cliConfig};
  if (plan.minimalStealth) {
    seed.browser = {...(seed.browser ?? {}), minimalStealth: true};
  }
  getRuntimeConfigStore().update(seed);
  const cached = loadCachedRuntimeConfig();
  if (cached) {
    getRuntimeConfigStore().update(cached);
  }
  return cliConfig;
}

export async function runDaemon(plan: DaemonPlan): Promise<DaemonRunResult> {
  const version = readPackageVersion();
  const startedAt = Date.now();
  const cliConfig = seedConfig(plan);

  const runtime = getRuntime();
  const contextProvider = new ToolContextProvider(runtime);
  runtime.contextProvider = contextProvider;
  await contextProvider.init();

  // Local Apps 残留自检（spec §6.1）：上次崩溃未还原的系统代理在此清理。
  try {
    const cleaned = await runtime.mitmModule
      .getSystemProxyManager()
      .checkResidual();
    if (cleaned) {
      console.warn('[Daemon] 检测到上次会话残留的系统代理配置，已自动还原');
    }
  } catch {
    // 非 Windows 平台直接跳过
  }

  if (shouldAutoConnectOnStartup(getRuntimeConfigStore().get())) {
    try {
      await connectBrowser(contextProvider, getBrowserManagerConfig());
    } catch (err) {
      console.warn(
        '[Daemon] 启动自动连接浏览器失败，可稍后通过 browsercli browser connect 重连:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  const toolAdapter = new ToolAdapter(contextProvider);
  await ensureToolsMeta().catch(err =>
    console.warn('[Daemon] ensureToolsMeta 失败:', err),
  );

  const jobStore = new JobStore();
  const wsHub = new WsHub();

  let consoleServer: ConsoleServer | undefined;
  let consolePort: number | undefined;
  if (!plan.noConsole) {
    const preferredPort =
      plan.consolePort ??
      (plan.session === 'default' ? DEFAULT_CONSOLE_PORT : 0);
    try {
      consoleServer = new ConsoleServer({
        port: preferredPort,
        host: process.env.WORKER_HOST ?? '127.0.0.1',
        runtime,
        toolAdapter,
        configSeed: cliConfig,
        jobStore,
        wsHub,
      });
      await consoleServer.start();
      consolePort = consoleServer.getActualPort();
    } catch (err) {
      if (
        preferredPort !== 0 &&
        plan.consolePort === undefined &&
        (err as {code?: string})?.code === 'EADDRINUSE'
      ) {
        try {
          consoleServer = new ConsoleServer({
            port: 0,
            host: process.env.WORKER_HOST ?? '127.0.0.1',
            runtime,
            toolAdapter,
            configSeed: cliConfig,
            jobStore,
            wsHub,
          });
          await consoleServer.start();
          consolePort = consoleServer.getActualPort();
          console.warn(
            `[Daemon] 默认 Web 控制台端口 ${preferredPort} 被占用，已回退到临时端口: ${consolePort}`,
          );
        } catch (fallbackErr) {
          console.error('[Daemon] 启动 Web 控制台回退服务失败:', fallbackErr);
          consoleServer = undefined;
        }
      } else {
        console.error('[Daemon] 启动 Web 控制台服务失败:', err);
        consoleServer = undefined;
      }
    }
  }

  const info = computeClientInfo(process.cwd(), version);
  const socketPath = makePipePath(info.workspaceDirHash, plan.session);
  const gracefulShutdown = createGracefulShutdown({
    browserManager: runtime.browserManager,
    contextProvider,
  });

  // stop() 闭包引用晚于声明赋值的 handle/sessionFile，用对象持有以满足 prefer-const
  const state: {sessionFile?: SessionFile; handle?: DaemonHandle} = {};
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (state.sessionFile) {
      await deleteSessionFile(state.sessionFile).catch(() => undefined);
    }
    await state.handle?.close().catch(() => undefined);
    await consoleServer?.stop().catch(() => undefined);
  };

  state.handle = await startDaemonServer(
    {
      sessionName: plan.session,
      version,
      startedAt,
      contextProvider,
      toolAdapter,
      jobStore,
      wsHub,
      listToolsMeta: getAllToolsMeta,
      getToolMeta,
      onStop: async () => {
        await stop();
        await gracefulShutdown('stop');
      },
    },
    socketPath,
  );

  // 启动顺序：监听成功之后才写 session 文件，防止注册表指向未监听的管道
  state.sessionFile = await saveSessionFile(info, {
    name: plan.session,
    version,
    protocol: PROTOCOL_VERSION,
    timestamp: Date.now(),
    socketPath,
    pid: process.pid,
    workspaceDir: info.workspaceDir,
    consolePort,
  });

  // 就绪握手：stdout 精确一行，CLI 以此判定 daemon 可连接
  console.log(`Daemon listening on ${socketPath}`);

  process.on(
    'SIGINT',
    () => void stop().then(() => gracefulShutdown('SIGINT')),
  );
  process.on(
    'SIGTERM',
    () => void stop().then(() => gracefulShutdown('SIGTERM')),
  );

  return {handle: state.handle!, stop};
}
