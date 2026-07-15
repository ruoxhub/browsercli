/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Config + 连接 REST 路由
 *
 *  GET  /api/config               — 返回 RuntimeConfigStore 快照（敏感字段掩码）
 *  PUT  /api/config/browser       — 更新 browser 配置
 *  PUT  /api/config/llm           — 更新 LLM 配置（掩码占位符不覆盖真实值）
 *  PUT  /api/config/database      — 更新 databaseUrl
 *  POST /api/browser/connect      — 调用 connectBrowser
 *  POST /api/browser/disconnect   — 调用 disconnectBrowser
 *  POST /api/database/connect     — 调用 dbService.connect + migrate
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import {getRuntimeConfigStore} from '../../config/RuntimeConfigStore.js';
import {getBrowserManagerConfig} from '../../config/servicesConfig.js';
import type {GlobalConfig} from '../../config/schema.js';
import {
  BrowserConfigSchema,
  formatConfigValidationError,
} from '../../config/schema.js';
import {dbService} from '../../services/DatabaseService.js';
import type {ToolContextProvider} from '../../worker/ToolContext.js';
import {
  connectBrowser,
  disconnectBrowser,
} from '../../worker/BrowserConnectionManager.js';
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
}

// ==================== 敏感字段掩码 ====================

/** 掩码 API key：仅保留前 3 字符 + *** + 后 4 字符 */
export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 7) return '***';
  return `${key.slice(0, 3)}***${key.slice(-4)}`;
}

/** 检测字符串是否为掩码占位符（格式：xxx***xxxx） */
export function isMaskPlaceholder(value: string): boolean {
  if (!value) return false;
  return /^\S{1,5}\*\*\*\S{1,8}$/.test(value);
}

/** 对 config 快照中的敏感字段做掩码 */
function maskSensitiveFields(config: GlobalConfig): GlobalConfig {
  const masked = {...config};

  if (masked.openai?.apiKey) {
    masked.openai = {
      ...masked.openai,
      apiKey: maskApiKey(masked.openai.apiKey),
    };
  }
  if (masked.anthropic?.apiKey) {
    masked.anthropic = {
      ...masked.anthropic,
      apiKey: maskApiKey(masked.anthropic.apiKey),
    };
  }
  if (masked.gemini?.apiKey) {
    masked.gemini = {
      ...masked.gemini,
      apiKey: maskApiKey(masked.gemini.apiKey),
    };
  }

  return masked;
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

// ==================== LLM 掩码占位符处理 ====================

function mergeLlmProvider(
  incoming: Record<string, unknown>,
  current: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {...current};

  for (const [k, v] of Object.entries(incoming)) {
    if (k === 'apiKey' && typeof v === 'string') {
      if (isMaskPlaceholder(v)) {
        continue;
      }
      merged.apiKey = v;
    } else if (v !== undefined) {
      merged[k] = v;
    }
  }

  return merged;
}

// ==================== 路由工厂 ====================

export function createConfigRoutes(
  cfg: ConfigRoutesConfig,
): Map<string, RouteHandler> {
  return new Map<string, RouteHandler>([
    [
      'GET /api/config',
      (_req, res) => {
        const config = getRuntimeConfigStore().get();
        sendJson(res, maskSensitiveFields(config));
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
        sendJson(res, maskSensitiveFields(updated));
      },
    ],

    [
      'PUT /api/config/llm',
      async (req, res) => {
        let body: Record<string, unknown>;
        try {
          body = (await readJsonBody(req)) as Record<string, unknown>;
        } catch (err) {
          const code = err instanceof Error ? err.message : 'INVALID_JSON';
          sendError(res, code, '请求体不是合法 JSON', 400);
          return;
        }

        const current = getRuntimeConfigStore().get();
        const update: Partial<GlobalConfig> = {};

        if (typeof body.llmProvider === 'string') {
          update.llmProvider = body.llmProvider as GlobalConfig['llmProvider'];
        }

        if (body.openai && typeof body.openai === 'object') {
          update.openai = mergeLlmProvider(
            body.openai as Record<string, unknown>,
            current.openai as Record<string, unknown> | undefined,
          ) as GlobalConfig['openai'];
        }

        if (body.anthropic && typeof body.anthropic === 'object') {
          update.anthropic = mergeLlmProvider(
            body.anthropic as Record<string, unknown>,
            current.anthropic as Record<string, unknown> | undefined,
          ) as GlobalConfig['anthropic'];
        }

        if (body.gemini && typeof body.gemini === 'object') {
          update.gemini = mergeLlmProvider(
            body.gemini as Record<string, unknown>,
            current.gemini as Record<string, unknown> | undefined,
          ) as GlobalConfig['gemini'];
        }

        const updated = getRuntimeConfigStore().update(update);
        sendJson(res, maskSensitiveFields(updated));
      },
    ],

    [
      'PUT /api/config/database',
      async (req, res) => {
        let body: Record<string, unknown>;
        try {
          body = (await readJsonBody(req)) as Record<string, unknown>;
        } catch (err) {
          const code = err instanceof Error ? err.message : 'INVALID_JSON';
          sendError(res, code, '请求体不是合法 JSON', 400);
          return;
        }

        const databaseUrl =
          typeof body.databaseUrl === 'string' ? body.databaseUrl : undefined;

        const updated = getRuntimeConfigStore().update({databaseUrl});
        sendJson(res, {databaseUrl: updated.databaseUrl});
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
          sendError(
            res,
            'BROWSER_DISCONNECT_FAILED',
            err instanceof Error ? err.message : String(err),
            502,
          );
        }
      },
    ],

    [
      'POST /api/database/connect',
      async (_req, res) => {
        try {
          const {databaseUrl} = getRuntimeConfigStore().get();
          if (!databaseUrl) {
            sendError(
              res,
              'DATABASE_URL_NOT_SET',
              'databaseUrl 未配置，请先在面板设置',
              400,
            );
            return;
          }
          await dbService.connect(databaseUrl);
          await dbService.migrate();
          cfg.wsHub.broadcast('worker.status', {
            database: {connected: true},
          });
          sendJson(res, {connected: true});
        } catch (err) {
          sendError(
            res,
            'DATABASE_CONNECT_FAILED',
            err instanceof Error ? err.message : String(err),
            502,
          );
        }
      },
    ],
  ]);
}
