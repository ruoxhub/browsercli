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
 * 4. 创建 NodeClient，连接到 Sekiro Server
 * 5. 通过 ToolAdapter 注册所有 Tools 为 Sekiro Actions
 * 6. 进入运行状态，等待 Server 转发请求
 */

import {BrowserManager} from './browser/index.js';
import type {BrowserManagerConfig} from './browser/index.js';
import {resolveConfig, getEnvBoolean} from './config.js';
import type {GlobalConfig} from './config.js';
import {NodeClient} from './protocol/Client.js';
import {dbService} from './services/DatabaseService.js';
import type {WorkerStartOptions} from './types/platform.js';
import {ToolAdapter} from './worker/ToolAdapter.js';
import {ToolContextProvider} from './worker/ToolContextProvider.js';

// 优雅关闭
let isShuttingDown = false;

async function gracefulShutdown(
  client: NodeClient,
  browserManager: BrowserManager,
  signal: string,
): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[Worker] 收到 ${signal}，开始优雅关闭...`);

  // 1. 断开 Sekiro 连接（Server 自动路由到其他 Worker）
  client.disconnect();

  // 2. 等待当前 Action 完成（最多 10s）
  // Sekiro 断开后不会再有新请求进来，当前执行的 handler 自然完成

  // 3. 关闭浏览器连接
  try {
    await browserManager.close();
    console.log('[Worker] 浏览器已关闭');
  } catch (err) {
    console.error('[Worker] 关闭浏览器失败:', err);
  }

  // 4. 关闭数据库连接
  try {
    await dbService.disconnect();
    console.log('[Worker] 数据库连接已关闭');
  } catch (err) {
    console.error('[Worker] 关闭数据库连接失败:', err);
  }

  console.log('[Worker] 已关闭');
  process.exit(0);
}

/**
 * 解析 Worker 命令行参数为 GlobalConfig 格式
 */
function parseWorkerArgs(args: string[]): GlobalConfig {
  const cliConfig: GlobalConfig = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--sekiroHost':
        cliConfig.sekiroHost = args[++i];
        break;
      case '--group':
        cliConfig.group = args[++i];
        break;
      case '--browserUrl':
        cliConfig.browserUrl = args[++i];
        break;
      case '--wsEndpoint':
        cliConfig.wsEndpoint = args[++i];
        break;
      case '--headless':
        cliConfig.headless = true;
        break;
      case '--executablePath':
        cliConfig.executablePath = args[++i];
        break;
      case '--databaseUrl':
        cliConfig.databaseUrl = args[++i];
        break;
    }
  }

  return cliConfig;
}

/**
 * 将 ResolvedConfig 转换为 WorkerStartOptions
 */
function toWorkerOptions(
  resolved: ReturnType<typeof resolveConfig>,
): WorkerStartOptions {
  return {
    sekiroHost: resolved.sekiroHost,
    group: resolved.group,
    browserUrl: resolved.browserUrl,
    wsEndpoint: resolved.wsEndpoint,
    headless: resolved.headless,
    executablePath: resolved.executablePath,
    databaseUrl: resolved.databaseUrl,
  };
}

/**
 * 注册内置 Action（_list_tools, _list_skills, _status）
 */
function registerBuiltinActions(client: NodeClient): void {
  // _list_tools — 返回所有已注册的 Tool 名称
  client.registerAction('_list_tools', async (_request, resolve, _reject) => {
    const {getAllToolNames, getToolMeta} = await import('./cli/tools-meta.js');
    const tools = getAllToolNames().map(name => {
      const meta = getToolMeta(name);
      return {name, description: meta?.description || ''};
    });
    resolve({tools});
  });

  // // _list_skills — 兼容旧客户端：技能已迁移为 Tool，返回对应 Tool 列表
  // client.registerAction('_list_skills', async (_request, resolve, _reject) => {
  //   const {getConvertedSkillToolDefinitions} =
  //     await import('./cli/converted-skill-tools.js');
  //   resolve({skills: getConvertedSkillToolDefinitions()});
  // });

  // _status — 返回 Worker 状态
  client.registerAction('_status', (_request, resolve, _reject) => {
    resolve({
      pid: process.pid,
      status: client.getStatus(),
      uptime: process.uptime(),
    });
  });
}

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

  // 3. 创建 NodeClient
  const client = new NodeClient({
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
  process.on('SIGTERM', () =>
    gracefulShutdown(client, browserManager, 'SIGTERM'),
  );
  process.on('SIGINT', () =>
    gracefulShutdown(client, browserManager, 'SIGINT'),
  );
}

main().catch(err => {
  console.error('[Worker] 启动失败:', err);
  process.exit(1);
});
