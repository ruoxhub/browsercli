/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import type {AnalysisMode} from '../../modules/analyzer/ai/types.js';
import {runSessionAnalysis} from '../../modules/session/analyzeRequests.js';
import type {CaptureEngine} from '../../modules/session/CaptureEngine.js';
import type {CaptureSessionManager} from '../../modules/session/CaptureSessionManager.js';
import type {SessionStore} from '../../modules/session/SessionStore.js';
import type {CaptureSource} from '../../modules/session/types.js';
import type {LLMService} from '../../services/LLMService.js';
import {sendError, sendJson, sendUnexpected} from '../middleware/error.js';
import type {SessionRequestDetail} from '../types.js';

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
) => Promise<void> | void;

export interface SessionServices {
  manager: CaptureSessionManager;
  // 用接口而不是 SqliteSessionStore 具体实现：Task 6 的喂入端是
  // CaptureEngine.getStore(): SessionStore（private store 的类型），
  // 收窄成实现类会 TS2739（SessionStore 缺 manager / db 两个私有字段）。
  // 路由只用到 listRequestSummaries / getRequests / getRequest —— 三者都在
  // SessionStore 接口上（SessionStore.ts:31/29/35），放宽后行为零变化。
  store: SessionStore;
  /** AI 分析用的 LLM 服务（可能未配置，由 runSessionAnalysis 内部降级）。 */
  llmService: LLMService;
  /** 依 url 取脚本正文（供 CryptoScriptExtractor 切片）。 */
  getFileByUrl?: (url: string) => {content: string} | null;
  /** 抓包聚合点，供双源开关路由读写 enabledSources。缺省则开关路由 503。 */
  engine?: CaptureEngine;
}

/**
 * 每次请求进来时现取服务；取不到返回 503。
 *
 * 不用构造期注入：ConsoleServer 的 setupRoutes() 跑在构造函数里，
 * 而 runtime 服务可能尚未就绪（spec §7 / D6）。
 */
export type SessionServicesAccessor = () => SessionServices | undefined;

const SOURCES: CaptureSource[] = ['cdp', 'proxy'];

const ANALYZE_MODES: AnalysisMode[] = [
  'auto',
  'api_reverse',
  'security',
  'perf',
  'js_crypto',
];

const MAX_BODY_BYTES = 1 * 1024 * 1024;

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

const parseHeaders = (
  raw: string | null,
): {headers: Record<string, string>; parseError?: true} => {
  if (!raw) return {headers: {}};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return {headers: {}, parseError: true};
    }
    return {headers: parsed as Record<string, string>};
  } catch {
    return {headers: {}, parseError: true};
  }
};

/** 整数解析：非法值返回 undefined，交给调用方决定 400 还是忽略。 */
function parseIntParam(
  raw: string | null,
  onInvalid: () => void,
): number | undefined {
  if (raw === null || raw === '') return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    onInvalid();
    return undefined;
  }
  return value;
}

