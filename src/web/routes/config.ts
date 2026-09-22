/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Config + 连接 REST 路由
 *
 *  GET  /api/config               — 返回 RuntimeConfigStore 快照
 *  PUT  /api/config/browser       — 更新 browser 配置
 *  POST /api/browser/connect      — 调用 connectBrowser
 *  POST /api/browser/disconnect   — 调用 disconnectBrowser
 *  GET  /api/config/export        — 导出已持久化配置快照
 *  POST /api/config/import        — 校验并合并导入配置（缺失字段保留当前值）
 *  POST /api/config/reset         — 删除配置缓存并重置为启动默认值
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import {loadUserConfig} from '../../config/resolver.js';
import {
  deleteRuntimeConfig,
  persistRuntimeConfig,
  PERSISTED_KEYS,
} from '../../config/runtimeConfigPersistence.js';
import {
  getRuntimeConfigStore,
  resetRuntimeConfigStore,
} from '../../config/RuntimeConfigStore.js';
import type {GlobalConfig} from '../../config/schema.js';
import {
  BrowserConfigSchema,
  formatConfigValidationError,
  GlobalConfigSchema,
} from '../../config/schema.js';
import {getBrowserManagerConfig} from '../../config/servicesConfig.js';
import {
  connectBrowser,
  disconnectBrowser,
} from '../../worker/BrowserConnectionManager.js';
import type {ToolContextProvider} from '../../worker/ToolContext.js';
import {WorkerBusyError} from '../../worker/WorkerActivityCoordinator.js';
import {sendError, sendJson} from '../middleware/error.js';
import type {WsHub} from '../ws/WsHub.js';

const MAX_BODY_BYTES = 1 * 1024 * 1024;

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
) => Promise<void> | void;

export interface ConfigRoutesConfig {
  contextProvider: ToolContextProvider;
  wsHub: WsHub;
  /**
   * 配置保存后的持久化回调，默认走真实 persistRuntimeConfig。
   * 测试注入 no-op 以避免污染 ~/.browsercli/runtime-config.json。
   */
  persist?: (config: GlobalConfig) => void;
  /**
   * 重置时的 CLI 种子值；src/index.ts 传入 parseWorkerArgs() 结果。
   * 未注入时 reset 只回到 loadUserConfig()。
   */
  configSeed?: Partial<GlobalConfig>;
  /**
   * 删除缓存文件，默认 deleteRuntimeConfig。测试注入 no-op。
   * 返回 false 表示删除失败（EPERM/EBUSY 等）—— reset 路由必须据此报错，
   * 不能仍返回 200，否则“重置”是假的：文件还在，下次启动会重新播种旧配置。
   */
  deleteConfig?: () => boolean;
}

// ==================== Body 读取 ====================

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ==================== 路由工厂 ====================

export function createConfigRoutes(
  cfg: ConfigRoutesConfig,
): Map<string, RouteHandler> {
  return new Map<string, RouteHandler>([
    [
      'GET /api/config',
      (_req, res) => {
        sendJson(res, getRuntimeConfigStore().get());
      },
    ],

    [
      'GET /api/config/export',
      (_req, res) => {
        const current = getRuntimeConfigStore().get() as Record<
          string,
          unknown
        >;
        const exported: Record<string, unknown> = {};
        for (const key of PERSISTED_KEYS) {
          if (current[key] !== undefined) exported[key] = current[key];
        }
        sendJson(res, exported);
      },
    ],

    [
      'POST /api/config/import',
      async (req, res) => {
        let body: Record<string, unknown>;
        try {
          body = (await readJsonBody(req)) as Record<string, unknown>;
        } catch (err) {
          const code = err instanceof Error ? err.message : 'INVALID_JSON';
          sendError(
            res,
            code,
            code === 'PAYLOAD_TOO_LARGE'
              ? '请求体超过 1MB 上限'
              : '请求体不是合法 JSON',
            code === 'PAYLOAD_TOO_LARGE' ? 413 : 400,
          );
          return;
        }

        const parseResult = GlobalConfigSchema.safeParse(body);
        if (!parseResult.success) {
          sendError(
            res,
            'VALIDATION',
            formatConfigValidationError(parseResult.error),
            400,
          );
          return;
        }

        const validated = parseResult.data as Record<string, unknown>;
        const update: Record<string, unknown> = {};

        for (const key of PERSISTED_KEYS) {
          if (validated[key] === undefined) continue;
          update[key] = validated[key];
        }

        const updated = getRuntimeConfigStore().update(
          update as Partial<GlobalConfig>,
        );
        (cfg.persist ?? persistRuntimeConfig)(updated);
        sendJson(res, updated);
      },
    ],

    [
      'POST /api/config/reset',
      (_req, res) => {
        // 删除失败必须中断：否则返回 200 而文件仍在，下次启动重新播种旧配置
        if (!(cfg.deleteConfig ?? deleteRuntimeConfig)()) {
          sendError(
            res,
            'CONFIG_DELETE_FAILED',
            '配置缓存文件删除失败，未执行重置',
            500,
          );
          return;
        }
        resetRuntimeConfigStore({
          ...loadUserConfig(),
          ...cfg.configSeed,
        });
        sendJson(res, getRuntimeConfigStore().get());
      },
    ],

    [
      'PUT /api/config/browser',
      async (req, res) => {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          const code = err instanceof Error ? err.message : 'INVALID_JSON';
          sendError(
            res,
            code,
            code === 'PAYLOAD_TOO_LARGE'
              ? '请求体超过 1MB 上限'
              : '请求体不是合法 JSON',
            code === 'PAYLOAD_TOO_LARGE' ? 413 : 400,
          );
          return;
        }

        const parseResult = BrowserConfigSchema.safeParse(body);
        if (!parseResult.success) {
          sendError(
            res,
            'VALIDATION',
            formatConfigValidationError(parseResult.error),
            400,
          );
          return;
        }

        const updated = getRuntimeConfigStore().update({
          browser: parseResult.data,
        });
        (cfg.persist ?? persistRuntimeConfig)(updated);
        sendJson(res, updated);
      },
    ],

    [
      'POST /api/browser/connect',
      async (_req, res) => {
        try {
          const config = getBrowserManagerConfig();
          const result = await connectBrowser(cfg.contextProvider, config);
          cfg.wsHub.broadcast('worker.status', {
            browser: {connected: true, mode: result.mode},
          });
          sendJson(res, result);
        } catch (err) {
          if (err instanceof WorkerBusyError) {
            sendError(res, err.code, err.message, 409, err.state);
            return;
          }
          sendError(
            res,
            'BROWSER_CONNECT_FAILED',
            err instanceof Error ? err.message : String(err),
            502,
          );
        }
      },
    ],

    [
      'POST /api/browser/disconnect',
      async (_req, res) => {
        try {
          await disconnectBrowser(cfg.contextProvider);
          cfg.wsHub.broadcast('worker.status', {
            browser: {connected: false, mode: 'disconnected'},
          });
          sendJson(res, {connected: false});
        } catch (err) {
          if (err instanceof WorkerBusyError) {
            sendError(res, err.code, err.message, 409, err.state);
            return;
          }
          sendError(
            res,
            'BROWSER_DISCONNECT_FAILED',
            err instanceof Error ? err.message : String(err),
            502,
          );
        }
      },
    ],
  ]);
}
