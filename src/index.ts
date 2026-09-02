/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker — Rpc Worker 进程入口
 *
 * 职责：
 * 1. 解析 CLI 参数并播种 RuntimeConfigStore
 * 2. 初始化 Runtime（创建 BrowserManager 实例但不自动连接）
 * 3. 初始化 ToolContextProvider（未连接状态）
 * 4. 经 HTTP /api/v1 暴露工具执行能力
 * 5. 启动 Web 控制台，浏览器由面板显式触发连接
 */

import {
  loadCachedRuntimeConfig,
  shouldAutoConnectOnStartup,
} from './config/runtimeConfigPersistence.js';
import {getRuntimeConfigStore} from './config/RuntimeConfigStore.js';
import {getBrowserManagerConfig} from './config/servicesConfig.js';
import {resolveConfig} from './config.js';
import {getRuntime} from './runtime.js';
import {ConsoleServer} from './web/ConsoleServer.js';
import {connectBrowser} from './worker/BrowserConnectionManager.js';
import {JobStore} from './worker/JobStore.js';
import {SekiroInvoker} from './worker/SekiroInvoker.js';
import {ToolAdapter} from './worker/ToolAdapter.js';
import {ToolContextProvider} from './worker/ToolContext.js';
import {parseWorkerArgs, toWorkerOptions} from './worker/WorkerArgs.js';
import {createGracefulShutdown} from './worker/WorkerLifecycle.js';

/**
 * Worker 启动上下文：暴露 main() 解析后的连接信息，
 * 供 ConsoleServer 启动时读取。
 *
 * 仅 main() 内部赋值；外部模块只读不写。
 */
export const workerStartContext: {
  group?: string;
  rpcHost?: string;
} = {};

/**
 * Worker 主函数
 */
async function main(): Promise<void> {
  // 1. 解析 CLI 参数，播种 RuntimeConfigStore（CLI > env > 默认值）
  const cliConfig = parseWorkerArgs(process.argv.slice(2));
  getRuntimeConfigStore().update(cliConfig);
  // 回填上次持久化的连接设置（仅填充 CLI/env 未覆盖的可写字段）
  const cached = loadCachedRuntimeConfig();
  if (cached) {
    getRuntimeConfigStore().update(cached);
  }

  // 2. 解析启动选项（rpcHost/group 等启动期固定值，不随面板变更）
  const resolved = resolveConfig(cliConfig);
  const options = toWorkerOptions(resolved);

  // 暴露 RPC 连接信息给 ConsoleServer（Phase 3 启动时读取）
  workerStartContext.group = options.group;
  workerStartContext.rpcHost = options.rpcHost;

  console.log('[Worker] 启动中...');
  console.log(`[Worker] Rpc Host: ${options.rpcHost}`);
  console.log(`[Worker] Group: ${options.group}`);

  // 3. 初始化聚合 Runtime（创建 BrowserManager 实例但不自动连接）
  const runtime = getRuntime();

  // 4. 以未连接状态初始化 ToolContextProvider
  const contextProvider = new ToolContextProvider(runtime);
  runtime.contextProvider = contextProvider;
  await contextProvider.init();

  // 5. 有缓存连接目标（wsEndpoint/browserURL）时，启动即连接
  if (shouldAutoConnectOnStartup(getRuntimeConfigStore().get())) {
    try {
      const config = getBrowserManagerConfig();
      await connectBrowser(contextProvider, config);
      console.log('[Worker] 已按缓存连接配置自动连接浏览器');
    } catch (err) {
      console.warn(
        '[Worker] 启动自动连接浏览器失败，可稍后在控制面板手动连接:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 6. 创建 ToolAdapter（HTTP 模式用 executeTool 供 /api/v1 复用）
  const toolAdapter = new ToolAdapter(contextProvider);

  console.log(
    '[Worker] HTTP 传输模式：等待 /api/v1 请求（浏览器需从控制面板连接）',
  );

  // 启动 Web 控制台
  const noConsole = process.argv.includes('--no-console');
  const consolePortIndex = process.argv.indexOf('--console-port');
  let consolePort = 8765;
  if (consolePortIndex !== -1 && consolePortIndex + 1 < process.argv.length) {
    const portNum = parseInt(process.argv[consolePortIndex + 1], 10);
    if (!isNaN(portNum) && portNum > 0) {
      consolePort = portNum;
    }
  }

  let consoleServer: ConsoleServer | undefined;
  if (!noConsole) {
    try {
      const invoker = new SekiroInvoker({
        rpcHost: options.rpcHost,
      });
      consoleServer = new ConsoleServer({
        port: consolePort,
        host: process.env.WORKER_HOST ?? '127.0.0.1',
        group: options.group,
        rpcHost: options.rpcHost,
        runtime,
        invoker,
        toolAdapter,
        jobStore: new JobStore(),
        apiToken: process.env.WORKER_API_TOKEN,
        configSeed: cliConfig,
      });
      await consoleServer.start();
      console.log(
        `[Worker] 本地工作台 Web 控制台已启动: http://127.0.0.1:${consolePort}`,
      );
    } catch (err) {
      console.error('[Worker] 启动 Web 控制台服务失败:', err);
    }
  }

  // 9. 注册信号处理
  const gracefulShutdown = createGracefulShutdown({
    browserManager: runtime.browserManager,
    contextProvider,
  });

  const handleShutdown = async (signal: string) => {
    if (consoleServer) {
      try {
        await consoleServer.stop();
        console.log('[Worker] 控制台服务已关闭');
      } catch (err) {
        console.error('[Worker] 关闭控制台服务失败:', err);
      }
    }
    await gracefulShutdown(signal);
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

main().catch(err => {
  console.error('[Worker] 启动失败:', err);
  process.exit(1);
});
