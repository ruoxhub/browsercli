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

import {existsSync, readFileSync, rmSync} from 'node:fs';
import net from 'node:net';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {loadCachedRuntimeConfig} from '../config/runtimeConfigPersistence.js';
import {getRuntimeConfigStore} from '../config/RuntimeConfigStore.js';
import {type GlobalConfig} from '../config/schema.js';
import {getBrowserManagerConfig} from '../config/servicesConfig.js';
import type {DaemonPlan} from '../ipc/daemonArgs.js';
import {startDaemonServer, type DaemonHandle} from '../ipc/daemonServer.js';
import {WsHub} from '../ipc/eventHub.js';
import {
  computeClientInfo,
  deleteSessionFile,
  isPidAlive,
  killPidForce,
  loadSessionFile,
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

import {connectBrowser} from './BrowserConnectionManager.js';
import {JobStore} from './JobStore.js';
import {ToolAdapter} from './ToolAdapter.js';
import {ToolContextProvider} from './ToolContext.js';
import {parseWorkerArgs} from './WorkerArgs.js';
import {createGracefulShutdown} from './WorkerLifecycle.js';

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
  const info = computeClientInfo(process.cwd(), version);

  // 1. 同一会话排他性防重：检测已有实例，避免同一 session 启动多个 daemon 进程
  const existing = await loadSessionFile(info, plan.session);
  if (existing && existing.config.pid !== process.pid) {
    if (isPidAlive(existing.config.pid)) {
      let isResponsive = false;
      try {
        const testSocket = net.connect(existing.config.socketPath);
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => {
            testSocket.destroy();
            reject(new Error('timeout'));
          }, 1500);
          testSocket.once('connect', () => {
            clearTimeout(t);
            testSocket.destroy();
            resolve();
          });
          testSocket.once('error', err => {
            clearTimeout(t);
            reject(err);
          });
        });
        isResponsive = true;
      } catch {
        isResponsive = false;
      }

      if (isResponsive) {
        console.warn(
          `[Daemon] 会话 ${plan.session} 已有活跃 daemon 进程 (pid=${existing.config.pid}) 在运行，当前重复实例 (pid=${process.pid}) 退出`,
        );
        process.exit(0);
      } else {
        console.warn(
          `[Daemon] 会话 ${plan.session} 的旧 daemon 进程 (pid=${existing.config.pid}) 无响应，清理并接管`,
        );
        killPidForce(existing.config.pid);
        await deleteSessionFile(existing).catch(() => undefined);
      }
    } else {
      await deleteSessionFile(existing).catch(() => undefined);
    }
  }

  const startedAt = Date.now();
  seedConfig(plan);

  const runtime = getRuntime();
  const contextProvider = new ToolContextProvider(runtime);
  runtime.contextProvider = contextProvider;
  await contextProvider.init();

  contextProvider.setBrowserConnector(async () => {
    await connectBrowser(contextProvider, getBrowserManagerConfig());
    return contextProvider.getBrowser();
  });

  const toolAdapter = new ToolAdapter(contextProvider);
  await ensureToolsMeta().catch(err =>
    console.warn('[Daemon] ensureToolsMeta 失败:', err),
  );

  const jobStore = new JobStore();
  const wsHub = new WsHub();

  const unsubscribeToolInvoke = toolAdapter.onInvoke(event => {
    wsHub.broadcast('tool.invoke', event);
  });
  const hookStore = runtime.hookManager?.getHookStore?.();
  const onSampleListener = (hookId: string, sample: unknown) => {
    wsHub.broadcast(
      'hook.sample',
      {hookId, ...(sample as object)},
      sub => !sub.filter?.hookId || sub.filter.hookId === hookId,
    );
  };
  if (hookStore) {
    hookStore.events.on('sample', onSampleListener);
  }

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
    unsubscribeToolInvoke();
    if (hookStore) {
      hookStore.events.off('sample', onSampleListener);
    }
    if (state.sessionFile) {
      await deleteSessionFile(state.sessionFile).catch(() => undefined);
    }
    await state.handle?.close().catch(() => undefined);
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
  process.on('exit', () => {
    if (state.sessionFile?.file && existsSync(state.sessionFile.file)) {
      try {
        rmSync(state.sessionFile.file, {force: true});
      } catch {
        // 忽略退出清理错误
      }
    }
  });

  return {handle: state.handle!, stop};
}