export function createSessionRoutes(
  getServices: SessionServicesAccessor,
): Map<string, RouteHandler> {
  return new Map<string, RouteHandler>([
    [
      'GET /api/session/requests',
      (_req, res) => {
        const services = getServices();
        const session = services?.manager.getActiveSession();
        if (!services || !session) {
          sendError(res, 'SESSION_UNAVAILABLE', '暂无活动抓包会话', 503);
          return;
        }

        try {
          const url = new URL(_req.url ?? '/', 'http://127.0.0.1');
          const sourcesRaw = url.searchParams.get('sources');
          const sources = sourcesRaw
            ? (sourcesRaw
                .split(',')
                .map(s => s.trim())
                .filter((s): s is CaptureSource =>
                  (SOURCES as string[]).includes(s),
                ) as CaptureSource[])
            : undefined;

          let badRequest = false;
          const limit = parseIntParam(url.searchParams.get('limit'), () => {
            badRequest = true;
          });
          const offset = parseIntParam(url.searchParams.get('offset'), () => {
            badRequest = true;
          });
          if (badRequest) {
            sendError(res, 'BAD_REQUEST', 'limit / offset 必须是整数', 400);
            return;
          }

          const urlFilter = url.searchParams.get('urlFilter');
          const flowFilter = url.searchParams.get('filter');
          const filter = {
            ...(sources && sources.length > 0 ? {sources} : {}),
            ...(urlFilter ? {urlFilter} : {}),
            ...(flowFilter ? {filter: flowFilter} : {}),
          };

          const items = services.store.listRequestSummaries(
            session.id,
            filter,
            {limit, offset},
          );

          // total 与本次分页无关（不受 limit/offset 影响），但跟随同一份 filter：
          // 过滤后 total 与 items 的口径必须一致，否则前端分页器会算出不存在的页数。
          const total = services.store.getRequests(session.id, filter).length;
          // 库里按 sequence DESC 取最近 N 条（首屏只拉摘要），响应内反转成
          // 落库顺序（sequence 升序）交出去（spec §9）。[...items] 而非
          // items.reverse()——不改动 store 返回的数组。
          //
          // 「落库顺序」≠「到达顺序」：sequence 在 ingestRequest 里分配，而 CDP
          // 链路是 await 取体（含 response.text()）之后才调 ingestRequest，MITM
          // 链路则完全同步 —— 先到的大响应若取体慢，会拿到比后到的快响应更大
          // 的 sequence。行的 timestamp 仍是响应头到达时刻、准确；只是这个排序
          // 键的语义不是到达序。切片 3 定稿语义（改为到达序 sequence，或按
          // timestamp 排序、sequence 兜底平局）。
          //
          // 「反转」只保证**窗口内**落库顺序升序：SQL 是「先 ORDER BY sequence
          // DESC，再 LIMIT/OFFSET」（SqliteSessionStore.ts:335-336）。所以
          // limit=1 拿到的是**最新**一条，不是最旧一条；翻页方向是「从最新往回」，
          // 第 2 页每一行都比第 1 页旧。前端分页器必须按这个方向实现，不要照
          // 下面「items[0] 最旧」的直觉写——那条直觉只在 limit >= total 时成立。
          sendJson(res, {items: [...items].reverse(), total});
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'GET /api/session/requests/:id',
      (_req, res, params) => {
        const id = params?.id;
        if (!id) {
          sendError(res, 'BAD_REQUEST', '缺少 :id 路径参数', 400);
          return;
        }
        const services = getServices();
        if (!services) {
          sendError(res, 'SESSION_UNAVAILABLE', '暂无活动抓包会话', 503);
          return;
        }
        try {
          const row = services.store.getRequest(id);
          if (!row) {
            sendError(res, 'NOT_FOUND', `未找到请求 ${id}`, 404);
            return;
          }
          const request = parseHeaders(row.requestHeaders);
          const response = parseHeaders(row.responseHeaders);
          const parseError = request.parseError || response.parseError;

          const detail: SessionRequestDetail = {
            ...row,
            requestHeaders: request.headers,
            responseHeaders: response.headers,
            ...(parseError ? {headersParseError: true} : {}),
          };
          sendJson(res, detail);
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'DELETE /api/session/requests',
      (_req, res) => {
        const services = getServices();
        const session = services?.manager.getActiveSession();
        if (!services || !session) {
          sendError(res, 'SESSION_UNAVAILABLE', '暂无活动抓包会话', 503);
          return;
        }
        try {
          const clearedCount = services.store.clearRequests(session.id);
          sendJson(res, {clearedCount});
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'GET /api/session/capture-sources',
      (_req, res) => {
        const engine = getServices()?.engine;
        if (!engine) {
          sendError(res, 'SESSION_UNAVAILABLE', '抓包引擎未就绪', 503);
          return;
        }
        sendJson(res, {sources: engine.getEnabledSources()});
      },
    ],
    [
      'POST /api/session/capture-sources',
      async (req, res) => {
        let source: string | undefined;
        let enabled: boolean | undefined;
        try {
          const body = (await readJsonBody(req)) as {
            source?: string;
            enabled?: boolean;
          };
          if (body && typeof body.source === 'string') source = body.source;
          if (body && typeof body.enabled === 'boolean') enabled = body.enabled;
        } catch (err) {
          const code = err instanceof Error ? err.message : 'INVALID_JSON';
          sendError(res, code, '请求体不是合法 JSON', 400);
          return;
        }
        if (
          source === undefined ||
          !(SOURCES as string[]).includes(source) ||
          enabled === undefined
        ) {
          sendError(
            res,
            'BAD_REQUEST',
            'source 必须是 cdp | proxy，enabled 必须是布尔值',
            400,
          );
          return;
        }
        const engine = getServices()?.engine;
        if (!engine) {
          sendError(res, 'SESSION_UNAVAILABLE', '抓包引擎未就绪', 503);
          return;
        }
        const sources = engine.setSourceEnabled(
          source as CaptureSource,
          enabled,
        );
        sendJson(res, {sources});
      },
    ],
    [
      'POST /api/session/analyze',
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

        const sessionId =
          typeof body.sessionId === 'string' ? body.sessionId : undefined;
        const mode = ANALYZE_MODES.includes(body.mode as AnalysisMode)
          ? (body.mode as AnalysisMode)
          : undefined;
        const requestIds =
          Array.isArray(body.requestIds) &&
          body.requestIds.every(id => typeof id === 'string')
            ? (body.requestIds as string[])
            : undefined;

        const services = getServices();
        if (!services) {
          sendError(res, 'SESSION_UNAVAILABLE', '暂无活动抓包会话', 503);
          return;
        }
        try {
          const result = await runSessionAnalysis({
            sessionId,
            mode,
            requestIds,
            persist: true,
            manager: services.manager,
            llmService: services.llmService,
            getFileByUrl: services.getFileByUrl,
          });
          sendJson(res, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.startsWith('No session found')) {
            sendError(res, 'NOT_FOUND', message, 404);
            return;
          }
          sendUnexpected(res, err);
        }
      },
    ],
  ]);
}
