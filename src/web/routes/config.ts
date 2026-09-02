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
 *  POST /api/llm/test             — 用当前/传入配置做一次最小 chat 调用验证可用性
 *  POST /api/browser/connect      — 调用 connectBrowser
 *  POST /api/browser/disconnect   — 调用 disconnectBrowser
 *  GET  /api/config/export        — 导出已持久化配置快照（敏感字段掩码）
 *  POST /api/config/import        — 校验并合并导入配置（缺失字段保留当前值）
 *  POST /api/config/reset         — 删除配置缓存并重置为启动默认值
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import {configFromEnv} from '../../config/resolver.js';
import {
  deleteRuntimeConfig,
  persistRuntimeConfig,
  PERSISTED_KEYS,
} from '../../config/runtimeConfigPersistence.js';
import {
  getRuntimeConfigStore,
  resetRuntimeConfigStore,
} from '../../config/RuntimeConfigStore.js';
import type {AIConfig, GlobalConfig} from '../../config/schema.js';
import {
  BrowserConfigSchema,
  formatConfigValidationError,
  GlobalConfigSchema,
} from '../../config/schema.js';
import {
  createAIService,
  getBrowserManagerConfig,
  getDefaultLLMProvider,
} from '../../config/servicesConfig.js';
import type {AIService, RetryConfig} from '../../services/AIService.js';
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
   * LLM 连接测试用的 AIService 工厂，默认走真实 createAIService。
   * 测试时注入 fake 以避免真实网络请求。
   */
  createAIService?: (
    config?: AIConfig,
    retryConfig?: Partial<RetryConfig>,
  ) => AIService | undefined;
  /**
   * 配置保存后的持久化回调，默认走真实 persistRuntimeConfig。
   * 测试注入 no-op 以避免污染 ~/.browsercli/runtime-config.json。
   */
  persist?: (config: GlobalConfig) => void;
  /**
   * 重置时的 CLI 种子值；src/index.ts 传入 parseWorkerArgs() 结果。
   * 未注入时 reset 只回到 configFromEnv()。
   */
  configSeed?: Partial<GlobalConfig>;
  /**
   * 删除缓存文件，默认 deleteRuntimeConfig。测试注入 no-op。
   * 返回 false 表示删除失败（EPERM/EBUSY 等）—— reset 路由必须据此报错，
   * 不能仍返回 200，否则“重置”是假的：文件还在，下次启动会重新播种旧配置
   * （含 apiKey）。
   */
  deleteConfig?: () => boolean;
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

  return masked;
}

// ==================== /v1/models 端点解析 ====================

/** 由 openai.baseURL 推导 OpenAI 兼容的 /v1/models 完整地址 */
function resolveModelsUrl(baseURL?: string): string {
  const base = (baseURL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
}

/**
 * 校验 LLM baseURL 格式。
 * 允许 http 和 https 协议，支持公网、局域网及本地部署的模型服务。
 */
export function validateLlmBaseUrl(
  baseURL: string | undefined,
): string | undefined {
  if (!baseURL) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    return '无效的 URL 格式';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return '仅允许 http 或 https 协议的 baseURL';
  }
  return undefined;
}

// ==================== LLM 掩码占位符合并 ====================

