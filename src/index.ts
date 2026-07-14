/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker — Rpc Worker 进程入口
 *
 * 职责：
 * 1. 解析 CLI 参数
 * 2. 初始化 BrowserManager (连接/启动浏览器)
 * 3. 初始化 ToolContextProvider
 * 4. 经 HTTP /api/v1 暴露工具执行能力
 * 5. 进入运行状态，等待 HTTP 请求
 */

import './utils/logger.js';

import {resolveConfig} from './config.js';
import {getRuntime} from './runtime.js';
import {dbService} from './services/DatabaseService.js';
import {ConsoleServer} from './web/ConsoleServer.js';
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
  // 1. 解析 CLI 参数并通过 config.ts 合并配置（CLI > 环境变量 > 配置文件 > 默认值）
  const cliConfig = parseWorkerArgs(process.argv.slice(2));
  const resolved = resolveConfig(cliConfig);
  const options = toWorkerOptions(resolved);

  // 暴露 RPC 连接信息给 ConsoleServer（Phase 3 启动时读取）
  workerStartContext.group = options.group;
  workerStartContext.rpcHost = options.rpcHost;

  console.log('[Worker] 启动中...');
  console.log(`[Worker] Rpc Host: ${options.rpcHost}`);
  console.log(`[Worker] Group: ${options.group}`);

  if (options.databaseUrl) {
    await dbService.connect(options.databaseUrl);
    await dbService.migrate();
    console.log('[Worker] 数据库已连接并完成迁移');
  }

  // 2. 初始化聚合 Runtime（统一创建 BrowserManager、Collector、LLM 等）
  const runtime = getRuntime();

  // 3. 确保浏览器已连接并获取 BrowserContext
  const browser = await runtime.browserManager.ensureBrowser();
  const browserContext =
    runtime.browserManager.getContext() ?? browser.contexts()[0] ?? null;

  // 4. 将 Runtime 注入 ToolContextProvider，复用同一套服务实例
  const contextProvider = new ToolContextProvider(runtime);
  runtime.contextProvider = contextProvider;
  if (browserContext) {
    contextProvider.setContext(browserContext);
  }
  await contextProvider.init();

  // 5. 创建 ToolAdapter（HTTP 模式用 executeTool 供 /api/v1 复用）
  const toolAdapter = new ToolAdapter(contextProvider);

  console.log(
    '[Worker] HTTP 传输模式：等待 /api/v1 请求（已移除 Sekiro 路径）',
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
