/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Daemon 模式入口：由 src/index.ts 调用。
 * 单向引导链：配置播种 → BrowserManager + SessionContext → ToolAdapter →
 * 本地 IPC 管道监听 → 写会话注册表（零 getRuntime() 依赖，ADR-0008）。
 */

import {existsSync, rmSync} from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import {defaultConfigLocator} from '../config/ConfigLocator.js';
import {
  loadUserConfigFile,
  parseConfigFile,
} from '../config/ConfigParser.js';
import {ConfigWatcher} from '../config/ConfigWatcher.js';
import {loadCachedRuntimeConfig} from '../config/runtimeConfigPersistence.js';
import {getRuntimeConfigStore} from '../config/RuntimeConfigStore.js';
import {type GlobalConfig} from '../config/schema.js';
import {ServerConfig} from '../config/ServerConfig.js';
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
  readPackageVersion,
  saveSessionFile,
  type SessionFile,
} from '../ipc/registry.js';
import {PROTOCOL_VERSION} from '../ipc/socketConnection.js';
import {BrowserManager} from '../modules/browser/index.js';
import {
  ensureToolsMeta,
  getAllToolsMeta,
  getToolMeta,
} from '../tools/tools-meta.js';

import {connectBrowser} from './BrowserConnectionManager.js';
import {JobStore} from './JobStore.js';
import {SessionContext} from './SessionContext.js';
import {ToolAdapter} from './ToolAdapter.js';
import {parseWorkerArgs} from './WorkerArgs.js';
import {createGracefulShutdown} from './WorkerLifecycle.js';

export interface DaemonRunResult {
  handle: DaemonHandle;
  stop: () => Promise<void>;
}

/**
 * 播种分层配置（`CLI > 配置文件 > 持久化运行缓存`）：
 * - 显式 `--config <path>` 按严格模式解析并校验冲突；
 * - 未显式传 `--config` 时，通过 `ConfigLocator` 自动发现用户级配置文件；
 * - 绑定分层 `ServerConfig` 到 `RuntimeConfigStore`，以支持 `--watch-config` 热重载保留 CLI 优先级。
 */
export function seedConfig(plan: DaemonPlan): GlobalConfig {
  const cachedArgs = loadCachedRuntimeConfig() ?? {};
  const cliConfig = parseWorkerArgs(plan.spawnFlags);
  const cliSeed: GlobalConfig = {...cliConfig};
  if (plan.minimalStealth) {
    cliSeed.browser = {...(cliSeed.browser ?? {}), minimalStealth: true};
  }

  const explicitConfigPath = cliConfig.config
    ? path.resolve(cliConfig.config)
    : undefined;
  const configPath = explicitConfigPath ?? defaultConfigLocator.locate();
  const fileArgs = explicitConfigPath
    ? parseConfigFile(explicitConfigPath, undefined, {strict: true})
    : configPath
      ? loadUserConfigFile(configPath)
      : {};

  const serverConfig = ServerConfig.create({
    cliArgs: cliSeed,
    fileArgs,
    cachedArgs,
    configPath,
    validate: Boolean(explicitConfigPath),
  });
  getRuntimeConfigStore().setServerConfig(serverConfig);
  return cliConfig;
}

/**
 * 若启用 `--watch-config` 且存在已定位的配置文件，启动热重载监听：
 * - 仅应用 `reloadable: true` 的配置变更，保留 CLI 高优先级覆盖；
 * - 对需重启才能生效的变更打印告警日志。
 */