function mergeOpenaiConfig(
  incoming: unknown,
  stored: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!incoming || typeof incoming !== 'object') return stored;
  const merged = mergeLlmProvider(incoming as Record<string, unknown>, stored);
  if (typeof merged.apiKey === 'string' && merged.apiKey === '') {
    merged.apiKey = stored?.apiKey ?? '';
  }
  return merged;
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
        sendJson(res, maskSensitiveFields(exported as GlobalConfig));
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
        const current = getRuntimeConfigStore().get() as Record<
          string,
          unknown
        >;
        const update: Record<string, unknown> = {};

        for (const key of PERSISTED_KEYS) {
          if (validated[key] === undefined) continue;
          const incoming = validated[key] as Record<string, unknown>;
          if (key === 'openai') {
            // 与 PUT /api/config/llm 同一个合并助手：掩码占位符不覆盖真实密钥，
            // 空串按「留空则不修改」保留存量值（否则 '' 会透到 store.update 的
            // validateGlobalConfig 里抛错，被 RestRouter 兜底成 500 INTERNAL）。
            update.openai = mergeOpenaiConfig(
              incoming,
              current.openai as Record<string, unknown> | undefined,
            ) as GlobalConfig['openai'];
          } else {
            update[key] = incoming;
          }
        }

        const updated = getRuntimeConfigStore().update(
          update as Partial<GlobalConfig>,
        );
        (cfg.persist ?? persistRuntimeConfig)(updated);
        sendJson(res, maskSensitiveFields(updated));
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
          ...configFromEnv(),
          ...cfg.configSeed,
        });
        sendJson(res, maskSensitiveFields(getRuntimeConfigStore().get()));
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
          // mergeOpenaiConfig：apiKey 为空字符串时保留已存值，
          // 与「留空则不修改」的 UI 约定及 /api/llm/* 路径保持一致。
          update.openai = mergeOpenaiConfig(
            body.openai as Record<string, unknown>,
            current.openai as Record<string, unknown> | undefined,
          ) as GlobalConfig['openai'];
        }

        const updated = getRuntimeConfigStore().update(update);
        (cfg.persist ?? persistRuntimeConfig)(updated);
        sendJson(res, maskSensitiveFields(updated));
      },
    ],

    [
      'POST /api/llm/test',
      async (req, res) => {
        let body: Record<string, unknown>;
        try {
          body = (await readJsonBody(req)) as Record<string, unknown>;
        } catch {
          sendError(res, 'INVALID_JSON', '请求体不是合法 JSON', 400);
          return;
        }

        const current = getRuntimeConfigStore().get();
        const provider =
          (body.llmProvider as GlobalConfig['llmProvider']) ||
          current.llmProvider ||
          getDefaultLLMProvider();

        const openai = mergeOpenaiConfig(
          body.openai,
          current.openai as Record<string, unknown> | undefined,
        ) as GlobalConfig['openai'];

        const urlError = validateLlmBaseUrl(openai?.baseURL);
        if (urlError) {
          sendError(res, 'LLM_CONFIG_INVALID', urlError, 400);
          return;
        }

        const makeAIService = cfg.createAIService ?? createAIService;

        let service: AIService | undefined;
        try {
          // 连接测试只需验证配置可用性，禁用重试快速失败，
          // 避免 5xx 时白等 3 轮退避（约 7s+）才反馈。
          service = makeAIService({provider, openai}, {maxRetries: 0});
        } catch (err) {
          sendError(
            res,
            'LLM_CONFIG_INVALID',
            err instanceof Error ? err.message : String(err),
            400,
          );
          return;
        }

        if (!service) {
          sendError(res, 'LLM_CONFIG_INVALID', '未找到可用的 LLM 配置', 400);
          return;
        }

        const start = Date.now();
        try {
          await service.chat([{role: 'user', content: 'ping'}], {
            maxTokens: 8,
          });
          const latencyMs = Date.now() - start;
          sendJson(res, {ok: true, provider, latencyMs});
        } catch (err) {
          const latencyMs = Date.now() - start;
          sendError(
            res,
            'LLM_TEST_FAILED',
            err instanceof Error ? err.message : String(err),
            502,
            {ok: false, latencyMs},
          );
        }
      },
    ],

    [
      'POST /api/llm/models',
      async (req, res) => {
        let body: Record<string, unknown>;
        try {
          body = (await readJsonBody(req)) as Record<string, unknown>;
        } catch {
          sendError(res, 'INVALID_JSON', '请求体不是合法 JSON', 400);
          return;
        }

        const current = getRuntimeConfigStore().get();

        const openai = mergeOpenaiConfig(
          body.openai,
          current.openai as Record<string, unknown> | undefined,
        ) as GlobalConfig['openai'];

        if (!openai?.apiKey) {
          sendError(
            res,
            'LLM_CONFIG_INVALID',
            '未配置 API Key，无法获取模型列表',
            400,
          );
          return;
        }

        const urlError = validateLlmBaseUrl(openai.baseURL);
        if (urlError) {
          sendError(res, 'LLM_CONFIG_INVALID', urlError, 400);
          return;
        }

        const modelsUrl = resolveModelsUrl(openai.baseURL);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        try {
          const upstream = await fetch(modelsUrl, {
            headers: {
              Authorization: `Bearer ${openai.apiKey}`,
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
          });

          if (!upstream.ok) {
            const text = await upstream.text().catch(() => '');
            sendError(
              res,
              'LLM_MODELS_FETCH_FAILED',
              `获取模型列表失败 (${upstream.status}): ${text.slice(0, 200)}`,
              502,
            );
            return;
          }

          const payload = (await upstream.json()) as {
            data?: Array<{id: string; object?: string; owned_by?: string}>;
          };
          const models = Array.isArray(payload.data)
            ? payload.data.map(m => ({
                id: m.id,
                object: m.object,
                owned_by: m.owned_by,
              }))
            : [];
          sendJson(res, {models});
        } catch (err) {
          sendError(
            res,
            'LLM_MODELS_FETCH_FAILED',
            err instanceof Error ? err.message : String(err),
            502,
          );
        } finally {
          clearTimeout(timeout);
        }
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
