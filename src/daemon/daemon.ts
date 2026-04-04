#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import {createServer, type Server} from 'node:net';
import path from 'node:path';
import process from 'node:process';

import {logger} from '../logger.js';
import {PipeTransport} from '../third_party/index.js';
import type {DaemonMessage} from './types.js';
import type {JSHookToolDefinition} from '../tools/ToolRegistry.js';
import {
  getDaemonPid,
  getPidFilePath,
  getSocketPath,
  IS_WINDOWS,
  isDaemonRunning,
} from './utils.js';

console.log('[DAEMON] Module loading...');

// 技能系统导入 - 懒加载
import {
  SkillRegistry,
  SkillRunner,
  getBuiltInSkillDefinitions,
} from '../skills/index.js';
import {logger as skillLogger} from '../utils/logger.js';

console.log('[DAEMON] Modules loaded, checking existing daemon...');

const pid = getDaemonPid();
if (isDaemonRunning(pid)) {
  console.error('Daemon 已经在运行中 (PID: ' + pid + ')');
  console.error('如需重启，请先执行：js-reverse stop');
  process.exit(1);
}

const pidFilePath = getPidFilePath();
fs.mkdirSync(path.dirname(pidFilePath), {
  recursive: true,
});
fs.writeFileSync(pidFilePath, process.pid.toString());
logger(`Writing ${process.pid.toString()} to ${pidFilePath}`);

const socketPath = getSocketPath();

const startDate = new Date();
const mcpServerArgs = process.argv.slice(2);

// 懒加载状态
let _skillRegistry: SkillRegistry | null = null;
let _toolsLoaded = false;
let _loadToolsPromise: Promise<void> | null = null;
let _cachedToolsList: any[] | null = null;

/**
 * 懒加载技能注册表
 */
function getSkillRegistry(): SkillRegistry {
  if (!_skillRegistry) {
    _skillRegistry = SkillRegistry.getInstance();
  }
  return _skillRegistry;
}

/**
 * 懒加载工具注册
 */
async function ensureToolsLoaded(): Promise<void> {
  if (_toolsLoaded) {
    return;
  }
  if (_loadToolsPromise) {
    return _loadToolsPromise;
  }
  _loadToolsPromise = (async () => {
    const {registerBuiltInTools, listTools} = await import('../tools/index.js');
    registerBuiltInTools();
    _toolsLoaded = true;
    _cachedToolsList = listTools();
    console.log(`[DAEMON] Registered ${_cachedToolsList.length} tools`);
  })();
  return _loadToolsPromise;
}

/**
 * 获取工具列表（懒加载 + 缓存）
 */
async function getCachedTools(): Promise<any[]> {
  if (_cachedToolsList) {
    return _cachedToolsList;
  }
  await ensureToolsLoaded();
  return _cachedToolsList || [];
}

// 懒加载技能注册（同步，不依赖重型模块）
console.log('[DAEMON] Skill registry ready (lazy load)');

let server: Server | null = null;

