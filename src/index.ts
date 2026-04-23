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
 * 6. 注册 Skills 为 Sekiro Actions
 * 7. 进入运行状态，等待 Server 转发请求
 */

import {NodeClient} from './protocol/Client.js';
import type {ActionHandler} from './types/sekiro.js';
import type {WorkerStartOptions} from './types/platform.js';
import {ToolAdapter} from './worker/ToolAdapter.js';
import {ToolContextProvider} from './worker/ToolContextProvider.js';
import {BrowserManager} from './browser/index.js';
import type {BrowserManagerConfig} from './browser/index.js';

// 优雅关闭
let isShuttingDown = false;

async function gracefulShutdown(client: NodeClient, browserManager: BrowserManager, signal: string): Promise<void> {
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

  console.log('[Worker] 已关闭');
  process.exit(0);
}

/**
 * 解析 Worker 命令行参数
 */
function parseWorkerArgs(args: string[]): WorkerStartOptions {
  const options: WorkerStartOptions = {
    sekiroHost: 'ws://127.0.0.1:5612',
    group: 'js-reverse',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--sekiroHost':
        options.sekiroHost = args[++i];
        break;
      case '--group':
        options.group = args[++i];
        break;
      case '--browserUrl':
        options.browserUrl = args[++i];
        break;
      case '--wsEndpoint':
        options.wsEndpoint = args[++i];
        break;
      case '--headless':
        options.headless = true;
        break;
      case '--executablePath':
        options.executablePath = args[++i];
        break;
    }
  }

  return options;
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

  // _list_skills — 返回所有已注册的 Skill
  client.registerAction('_list_skills', async (_request, resolve, _reject) => {
    const {getBuiltInSkillDefinitions} = await import('./skills/index.js');
    const skills = getBuiltInSkillDefinitions();
    resolve({skills});
  });

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
 * 注册 Skills 为 Sekiro Actions
 */
async function registerSkills(client: NodeClient): Promise<void> {
  const {SkillRegistry} = await import('./skills/SkillRunner.js');
  const {registerBuiltInSkills} = await import('./skills/index.js');

  // 先注册所有内置技能
  registerBuiltInSkills();

  const registry = SkillRegistry.getInstance();
  const skills = registry.list();

  for (const skill of skills) {
    const actionName = `skill_${skill.name}`;
    const handler: ActionHandler = async (request, resolve, reject) => {
      const startTime = Date.now();
      try {
        const context = {
          url: (request.params?.url as string) || '',
          options: request.params,
        };
        const result = await skill.execute(context);
        const duration = Date.now() - startTime;
        console.log(`[Worker][Skill] action=${actionName} duration=${duration}ms status=${result.success ? 'ok' : 'err'}`);
        resolve(result);
      } catch (err) {
        const duration = Date.now() - startTime;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(`[Worker][Skill] action=${actionName} duration=${duration}ms status=err msg=${errMsg}`);
        reject(errMsg);
      }
    };
    client.registerAction(actionName, handler);
  }

  console.log(`[Worker] 注册了 ${skills.length} 个 Skill`);
}

/**
 * Worker 主函数
 */
async function main(): Promise<void> {
  const options = parseWorkerArgs(process.argv.slice(2));

  console.log('[Worker] 启动中...');
  console.log(`[Worker] Sekiro Host: ${options.sekiroHost}`);
  console.log(`[Worker] Group: ${options.group}`);

  // 1. 初始化 ToolContextProvider
  const contextProvider = new ToolContextProvider();

  // 2. 初始化 BrowserManager，将 Page 注入 contextProvider
  const browserConfig: BrowserManagerConfig = {
    browserURL: options.browserUrl,
    wsEndpoint: options.wsEndpoint,
    headless: options.headless,
    executablePath: options.executablePath,
    useStealthScripts: true,
  };

  const browserManager = BrowserManager.getInstance(browserConfig);
  const browser = await browserManager.ensureBrowser();
  console.log(`[Worker] 浏览器已${options.browserUrl || options.wsEndpoint ? '连接' : '启动'}: v${browser.version()}`);

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

  // 6. 注册 Skills
  await registerSkills(client);

  // 7. 连接到 Sekiro Server
  await client.start();

  console.log('[Worker] 已启动并连接到 Sekiro Server');

  // 8. 注册信号处理
  process.on('SIGTERM', () => gracefulShutdown(client, browserManager, 'SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown(client, browserManager, 'SIGINT'));
}

main().catch(err => {
  console.error('[Worker] 启动失败:', err);
  process.exit(1);
});
