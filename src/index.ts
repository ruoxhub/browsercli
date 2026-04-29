/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker — Sekiro Worker 进程入口
 *
 * 职责：
 * 1. 解析 CLI 参数
 * 2. 初始化 BrowserManager (连接/启动浏览器)
 * 3. 初始化 ToolContextProvider
 * 4. 创建 RpcClient，连接到 Sekiro Server
 * 5. 通过 ToolAdapter 注册所有 Tools 为 Sekiro Actions
 * 6. 进入运行状态，等待 Server 转发请求
 */

import {BrowserManager} from './browser/index.js';
import type {BrowserManagerConfig} from './browser/index.js';
import {resolveConfig, getEnvBoolean} from './config.js';
import {RpcClient} from './protocol/Client.js';
import {dbService} from './services/DatabaseService.js';
import {registerBuiltinActions} from './worker/BuiltinActions.js';
import {ToolAdapter} from './worker/ToolAdapter.js';
import {ToolContextProvider} from './worker/ToolContextProvider.js';
import {parseWorkerArgs, toWorkerOptions} from './worker/WorkerArgs.js';
import {createGracefulShutdown} from './worker/WorkerLifecycle.js';

/**
 * Worker 主函数
 */
async function main(): Promise<void> {
  // 1. 解析 CLI 参数并通过 config.ts 合并配置（CLI > 环境变量 > 配置文件 > 默认值）
  const cliConfig = parseWorkerArgs(process.argv.slice(2));
  const resolved = resolveConfig(cliConfig);
  const options = toWorkerOptions(resolved);

  console.log('[Worker] 启动中...');
  console.log(`[Worker] Sekiro Host: ${options.sekiroHost}`);
  console.log(`[Worker] Group: ${options.group}`);

  if (options.databaseUrl) {
    await dbService.connect(options.databaseUrl);
    await dbService.migrate();
    console.log('[Worker] 数据库已连接并完成迁移');
  }

  // 2. 初始化 ToolContextProvider
  const contextProvider = new ToolContextProvider();

  // 3. 初始化 BrowserManager，将 Page 注入 contextProvider
  // 浏览器配置也从 config.ts 获取（支持 config.json / .env 等）
  const browserConfig: BrowserManagerConfig = {
    browserURL: options.browserUrl,
    wsEndpoint: options.wsEndpoint,
    headless: options.headless,
    executablePath: options.executablePath,
    useStealthScripts: getEnvBoolean('USE_STEALTH_SCRIPTS') ?? true,
  };

  const browserManager = BrowserManager.getInstance(browserConfig);
  const browser = await browserManager.ensureBrowser();
  console.log(
    `[Worker] 浏览器已${options.browserUrl || options.wsEndpoint ? '连接' : '启动'}: v${browser.version()}`,
  );

  // 获取当前页面并注入 contextProvider
  const page = await browserManager.newPage();
  const context = browser.contexts()[0] ?? page.context();
  contextProvider.setSelectedPage(page);
  contextProvider.setPages(context.pages());
  contextProvider.setBrowser(browser);
  contextProvider.setContext(context);
  contextProvider.setBrowserManager(browserManager);

  // 3. 创建 RpcClient
  const client = new RpcClient({
    group: options.group,
    sekiroHost: options.sekiroHost,
  });

  // 4. 注册内置 Actions
  registerBuiltinActions(client);

  // 5. 通过 ToolAdapter 注册所有 Tools
  const toolAdapter = new ToolAdapter(contextProvider);
  await toolAdapter.registerAll((name, handler) => {
    client.registerAction(name, handler);
  });

  // 6. 连接到 Sekiro Server
  await client.start();

  console.log('[Worker] 已启动并连接到 Sekiro Server');

  // 7. 注册信号处理
  const gracefulShutdown = createGracefulShutdown({browserManager, client});
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

main().catch(err => {
  console.error('[Worker] 启动失败:', err);
  process.exit(1);
});