async function handleRequest(msg: DaemonMessage) {
  try {
    if (msg.method === 'invoke_skill') {
      const {skill, args = {}} = msg;
      if (!skill) {
        return {success: false, error: 'Missing skill name'};
      }

      const runner = new SkillRunner();
      const result = await runner.run(skill, {
        url: (args.url as string) || undefined,
        options: args,
      });

      return {
        success: result.success,
        result: JSON.stringify(result),
      };
    } else if (msg.method === 'invoke_tool') {
      const {tool, args = {}} = msg;
      if (!tool) {
        return {success: false, error: 'Missing tool name'};
      }

      console.log(`[DAEMON] invoke_tool: ${tool}`, args);
      const tools = await getCachedTools();
      const targetTool = tools.find(t => t.name === tool);
      if (!targetTool) {
        return {
          success: false,
          error: `Tool not found: ${tool}`,
        };
      }

      // 构建工具调用的参数
      const {getJSHookRuntime} = await import('../tools/runtime.js');
      const runtime = getJSHookRuntime();

      const request = {params: args};
      const response: any = {
        _lines: [] as string[],
        _includePages: false,
        _includeNetwork: false,
        _includeConsole: false,
        _imageData: null,
        appendResponseLine: (line: string) => {
          response._lines.push(line);
        },
        setIncludePages: (value: boolean) => {
          response._includePages = value;
        },
        setIncludeNetworkRequests: (value: boolean, options?: any) => {
          response._includeNetwork = value;
        },
        setIncludeConsoleData: (value: boolean, options?: any) => {
          response._includeConsole = value;
        },
        attachImage: (data: any) => {
          response._imageData = data;
        },
        attachNetworkRequest: (id: number) => {},
        attachConsoleMessage: (id: number) => {},
      };

      const context: any = {
        // 实现 Context 接口所需的方法
        getPageByIdx: async (idx: number) => {
          const browser = runtime.browserManager.getBrowser();
          if (!browser) throw new Error('Browser not connected');
          const pages = await browser.pages();
          if (!pages[idx]) throw new Error(`Page ${idx} not found`);
          return pages[idx];
        },
        getPages: async () => {
          const browser = runtime.browserManager.getBrowser();
          if (!browser) return [];
          return await browser.pages();
        },
        getSelectedPage: () => runtime.browserManager.getCurrentPage(),
        selectPage: (page: any) => runtime.browserManager.setCurrentPage(page),
        newPage: async () => await runtime.browserManager.newPage(),
        closePage: async (idx: number) => {
          const pages = await context.getPages();
          if (pages[idx]) await pages[idx].close();
        },
        // 其他需要的存根方法
        getSelectedFrame: () => undefined,
        selectFrame: () => {},
        resetSelectedFrame: () => {},
        isPageSelected: (page: any) =>
          runtime.browserManager.getCurrentPage() === page,
        setNetworkConditions: () => {},
        setCpuThrottlingRate: () => {},
        saveTemporaryFile: async () => ({filename: ''}),
        saveFile: async () => ({filename: ''}),
        waitForEventsAfterAction: async () => {},
        waitForTextOnPage: async () => false,
        isRunningPerformanceTrace: () => false,
        setIsRunningPerformanceTrace: () => {},
        recordedTraces: () => [],
        storeTraceRecording: () => {},
        getDialog: () => undefined,
        clearDialog: () => {},
        getDebugger: () => null,
        getCachedTrafficSummary: () => null,
        getWebSocketById: () => null,
        getNetworkRequestById: () => null,
        getConsoleMessageById: () => null,
        getFrameByIdx: () => null,
        getDevToolsBackendNodeId: () => null,
        getDevToolsFrameId: () => null,
      };

      await targetTool.handler(request, response, context);

      // 构建返回结果
      let resultData: any = {};
      if (response._includePages) {
        const pages = await context.getPages();
        resultData.pages = pages.map((p: any, i: number) => ({
          index: i,
          title: p.title,
          url: p.url,
        }));
      }
      if (response._lines.length > 0) {
        resultData.text = response._lines.join('\n');
      }

      return {
        success: true,
        result: JSON.stringify(resultData),
      };
    } else if (msg.method === 'list_skills') {
      const skills = getBuiltInSkillDefinitions();
      return {
        success: true,
        result: JSON.stringify({
          skills: skills.map(s => ({
            name: s.name,
            description: s.description,
            category: s.category,
          })),
        }),
      };
    } else if (msg.method === 'list_tools') {
      console.log('[DAEMON] list_tools called');
      const tools = await getCachedTools();
      console.log(
        `[DAEMON] Got ${tools.length} tools (cached: ${_cachedToolsList !== null})`,
      );
      return {
        success: true,
        result: JSON.stringify({
          tools: tools.map(t => ({
            name: t.name,
            description: t.description,
            category: t.annotations.category,
          })),
        }),
      };
    } else if (msg.method === 'stop') {
      setImmediate(() => {
        void cleanup();
      });
      return {
        success: true,
        message: 'stopping',
      };
    } else if (msg.method === 'status') {
      return {
        success: true,
        result: JSON.stringify({
          pid: process.pid,
          socketPath,
          startDate: startDate.toISOString(),
          args: mcpServerArgs,
        }),
      };
    }
    return {
      success: false,
      error: `Unknown method: ${msg.method}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

async function startSocketServer() {
  console.log('[DAEMON] startSocketServer: starting...');
  // Remove existing socket file if it exists (only on non-Windows)
  if (!IS_WINDOWS) {
    try {
      fs.unlinkSync(socketPath);
      console.log('[DAEMON] startSocketServer: cleaned up old socket file');
    } catch {
      // ignore errors.
    }
  }

  return await new Promise<void>((resolve, reject) => {
    console.log('[DAEMON] startSocketServer: creating server...');
    server = createServer(socket => {
      const transport = new PipeTransport(socket, socket);
      transport.onmessage = async (message: string) => {
        logger('onmessage', message);
        const response = await handleRequest(JSON.parse(message));
        transport.send(JSON.stringify(response));
        socket.end();
      };
      socket.on('error', error => {
        logger('Socket error:', error);
      });
    });

    console.log('[DAEMON] startSocketServer: calling server.listen()...');
    server.listen(
      {
        path: socketPath,
        readableAll: false,
        writableAll: false,
      },
      () => {
        console.log(`Daemon server listening on ${socketPath}`);
        resolve();
      },
    );

    server.on('error', error => {
      logger('Server error:', error);
      reject(error);
    });
  });
}

async function cleanup() {
  console.log('Cleaning up daemon...');

  if (server) {
    await new Promise<void>(resolve => {
      server!.close(() => resolve());
    });
  }
  if (!IS_WINDOWS) {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // ignore errors
    }
  }
  logger(`unlinking ${pidFilePath}`);
  if (fs.existsSync(pidFilePath)) {
    fs.unlinkSync(pidFilePath);
  }
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGTERM', () => {
  void cleanup();
});
process.on('SIGINT', () => {
  void cleanup();
});
process.on('SIGHUP', () => {
  void cleanup();
});

// Handle uncaught errors
process.on('uncaughtException', error => {
  logger('Uncaught exception:', error);
});
process.on('unhandledRejection', error => {
  logger('Unhandled rejection:', error);
});

// Start the server
console.log('[DAEMON] About to call startSocketServer()');
startSocketServer()
  .then(() => {
    console.log('[DAEMON] startSocketServer resolved successfully');
  })
  .catch(error => {
    console.error('[DAEMON] startSocketServer failed:', error);
    process.exit(1);
  });
console.log('[DAEMON] startSocketServer called, process should stay alive');

// Keep the process running - the server will handle connections via event loop
