/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker — Rpc Worker 进程入口
 *
 * 职责：
 * 1. 解析 CLI 参数
 * 2. 初始化 BrowserManager (连接/启动浏览器)
 * 3. 初始化 ToolContextProvider
 * 4. 创建 RpcClient，连接到 Rpc Server
 * 5. 通过 ToolAdapter 注册所有 Tools 为 Rpc Actions
 * 6. 进入运行状态，等待 Server 转发请求
 */

import './utils/logger.js';

import {resolveConfig} from './config.js';
import {RpcClient} from './protocol/Client.js';
import {getRuntime} from './runtime.js';
import {dbService} from './services/DatabaseService.js';
import {registerBuiltinActions} from './worker/BuiltinActions.js';
import {ToolAdapter} from './worker/ToolAdapter.js';
import {ToolContextProvider} from './worker/ToolContextProvider.js';
import {parseWorkerArgs, toWorkerOptions} from './worker/WorkerArgs.js';
import {createGracefulShutdown} from './worker/WorkerLifecycle.js';

/**
 * Worker 启动上下文：暴露 main() 解析后的 RPC 连接信息，
 * 供 Phase 3 ConsoleServer 启动时读取（SekiroInvoker 不暴露 group/rpcHost）。
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

  // 5. 创建 RpcClient
  const client = new RpcClient({
    group: options.group,
    rpcHost: options.rpcHost,
  });

  // 6. 注册内置 Actions
  registerBuiltinActions(client);

  // 7. 通过 ToolAdapter 注册所有 Tools
  const toolAdapter = new ToolAdapter(contextProvider);
  await toolAdapter.registerAll((name, handler) => {
    client.registerAction(name, handler);
  });

  // 8. 连接到 Rpc Server
  await client.start();

  console.log('[Worker] 已启动并连接到 Rpc Server');

  // 9. 注册信号处理
  const gracefulShutdown = createGracefulShutdown({
    browserManager: runtime.browserManager,
    client,
    contextProvider,
  });
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

main().catch(err => {
  console.error('[Worker] 启动失败:', err);
  process.exit(1);
});
