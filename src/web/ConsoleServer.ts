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

import type {GlobalConfig} from '../config/schema.js';
import type {Runtime} from '../runtime.js';
import {ensureToolsMeta, getAllToolNames} from '../tools/tools-meta.js';
import {logger} from '../utils/logger.js';
import type {JobStore} from '../worker/JobStore.js';
import type {ToolAdapter} from '../worker/ToolAdapter.js';

import {InvocationStore} from './adapters/InvocationStore.js';
import {rejectIfNotLocal} from './middleware/localOnly.js';
import {RestRouter} from './RestRouter.js';
import {createConfigRoutes} from './routes/config.js';
import {createHookRoutes} from './routes/hooks.js';
import {createInvocationsRoutes} from './routes/invocations.js';
import {createSystemRoutes} from './routes/system.js';
import {createToolsRoutes} from './routes/tools.js';
import {createWorkerRoutes, type WorkerRoutesConfig} from './routes/worker.js';
import {WsHub} from './ws/WsHub.js';

export interface ConsoleServerOptions {
  port: number;
  host?: string;
  runtime: Runtime;
  toolAdapter: ToolAdapter;
  /**
   * 重置配置时的 CLI 种子值；src/index.ts 传入 parseWorkerArgs() 结果。
   * 与启动时 update(cliConfig) 的语义对齐：只有 WorkerArgs 认识的 flag 会保留。
   */
  configSeed?: Partial<GlobalConfig>;
  jobStore?: JobStore;
  /**
   * 注入共享 WsHub：daemon 模式下 socket 客户端与 HTTP 控制台共用一个 hub，
   * browser.status 等广播才能同时到达两类订阅者。缺省时自建（独立运行场景）。
   */
  wsHub?: WsHub;
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
  private readonly wsHub: WsHub;
  private readonly router = new RestRouter();
  private readonly startedAt = Date.now();
  private readonly projectRoot: string;

  private httpServer?: HttpServer;
  private wsServer?: WebSocketServer;
  private actualPort = 0;
  private unsubscribeToolInvoke?: () => void;
  private onSampleListener?: (hookId: string, sample: unknown) => void;

  constructor(options: ConsoleServerOptions) {
    this.options = options;
    this.wsHub = options.wsHub ?? new WsHub();
    this.projectRoot = this.findProjectRoot();
    this.setupRoutes();
  }

  /** 实际监听端口（port=0 时由系统分配）；start() 之前返回 0。 */
  getActualPort(): number {
    return this.actualPort;
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
        configSeed: this.options.configSeed,
      }),
    );
    this.router.mount(
      createSystemRoutes({
        version,
        startedAt: this.startedAt,
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

        if (rejectIfNotLocal(req, res)) {
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
    this.wsServer.on('error', err => {
      logger.debug(`[ConsoleServer] WS server error: ${err.message}`);
    });
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

    // 4. 开启监听（host 可配置，默认 127.0.0.1）
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(
        this.options.port,
        this.options.host ?? '127.0.0.1',
        () => {
          const address = this.httpServer?.address();
          this.actualPort =
            typeof address === 'object' && address !== null
              ? address.port
              : this.options.port;
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
