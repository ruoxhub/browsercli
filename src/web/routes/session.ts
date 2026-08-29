/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import type {CaptureSessionManager} from '../../modules/session/CaptureSessionManager.js';
import type {SessionStore} from '../../modules/session/SessionStore.js';
import type {CaptureSource} from '../../modules/session/types.js';
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
}

/**
 * 每次请求进来时现取服务；取不到返回 503。
 *
 * 不用构造期注入：ConsoleServer 的 setupRoutes() 跑在构造函数里，
 * 而 runtime 服务可能尚未就绪（spec §7 / D6）。
 */
export type SessionServicesAccessor = () => SessionServices | undefined;

const SOURCES: CaptureSource[] = ['cdp', 'proxy'];

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
          const filter = {
            ...(sources && sources.length > 0 ? {sources} : {}),
            ...(urlFilter ? {urlFilter} : {}),
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
  ]);
}