export function startDaemonConfigWatcher(
  serverConfig: ServerConfig | undefined,
): ConfigWatcher | undefined {
  if (!serverConfig?.resolved.watchConfig || !serverConfig.configPath) {
    return undefined;
  }
  const watchPath = serverConfig.configPath;
  const watcher = new ConfigWatcher(watchPath, async content => {
    const nextFileArgs = parseConfigFile(watchPath, content, {strict: true});
    const candidate = serverConfig.withFileArgs(nextFileArgs);
    const restartRequired = serverConfig.getRestartRequiredChanges(candidate);
    if (restartRequired.length > 0) {
      console.warn(
        `[Daemon] 配置项 ${restartRequired.join(', ')} 的变更需要重启 daemon 后生效`,
      );
    }
    const merged = serverConfig.mergeReloadable(candidate);
    serverConfig.commit(merged);
    getRuntimeConfigStore().setServerConfig(serverConfig);
  });
  try {
    watcher.start();
    return watcher;
  } catch (err) {
    console.warn(`[Daemon] 启动配置文件监听失败 (${watchPath}):`, err);
    watcher.dispose();
    return undefined;
  }
}

async function isSocketResponsive(socketPath: string): Promise<boolean> {
  try {
    const testSocket = net.connect(socketPath);
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
    return true;
  } catch {
    return false;
  }
}

export async function runDaemon(plan: DaemonPlan): Promise<DaemonRunResult> {
  const version = readPackageVersion('0.0.0');
  const info = computeClientInfo(process.cwd(), version);

  // 1. 同一会话排他性防重：已有响应中 daemon 则退出，僵尸进程则清理接管
  const existing = await loadSessionFile(info, plan.session);
  if (existing && existing.config.pid !== process.pid) {
    if (isPidAlive(existing.config.pid)) {
      if (await isSocketResponsive(existing.config.socketPath)) {
        console.warn(
          `[Daemon] 会话 ${plan.session} 已有活跃 daemon 进程 (pid=${existing.config.pid}) 在运行，当前重复实例 (pid=${process.pid}) 退出`,
        );
        process.exit(0);
      }
      console.warn(
        `[Daemon] 会话 ${plan.session} 的旧 daemon 进程 (pid=${existing.config.pid}) 无响应，清理并接管`,
      );
      killPidForce(existing.config.pid);
    }
    await deleteSessionFile(existing).catch(() => undefined);
  }

  const startedAt = Date.now();
  seedConfig(plan);
  const configWatcher = startDaemonConfigWatcher(
    getRuntimeConfigStore().getServerConfig(),
  );

  // 2. 直接构造两层聚合根 SessionContext（无 getRuntime() 全局旁路）
  const browserManager = BrowserManager.getInstance(getBrowserManagerConfig());
  const session = new SessionContext();
  session.setBrowserManager(browserManager);
  await session.init();

  session.setBrowserConnector(async () => {
    await connectBrowser(session, getBrowserManagerConfig());
    return session.getBrowser();
  });

  const toolAdapter = new ToolAdapter(session);
  await ensureToolsMeta().catch(err =>
    console.warn('[Daemon] ensureToolsMeta 失败:', err),
  );

  const jobStore = new JobStore();
  const wsHub = new WsHub();

  const unsubscribeToolInvoke = toolAdapter.onInvoke(event => {
    wsHub.broadcast('tool.invoke', event);
  });
  const hookStore = session.getHookManager().getHookStore();
  const onSampleListener = (hookId: string, sample: unknown) => {
    wsHub.broadcast(
      'hook.sample',
      {hookId, ...(sample as object)},
      sub => !sub.filter?.hookId || sub.filter.hookId === hookId,
    );
  };
  hookStore.events.on('sample', onSampleListener);

  const socketPath = makePipePath(info.workspaceDirHash, plan.session);
  const gracefulShutdown = createGracefulShutdown({
    browserManager,
    contextProvider: session,
  });

  const state: {sessionFile?: SessionFile; handle?: DaemonHandle} = {};
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    configWatcher?.dispose();
    unsubscribeToolInvoke();
    hookStore.events.off('sample', onSampleListener);
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
      contextProvider: session,
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

  // 监听成功之后写 session 文件，防止注册表指向未监听的管道
  state.sessionFile = await saveSessionFile(info, {
    name: plan.session,
    version,
    protocol: PROTOCOL_VERSION,
    timestamp: Date.now(),
    socketPath,
    pid: process.pid,
    workspaceDir: info.workspaceDir,
  });

  // 就绪通知（兼容既有测试与外部脚本监听）
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
