#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// eslint-disable @typescript-eslint/no-explicit-any

import fs from 'node:fs';
import {createServer, type Server} from 'node:net';
import path from 'node:path';
import process from 'node:process';

import {logger} from '../logger.js';
import {NetworkCollector} from '../PageCollector.js';
import {SkillRunner, getBuiltInSkillDefinitions} from '../skills/index.js';
import {PipeTransport} from '../third_party/index.js';
import {getJSHookRuntime} from '../tools/runtime.js';
import type {JSHookToolDefinition} from '../tools/ToolRegistry.js';

import type {DaemonMessage} from './types.js';
import {
  getDaemonPid,
  getPidFilePath,
  getSocketPath,
  IS_WINDOWS,
  isDaemonRunning,
} from './utils.js';

logger('[DAEMON] Module loading...');

// 技能系统导入 - 懒加载

logger('[DAEMON] Modules loaded, checking existing daemon...');

const pid = getDaemonPid();
if (isDaemonRunning(pid)) {
  logger('Daemon already running (PID: ' + pid + ')');
  logger('如需重启，请执行：js-reverse stop');
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

// 解析 CLI 参数并设置环境变量
function parseDaemonArgs(args: string[]) {
  let browserUrl: string | undefined;
  let wsEndpoint: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--browserUrl' && args[i + 1]) {
      browserUrl = args[i + 1];
      i++;
    } else if (args[i] === '--wsEndpoint' && args[i + 1]) {
      wsEndpoint = args[i + 1];
      i++;
    }
  }

  // 设置环境变量供 runtime 使用
  if (browserUrl) {
    process.env.REMOTE_DEBUGGING_URL = browserUrl;
    logger(`[DAEMON] Set REMOTE_DEBUGGING_URL=${browserUrl}`);
  }
  if (wsEndpoint) {
    process.env.WS_ENDPOINT = wsEndpoint;
    logger(`[DAEMON] Set WS_ENDPOINT=${wsEndpoint}`);
  }

  return {browserUrl, wsEndpoint};
}

parseDaemonArgs(mcpServerArgs);

// 懒加载状态
let _toolsLoaded = false;
let _loadToolsPromise: Promise<void> | null = null;
let _cachedToolsList: JSHookToolDefinition[] | null = null;

// 全局 NetworkCollector 实例（daemon 级别初始化）
let _networkCollector: NetworkCollector | null = null;

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
    logger(`[DAEMON] Registered ${_cachedToolsList.length} tools`);
  })();
  return _loadToolsPromise;
}

