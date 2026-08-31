/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {existsSync, readFileSync, createReadStream, lstatSync} from 'node:fs';
import {createServer, type Server as HttpServer} from 'node:http';
import {resolve, join, extname, relative, isAbsolute, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {WebSocketServer} from 'ws';

import type {Runtime} from '../runtime.js';
import {
  ensureToolsMeta,
  getAllToolNames,
  getAllToolsMeta,
  getToolMeta,
} from '../tools/tools-meta.js';
import {logger} from '../utils/logger.js';
import {JobStore} from '../worker/JobStore.js';
import type {SekiroInvoker} from '../worker/SekiroInvoker.js';
import type {ToolAdapter} from '../worker/ToolAdapter.js';

import {InvocationStore} from './adapters/InvocationStore.js';
import {bearerAuth} from './middleware/bearerAuth.js';
import {rejectIfNotLocal} from './middleware/localOnly.js';
import {RestRouter} from './RestRouter.js';
import {createApiV1Routes} from './routes/apiV1.js';
import {createConfigRoutes} from './routes/config.js';
import {createHookRoutes} from './routes/hooks.js';
import {createInvocationsRoutes} from './routes/invocations.js';
import {createProxyRoutes} from './routes/proxy.js';
import {createSessionRoutes} from './routes/session.js';
import {createToolsRoutes} from './routes/tools.js';
import {createWorkerRoutes, type WorkerRoutesConfig} from './routes/worker.js';
import {WsHub} from './ws/WsHub.js';

export interface ConsoleServerOptions {
  port: number;
  host?: string;
  group: string;
  rpcHost: string;
  runtime: Runtime;
  invoker: SekiroInvoker;
  toolAdapter: ToolAdapter;
  apiToken?: string;
  jobStore?: JobStore;
}

// 调用方未显式注入时使用的兜底实例（保持 /api/v1 路由可挂载）。
let defaultJobStore: JobStore | undefined;
function getDefaultJobStore(): JobStore {
  defaultJobStore ??= new JobStore();
  return defaultJobStore;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

export class ConsoleServer {
  private readonly options: ConsoleServerOptions;
  private readonly invocationStore = new InvocationStore();
  private readonly wsHub = new WsHub();
  private readonly router = new RestRouter();
  private readonly startedAt = Date.now();
  private readonly projectRoot: string;

  private httpServer?: HttpServer;
  private wsServer?: WebSocketServer;
  private unsubscribeToolInvoke?: () => void;
  private onSampleListener?: (hookId: string, sample: unknown) => void;
  private onProxyCaptureListener?: (record: any) => void;

  constructor(options: ConsoleServerOptions) {
    this.options = options;
    this.projectRoot = this.findProjectRoot();
    this.setupRoutes();
  }

  private findProjectRoot(): string {
    let dir = dirname(fileURLToPath(import.meta.url));
    while (true) {
      if (existsSync(join(dir, 'package.json'))) {
        return dir;
      }
      const parent = dirname(dir);
      if (parent === dir) {
        return process.cwd();
      }
      dir = parent;
    }
  }

  private setupRoutes(): void {
    let version = '0.0.0';
    try {
      const pkgContent = readFileSync(
        join(this.projectRoot, 'package.json'),
        'utf-8',
      );
      const pkg = JSON.parse(pkgContent);
      version = pkg.version || '0.0.0';
    } catch {
      // ignore
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const workerConfig: WorkerRoutesConfig = {
      runtime: this.options.runtime,
      contextProvider: this.options.runtime.contextProvider,
      group: this.options.group,
      rpcHost: this.options.rpcHost,
      version,
      startedAt: this.startedAt,
      get browserMode(): string {
        try {
          const ctxProvider = self.options.runtime.contextProvider;
          const browser =
            ctxProvider?.getBrowser() ??
            self.options.runtime.browserManager.getBrowser();
          return browser?.version() ?? 'CDP';
        } catch {
          return 'CDP';
        }
      },
    };

    this.router.mount(
      createWorkerRoutes(workerConfig, () => getAllToolNames().length),
    );
    this.router.mount(
      createConfigRoutes({
        contextProvider: this.options.runtime.contextProvider!,
        wsHub: this.wsHub,
      }),
    );
    this.router.mount(
      createToolsRoutes({
        toolAdapter: this.options.toolAdapter,
        invocations: this.invocationStore,
      }),
    );
    this.router.mount(
      createInvocationsRoutes({
        store: this.invocationStore,
      }),
    );
    this.router.mount(createHookRoutes(this.options.toolAdapter));
    this.router.mount(
      createProxyRoutes(this.options.runtime.mitmModule, this.wsHub),
    );
    this.router.mount(
      createSessionRoutes(() => {
        const engine = this.options.runtime.captureEngine;
        const manager = this.options.runtime.captureSessionManager;
        if (!engine || !manager) return undefined;
        return {
          manager,
          store: engine.getStore(),
          llmService: this.options.runtime.llmService,
          getFileByUrl: (url: string) =>
            this.options.runtime.collector.getFileByUrl(url) ?? null,
        };
      }),
    );
    this.router.mount(
      createApiV1Routes({
        contextProvider: this.options.runtime.contextProvider!,
        toolAdapter: this.options.toolAdapter,
        jobStore: this.options.jobStore ?? getDefaultJobStore(),
        wsHub: this.wsHub,
        getToolMeta: name => getToolMeta(name),
        listToolsMeta: () => getAllToolsMeta(),
        ensureToolsMeta,
      }),
    );
    void ensureToolsMeta().catch(err =>
      console.warn('[ConsoleServer] ensureToolsMeta 失败:', err),
    );
  }

  async start(): Promise<void> {
    if (this.httpServer) {
      return;
    }

    // 1. 创建 HTTP Server 并处理请求
    this.httpServer = createServer(async (req, res) => {
      try {
        const pathname = (req.url ?? '').split('?')[0] || '/';

        // /api/v1/* 豁免本地校验，改走 Bearer Token 认证
        if (pathname.startsWith('/api/v1/')) {
          if (
            bearerAuth(req, res, {
              apiToken: this.options.apiToken,
              bindHost: this.options.host ?? '127.0.0.1',
            })
          ) {
            return;
          }
        } else if (rejectIfNotLocal(req, res)) {
          return;
        }

        // 尝试 REST 路由分发
        const handled = await this.router.dispatch(req, res, pathname);
        if (handled) {
          return;
        }

        // 如果未命中 API，尝试读取静态资源
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
          res.end('Not Found');
          return;
        }

        const staticRoot = resolve(this.projectRoot, 'build/web');
        const filePath = join(staticRoot, pathname);

        // 防止目录穿越防御
        const rel = relative(staticRoot, filePath);
        if (rel.startsWith('..') || isAbsolute(rel)) {
          res.writeHead(403, {'Content-Type': 'text/plain; charset=utf-8'});
          res.end('Forbidden');
          return;
        }

        let fileExists = false;
        try {
          if (existsSync(filePath) && lstatSync(filePath).isFile()) {
            fileExists = true;
          }
        } catch {
          // ignore
        }

        if (fileExists) {
          const ext = extname(filePath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          res.writeHead(200, {'Content-Type': contentType});
          createReadStream(filePath).pipe(res);
          return;
        }

        // SPA (Single Page Application) Fallback 支持
        const isApiRequest = pathname.startsWith('/api/');
        const hasExtension = extname(pathname) !== '';
        if (!isApiRequest && !hasExtension) {
          const indexPath = join(staticRoot, 'index.html');
          if (existsSync(indexPath)) {
            res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
            createReadStream(indexPath).pipe(res);
            return;
          }
        }

        res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
        res.end('Not Found');
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8'});
          res.end(err instanceof Error ? err.message : String(err));
        }
      }
    });

    // 2. 启动 WebSocket Server
    this.wsServer = new WebSocketServer({server: this.httpServer});
    this.wsServer.on('connection', ws => {
      ws.on('message', data => {
        try {
          this.wsHub.handleClientMessage(ws, data.toString());
        } catch (err) {
          console.error('[ConsoleServer] WS message handling error:', err);
        }
      });
      ws.on('close', () => {
        this.wsHub.handleDisconnect(ws);
      });
      ws.on('error', () => {
        this.wsHub.handleDisconnect(ws);
      });
    });

    // 3. WS 桥接逻辑订阅
    this.unsubscribeToolInvoke = this.options.toolAdapter.onInvoke(event => {
      this.wsHub.broadcast('tool.invoke', event);
    });

    const hookStore = this.options.runtime.hookManager?.getHookStore?.();
    if (hookStore) {
      this.onSampleListener = (hookId: string, sample: unknown) => {
        this.wsHub.broadcast(
          'hook.sample',
          {hookId, ...(sample as object)},
          sub => !sub.filter?.hookId || sub.filter.hookId === hookId,
        );
      };
      hookStore.events.on('sample', this.onSampleListener);
    }

    const proxyStore = this.options.runtime.mitmModule?.getStore?.();
    if (proxyStore) {
      this.onProxyCaptureListener = (record: any) => {
        this.wsHub.broadcast('proxy.request', {
          id: record.id,
          method: record.method,
          url: record.url,
          statusCode: record.statusCode,
          contentType: record.contentType,
          timestamp: record.timestamp,
        });
      };
      proxyStore.events.on('capture', this.onProxyCaptureListener);
    }

    // Session 抓包摘要桥接（spec §8）。
    // 白名单之外的 type（session.hook / session.snapshot）显式记日志 ——
    // 它们来自 engine 的 ingestHook/ingestSnapshot，切片 2 不注册这两个频道，
    // 静默丢弃要显式化，否则"忘了注册"和"没数据"看起来一模一样。
    //
    // 用 warn 而非 debug：logger 的默认级别是 info（src/utils/logger.ts:289），
    // debug() 会被 shouldLog()（:151-153）短路成空操作，除非显式设 LOG_LEVEL=debug
    // ——那正是"静默"本身，与 spec §8 的意图相反。ingestHook/ingestSnapshot 当前
    // 无人调用，用 warn 不会刷屏；等它们真的接上、日志变吵时再降回 debug。
    this.options.runtime.captureEngine?.setEmitToWs(event => {
      if (event.type !== 'session.request') {
        logger.warn(`[ConsoleServer] 忽略未注册的 session 事件: ${event.type}`);
        return;
      }
      if (this.wsHub.getSubscriberCount('session.request') === 0) return;
      this.wsHub.broadcast('session.request', event.payload);
    });

    // 4. 开启监听（host 可配置，默认 127.0.0.1）
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(
        this.options.port,
        this.options.host ?? '127.0.0.1',
        () => {
          resolve();
        },
      );
      this.httpServer!.once('error', async err => {
        await this.stop();
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    // 1. 取消桥接订阅，解绑事件监听，防止内存泄露
    if (this.unsubscribeToolInvoke) {
      this.unsubscribeToolInvoke();
      this.unsubscribeToolInvoke = undefined;
    }
    if (this.onSampleListener) {
      const hookStore = this.options.runtime.hookManager?.getHookStore?.();
      hookStore?.events.off('sample', this.onSampleListener);
      this.onSampleListener = undefined;
    }
    if (this.onProxyCaptureListener) {
      const proxyStore = this.options.runtime.mitmModule?.getStore?.();
      proxyStore?.events.off('capture', this.onProxyCaptureListener);
      this.onProxyCaptureListener = undefined;
    }
    this.options.runtime.captureEngine?.setEmitToWs(undefined);

    // 2. 关闭所有活动的 WebSocket 并销毁 ws 服务
    if (this.wsServer) {
      for (const client of this.wsServer.clients) {
        try {
          client.terminate();
        } catch {
          // ignore
        }
      }
      const wss = this.wsServer;
      await new Promise<void>(resolve => {
        wss.close(() => resolve());
      });
      this.wsServer = undefined;
    }

    // 3. 关闭 HTTP Server 资源
    if (this.httpServer) {
      const server = this.httpServer;
      await new Promise<void>(resolve => {
        server.close(() => resolve());
      });
      this.httpServer = undefined;
    }
  }
}