/**
 * 获取工具列表（懒加载 + 缓存）
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

async function getCachedTools(): Promise<any[]> {
  if (_cachedToolsList) {
    return _cachedToolsList;
  }
  await ensureToolsLoaded();
  return _cachedToolsList || [];
}

logger('[DAEMON] Skill registry ready (lazy load)');

let server: Server | null = null;

// 预先建立浏览器连接（避免首次调用工具时连接失败）
// 在 socket 服务器启动后异步执行，不阻塞主事件循环
async function ensureBrowserConnection() {
  try {
    logger('[DAEMON] Establishing browser connection...');
    const runtime = getJSHookRuntime();
    await runtime.browserManager.launch();
    logger('[DAEMON] Browser connected successfully');

    // 初始化 NetworkCollector（网络请求数据收集）
    const browser = runtime.browserManager.getBrowser();
    if (browser) {
      // 类型转换：绕过 puppeteer 类型不匹配问题
      _networkCollector = new NetworkCollector(browser, undefined, false);
      await _networkCollector.init();
      logger('[DAEMON] NetworkCollector initialized');
    }
  } catch (error) {
    logger('[DAEMON] Failed to connect browser:', error);
  }
}

// 在 socket 服务器启动后开始连接浏览器
setTimeout(() => void ensureBrowserConnection(), 100);

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

      logger(`[DAEMON] invoke_tool: ${tool}`, args);
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

      // 预获取页面列表（支持同步调用）
      let cachedPages: any[] = [];
      try {
        const browser = runtime.browserManager.getBrowser();
        if (browser) {
          cachedPages = await browser.pages();
        }
      } catch {
        // Ignore errors
      }

      // 如果当前没有选中页面，自动选择第一个可用页面
      if (!runtime.browserManager.getCurrentPage() && cachedPages.length > 0) {
        runtime.browserManager.setCurrentPage(cachedPages[0]);
        logger('[DAEMON] Auto-selected first page:', cachedPages[0].url());
      }

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
        setIncludeNetworkRequests: (value: boolean, _options?: any) => {
          response._includeNetwork = value;
        },
        setIncludeConsoleData: (value: boolean, _options?: any) => {
          response._includeConsole = value;
        },
        attachImage: (data: any) => {
          response._imageData = data;
        },
        attachNetworkRequest: (_id: number) => {
          /* no-op */
        },
        attachConsoleMessage: (_id: number) => {
          /* no-op */
        },
      };

      const context: any = {
        // 实现 Context 接口所需的方法
        getPageByIdx: async (idx: number) => {
          if (!cachedPages[idx]) throw new Error(`Page ${idx} not found`);
          return cachedPages[idx];
        },
        // 使用预缓存的页面列表（同步返回，避免 Promise 问题）
        getPages: () => cachedPages,
        getSelectedPage: () => runtime.browserManager.getCurrentPage(),
        selectPage: (page: any) => runtime.browserManager.setCurrentPage(page),
        newPage: async () => await runtime.browserManager.newPage(),
        closePage: async (idx: number) => {
          const pages = await context.getPages();
          if (pages[idx]) await pages[idx].close();
        },
        // 其他需要的存根方法
        getSelectedFrame: () => undefined,
        selectFrame: () => {
          /* no-op */
        },
        resetSelectedFrame: () => {
          /* no-op */
        },
        isPageSelected: (page: any) =>
          runtime.browserManager.getCurrentPage() === page,
        setNetworkConditions: () => {
          /* no-op */
        },
        setCpuThrottlingRate: () => {
          /* no-op */
        },
        saveTemporaryFile: async () => ({filename: ''}),
        saveFile: async () => ({filename: ''}),
        waitForEventsAfterAction: async () => {
          /* no-op */
        },
        waitForTextOnPage: async () => false,
        isRunningPerformanceTrace: () => false,
        setIsRunningPerformanceTrace: () => {
          /* no-op */
        },
        recordedTraces: () => [],
        storeTraceRecording: () => {
          /* no-op */
        },
        getDialog: () => undefined,
        clearDialog: () => {
          /* no-op */
        },
        getDebugger: () => null,
        getCachedTrafficSummary: () => null,
        getWebSocketById: () => null,
        getNetworkRequestById: () => null,
        getConsoleMessageById: () => null,
        getFrameByIdx: () => null,
        getDevToolsBackendNodeId: () => null,
        getDevToolsFrameId: () => null,
        // 网络工具所需方法 - 返回空对象表示 DevTools 未激活
        getDevToolsData: async () => ({}),
        resolveCdpRequestId: () => undefined,
        debuggerContext: {
          pause: async () => {
            /* no-op */
          },
          resume: async () => {
            /* no-op */
          },
          stepInto: async () => {
            /* no-op */
          },
          stepOver: async () => {
            /* no-op */
          },
          stepOut: async () => {
            /* no-op */
          },
          setBreakpoint: async () => ({breakpointId: ''}),
          removeBreakpoint: async () => {
            /* no-op */
          },
          getScriptSource: async () => '',
        },
        getRequestInitiator: () => undefined,
        getRequestInitiatorById: () => undefined,
        // 网络请求数据获取 - 从 NetworkCollector 获取实际数据
        getNetworkRequests: (includePreserved?: boolean) => {
          const page = runtime.browserManager.getCurrentPage();
          if (!page || !_networkCollector) return [];
          return _networkCollector.getData(page, includePreserved);
        },
      };

      await targetTool.handler(request, response, context, runtime);

      // 构建返回结果
      const resultData: any = {};
      if (response._includePages) {
        const pages = await context.getPages();
        // 直接从 Chrome DevTools 端点获取页面信息
        const remoteDebuggingUrl =
          process.env.REMOTE_DEBUGGING_URL || 'http://127.0.0.1:9222';
        const jsonUrl = `${remoteDebuggingUrl}/json`;
        let chromePages: any[] = [];
        try {
          const res = await fetch(jsonUrl);
          chromePages = await res.json();
        } catch {
          // Ignore fetch errors silently
        }

        resultData.pages = pages.map((p: any, i: number) => {
          // 尝试匹配 Puppeteer page 和 Chrome /json 返回的页面
          let matchedPage: any | undefined;
          const pageUrl = p.url?.() || p.url || '';
          if (pageUrl) {
            matchedPage = chromePages.find(cp => cp.url === pageUrl);
          }

          return {
            index: i,
            title: matchedPage?.title || p.title || '',
            url: matchedPage?.url || pageUrl,
            webSocketDebuggerUrl: matchedPage?.webSocketDebuggerUrl || '',
          };
        });
      }
      // 处理网络请求数据
      if (response._includeNetwork) {
        const page = runtime.browserManager.getCurrentPage();
        if (page && _networkCollector) {
          // 使用 NetworkCollector 收集的实际数据
          const requests = _networkCollector.getData(page, false);
          resultData.networkRequests = requests.map(
            (req: any, idx: number) => ({
              id: idx,
              url: req.url(),
              method: req.method(),
              type: req.resourceType(),
            }),
          );
          resultData.text = `收集到 ${requests.length} 个网络请求`;
        } else if (page) {
          resultData.text = 'NetworkCollector 未初始化';
        } else {
          resultData.text = '没有选中的页面';
        }
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
      const tools = await getCachedTools();
      logger(
        `[DAEMON] list_tools: ${tools.length} tools (cached: ${_cachedToolsList !== null})`,
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
  logger('[DAEMON] startSocketServer: starting...');
  // Remove existing socket file if it exists (only on non-Windows)
  if (!IS_WINDOWS) {
    try {
      fs.unlinkSync(socketPath);
      logger('[DAEMON] startSocketServer: cleaned up old socket file');
    } catch {
      // ignore errors.
    }
  }

  return await new Promise<void>((resolve, reject) => {
    logger('[DAEMON] startSocketServer: creating server...');
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

    logger('[DAEMON] startSocketServer: calling server.listen()...');
    server.listen(
      {
        path: socketPath,
        readableAll: false,
        writableAll: false,
      },
      () => {
        logger(`Daemon server listening on ${socketPath}`);
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
  logger('Cleaning up daemon...');

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
// 忽略 SIGHUP 信号，防止父进程退出时意外触发 cleanup
process.on('SIGHUP', () => {
  logger('Received SIGHUP, ignoring');
});

// Handle uncaught errors
process.on('uncaughtException', error => {
  logger('Uncaught exception:', error);
});
process.on('unhandledRejection', error => {
  logger('Unhandled rejection:', error);
});

// Start the server
logger('[DAEMON] About to call startSocketServer()');
startSocketServer()
  .then(() => {
    logger('[DAEMON] startSocketServer resolved successfully');
  })
  .catch(error => {
    logger('[DAEMON] startSocketServer failed:', error);
    process.exit(1);
  });
logger('[DAEMON] startSocketServer called, process should stay alive');

// Keep the process running - the server will handle connections via event loop
