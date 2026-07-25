/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * NetworkModule — 网络领域门面。
 *
 * 协调网络请求查询、重放、curl 导出、WebSocket 检查等操作。
 * 方法签名统一为 `(services: NetworkServices, params: P) => Promise<NetworkMethodResult<T>>`，
 * 调用方（tool handler）负责传入 `ToolContextProvider`（结构化满足 `NetworkServices`）。
 *
 * 设计要点：
 * - 无状态门面（除流量摘要缓存外）。不持有页面/CDP 引用，不直接管理 CDP 会话。
 * - 复用 `NetworkServices`（即 `ToolContextProvider`）已建立的网络/WebSocket 收集器。
 * - 流量摘要缓存统一持有于此实例，修复此前 `analyzeMessages` 模块级缓存与
 *   `DefineToolContextFactory` 实例缓存不一致的 bug。
 * - 不 import `worker/` 或 `tools/`，避免循环依赖。
 */

import {
  analyzeWebSocketFramesV2,
  formatGroupMessages,
  formatRecentMessages,
  formatTrafficSummary,
  formatWebSocketFrameDetail,
  type TrafficSummary,
} from '../../formatters/websocketFormatter.js';
import type {HTTPRequest, ResourceType} from '../../third_party/index.js';

import type {
  AnalyzeWebSocketMessagesData,
  AnalyzeWebSocketMessagesParams,
  BatchVariantResult,
  ClearNetworkRequestsData,
  ClearNetworkRequestsParams,
  ExportRequestAsCurlData,
  ExportRequestAsCurlParams,
  GetNetworkRequestData,
  GetNetworkRequestParams,
  GetWebSocketMessageData,
  GetWebSocketMessageParams,
  GetWebSocketMessagesData,
  GetWebSocketMessagesParams,
  ListNetworkRequestsData,
  ListNetworkRequestsParams,
  ListWebSocketConnectionsData,
  ListWebSocketConnectionsParams,
  NetworkMethodResult,
  NetworkRequestData,
  NetworkServices,
  ReplayNetworkRequestBatchData,
  ReplayNetworkRequestBatchParams,
  ReplayNetworkRequestData,
  ReplayNetworkRequestParams,
  ReplayOverride,
  WebSocketFrame,
} from './NetworkTypes.js';
import {
  buildReplayRequest,
  emptyReplayResponse,
  executeReplay,
  formatCurl,
} from './replayEngine.js';
import {buildEvidenceCorrelations} from './signatureDetector.js';

const DEFAULT_WAIT_TIMEOUT_MS = 5000;
const WAIT_POLL_INTERVAL_MS = 50;
const DEFAULT_GET_BODY_LENGTH = 300;
const DEFAULT_REPLAY_BODY_LENGTH = 2000;
const DEFAULT_BATCH_MAX_BODY_LENGTH = 500;
const TEXTUAL_CONTENT_TYPES = ['json', 'text', 'javascript'];

const NO_ACTIVE_PAGE_MESSAGE =
  '当前无活跃页面，请先通过 new_page 或 select_page 创建/选择页面';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function isTextualContentType(contentType: string): boolean {
  return TEXTUAL_CONTENT_TYPES.some(token => contentType.includes(token));
}

function getRequestHeaders(request: HTTPRequest): Record<string, string> {
  try {
    return request.headers();
  } catch {
    return {};
  }
}

function serializeRequest(
  request: HTTPRequest,
  reqid: number,
): NetworkRequestData {
  return {
    reqid,
    url: request.url(),
    method: request.method(),
  };
}

function serializeRequests(
  requests: HTTPRequest[],
  services: NetworkServices,
): NetworkRequestData[] {
  return requests.map(request => {
    const reqid = services.getNetworkRequestStableId(request);
    return serializeRequest(request, reqid);
  });
}

function emptyPageData(
  pageIdx: number,
  pageSize: number | undefined,
  targetPageIdx: number,
  extra: Partial<ListNetworkRequestsData> = {},
): ListNetworkRequestsData {
  return {
    requests: [],
    total: 0,
    pageIdx,
    pageSize,
    targetPageIdx,
    timedOut: false,
    ...extra,
  };
}

/** 构建 replay/exportCurl/batch 共用的原始请求数据快照。 */
function buildOriginalData(
  reqid: number,
  networkRequest: {
    url(): string;
    method(): string;
    postData(): string | null;
    resourceType(): string;
    headers(): Record<string, string>;
  },
  httpResponse: {
    status(): number;
    statusText?(): string;
    headers(): Record<string, string>;
  } | null,
): GetNetworkRequestData {
  return {
    reqid,
    url: networkRequest.url(),
    method: networkRequest.method(),
    resourceType: networkRequest.resourceType(),
    statusCode: httpResponse?.status() ?? 0,
    statusText: httpResponse?.statusText?.(),
    requestHeaders: networkRequest.headers(),
    responseHeaders: httpResponse?.headers() ?? {},
    postData: networkRequest.postData() ?? undefined,
  };
}

/** Cookie 域匹配：host 等于 domain，或 host 以 "." + domain 结尾。 */
function cookieMatchesHost(cookieDomain: string, host: string): boolean {
  const domain = cookieDomain.replace(/^\./, '').toLowerCase();
  const h = host.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}

function buildFrameData(
  frames: WebSocketFrame[],
  baseIndex: number,
  showContent: boolean | undefined,
): Array<Record<string, unknown>> {
  return frames.map((frame, i) => {
    if (!showContent) {
      return {index: baseIndex + i};
    }
    return {
      index: baseIndex + i,
      direction: frame.direction,
      timestamp: frame.timestamp,
      opcode: frame.opcode,
      payloadSize: frame.payloadData.length,
      payloadPreview: frame.payloadData.slice(0, 200),
    };
  });
}

/**
 * 网络领域门面。通过 `runtime.networkModule` 访问。
 */
export class NetworkModule {
  /** 流量摘要缓存：wsid -> TrafficSummary。统一 analyze/getMessages 两路读写。 */
  private readonly trafficSummaryCache = new Map<number, TrafficSummary>();

  // ─── 页面索引解析 ────────────────────────────────────

  private resolvePageIdx(
    services: NetworkServices,
  ): {ok: true; pageIdx: number} | {ok: false; message: string} {
    const selected = services.getSelectedPage();
    if (!selected) {
      return {ok: false, message: NO_ACTIVE_PAGE_MESSAGE};
    }
    if (typeof services.getSelectedPageIndex === 'function') {
      const idx = services.getSelectedPageIndex();
      if (typeof idx === 'number' && idx >= 0) {
        return {ok: true, pageIdx: idx};
      }
    }
    const pages = services.getPages();
    const idx = pages.findIndex(p => p === selected);
    if (idx >= 0) {
      return {ok: true, pageIdx: idx};
    }
    return {ok: false, message: NO_ACTIVE_PAGE_MESSAGE};
  }

  // ─── Network Requests ──────────────────────────────

  /**
   * 列出网络请求。支持资源类型/URL/请求头过滤、分页、等待匹配请求、签名证据关联。
   */
  async listRequests(
    services: NetworkServices,
    params: ListNetworkRequestsParams,
  ): Promise<NetworkMethodResult<ListNetworkRequestsData>> {
    try {
      const resultPageIdx = params.pageIdx ?? 0;
      const pageSize = params.pageSize;
      let targetPageIdx = params.targetPageIdx ?? 0;

      const includePreserved = params.includePreservedRequests ?? false;
      if (params.targetPageIdx === undefined) {
        const resolved = this.resolvePageIdx(services);
        if ('message' in resolved) {
          return {
            success: false,
            message: resolved.message,
            data: emptyPageData(resultPageIdx, pageSize, 0),
          };
        }
        targetPageIdx = resolved.pageIdx;
      }

      if (params.waitForRequest) {
        const matched = await this.waitForMatchingRequest(services, {
          includePreservedRequests: includePreserved,
          targetPageIdx,
          waitForRequest: params.waitForRequest,
          waitTimeoutMs: params.waitTimeoutMs,
        });
        if (!matched) {
          const timeoutMs = params.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
          let timedOutRequests = services.getNetworkRequests(
            includePreserved,
            targetPageIdx,
          );
          timedOutRequests = timedOutRequests.filter(request =>
            request.url().includes(params.waitForRequest!),
          );
          if (params.urlFilter) {
            const filter = params.urlFilter.toLowerCase();
            timedOutRequests = timedOutRequests.filter(request =>
              request.url().toLowerCase().includes(filter),
            );
          }
          const timedOutData = serializeRequests(timedOutRequests, services);

          return {
            success: timedOutData.length > 0,
            message:
              timedOutData.length > 0
                ? `等待请求超时（${timeoutMs}ms），但发现 ${timedOutData.length} 个历史匹配 ${params.waitForRequest} 的请求`
                : `等待请求超时：${timeoutMs}ms 内未发现匹配 ${params.waitForRequest} 的请求`,
            data: {
              ...emptyPageData(resultPageIdx, pageSize, targetPageIdx),
              requests: timedOutData,
              total: timedOutData.length,
              timedOut: true,
              waitedFor: params.waitForRequest,
            },
          };
        }
      }

      let requests = services.getNetworkRequests(
        includePreserved,
        targetPageIdx,
      );

      if (params.resourceTypes?.length) {
        const normalizedTypes = new Set(params.resourceTypes);
        requests = requests.filter(request => {
          return normalizedTypes.has(request.resourceType() as ResourceType);
        });
      }

      if (params.headerFilter) {
        const keyword = params.headerFilter.toLowerCase();
        requests = requests.filter(request => {
          const headers = getRequestHeaders(request);
          return Object.entries(headers).some(([key, value]) => {
            return `${key}: ${value}`.toLowerCase().includes(keyword);
          });
        });
      }

      if (params.urlFilter) {
        const filter = params.urlFilter.toLowerCase();
        requests = requests.filter(request => {
          return request.url().toLowerCase().includes(filter);
        });
      }

      const allData = serializeRequests(requests, services);
      const total = allData.length;

      let pagedData: NetworkRequestData[];
      if (pageSize) {
        const start = resultPageIdx * pageSize;
        pagedData = allData.slice(start, start + pageSize);
      } else {
        pagedData = allData;
      }

      const data: ListNetworkRequestsData = {
        requests: pagedData,
        total,
        pageIdx: resultPageIdx,
        targetPageIdx,
        pageSize,
        timedOut: false,
        ...(params.includeSignatureEvidence
          ? {
              evidenceCorrelations: buildEvidenceCorrelations(
                requests,
                services,
              ),
            }
          : {}),
      };

      return {
        success: true,
        message: `共 ${total} 个请求，返回 ${pagedData.length} 个`,
        data,
      };
    } catch (error) {
      return {
        success: false,
        message: `列出请求失败：${error instanceof Error ? error.message : String(error)}`,
        data: emptyPageData(params.pageIdx ?? 0, params.pageSize, 0),
      };
    }
  }

  private async waitForMatchingRequest(
    services: NetworkServices,
    options: {
      includePreservedRequests: boolean;
      targetPageIdx: number;
      waitForRequest: string;
      waitTimeoutMs?: number;
    },
  ): Promise<boolean> {
    const timeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const requests = services.getNetworkRequests(
        options.includePreservedRequests,
        options.targetPageIdx,
      );
      const hasMatch = requests.some(request =>
        request.url().includes(options.waitForRequest),
      );
      if (hasMatch) {
        return true;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return false;
      }

      await sleep(Math.min(WAIT_POLL_INTERVAL_MS, remainingMs));
    }
  }

  /**
   * 获取单条网络请求详情（含响应体）。reqid 省略时回退到 DevTools 选中请求。
   */
  async getRequest(
    services: NetworkServices,
    params: GetNetworkRequestParams,
  ): Promise<NetworkMethodResult<GetNetworkRequestData>> {
    const EMPTY = {
      reqid: 0,
      url: '',
      method: '',
      resourceType: '',
      statusCode: 0,
      requestHeaders: {},
      responseHeaders: {},
    } as const;

    try {
      let reqid = params.reqid;
      if (!reqid) {
        const devToolsData = await services.getDevToolsData();
        if (devToolsData?.cdpRequestId) {
          reqid = services.resolveCdpRequestId(devToolsData.cdpRequestId);
        }
      }

      if (!reqid) {
        return {
          success: false,
          message: '未指定 reqid，且 DevTools Network 面板未选中任何请求',
          data: {...EMPTY},
        };
      }

      const networkRequest = services.getNetworkRequestById(reqid);
      const httpResponse = await networkRequest.response().catch(() => null);

      const maxBodyLength = params.maxBodyLength ?? DEFAULT_GET_BODY_LENGTH;
      let responseBody: string | undefined;
      if (httpResponse) {
        try {
          const contentType = httpResponse.headers()['content-type'] ?? '';
          if (isTextualContentType(contentType)) {
            const fullBody = await httpResponse.text();
            responseBody =
              fullBody.length > maxBodyLength
                ? fullBody.slice(0, maxBodyLength) + '\n... [truncated]'
                : fullBody;
          }
        } catch {
          // 忽略读取失败
        }
      }

      const initiator = services.getRequestInitiator(networkRequest);

      const data: GetNetworkRequestData = {
        reqid,
        url: networkRequest.url(),
        method: networkRequest.method(),
        resourceType: networkRequest.resourceType(),
        postData: networkRequest.postData() ?? undefined,
        statusCode: httpResponse?.status() ?? 0,
        statusText: httpResponse?.statusText?.(),
        requestHeaders: networkRequest.headers(),
        responseHeaders: httpResponse?.headers() ?? {},
        stack: initiator?.stack,
        responseBody,
      };

      return {
        success: true,
        message: `请求 ID=${reqid} 获取成功`,
        data,
      };
    } catch (error) {
      return {
        success: false,
        message: `获取请求失败：${error instanceof Error ? error.message : String(error)}`,
        data: {...EMPTY, reqid: params.reqid ?? 0},
      };
    }
  }

  /**
   * 清空指定页面的网络请求缓存，stableId 计数器重置。
   */
  clearRequests(
    services: NetworkServices,
    params: ClearNetworkRequestsParams,
  ): NetworkMethodResult<ClearNetworkRequestsData> {
    try {
      let targetPageIdx = params.targetPageIdx ?? 0;

      if (params.targetPageIdx === undefined) {
        const resolved = this.resolvePageIdx(services);
        if ('message' in resolved) {
          return {
            success: false,
            message: resolved.message,
            data: {clearedCount: 0, targetPageIdx: 0},
          };
        }
        targetPageIdx = resolved.pageIdx;
      }

      const before = services.getNetworkRequests(false, targetPageIdx);
      services.clearNetworkRequests(targetPageIdx);

      return {
        success: true,
        message:
          before.length > 0
            ? `已清空页面 ${targetPageIdx} 的 ${before.length} 个网络请求`
            : `页面 ${targetPageIdx} 当前没有可清空的网络请求`,
        data: {clearedCount: before.length, targetPageIdx},
      };
    } catch (error) {
      return {
        success: false,
        message: `清空请求失败：${error instanceof Error ? error.message : String(error)}`,
        data: {clearedCount: 0, targetPageIdx: params.targetPageIdx ?? 0},
      };
    }
  }

  /**
   * 重放单条网络请求，复用浏览器 context 的 cookie/storage/UA。
   */
  async replayRequest(
    services: NetworkServices,
    params: ReplayNetworkRequestParams,
  ): Promise<NetworkMethodResult<ReplayNetworkRequestData>> {
    const reqid = params.reqid;
    try {
      const page = services.getSelectedPage();
      if (!page) {
        return {
          success: false,
          message: NO_ACTIVE_PAGE_MESSAGE,
          data: {
            ...emptyReplayResponse(''),
            originalReqid: reqid,
            override: null,
          },
        };
      }
      const networkRequest = services.getNetworkRequestById(reqid);
      const httpResponse = await networkRequest.response().catch(() => null);
      const originalData = buildOriginalData(
        reqid,
        networkRequest,
        httpResponse,
      );

      const override = this.buildOverride(params);
      const built = buildReplayRequest(originalData, override ?? undefined);
      const maxBodyLength = params.maxBodyLength ?? DEFAULT_REPLAY_BODY_LENGTH;

      try {
        const result = await executeReplay(
          page.context().request,
          built,
          maxBodyLength,
        );
        return {
          success: true,
          message: `请求重放成功：HTTP ${result.status}`,
          data: {...result, originalReqid: reqid, override},
        };
      } catch (execError) {
        return {
          success: false,
          message: `请求重放失败：${execError instanceof Error ? execError.message : String(execError)}`,
          data: {
            ...emptyReplayResponse(built.url),
            originalReqid: reqid,
            override,
          },
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `请求重放失败：${error instanceof Error ? error.message : String(error)}`,
        data: {
          ...emptyReplayResponse(''),
          originalReqid: reqid,
          override: null,
        },
      };
    }
  }

  /**
   * 导出请求为 curl 命令。可选嵌入浏览器 cookie。
   */
  async exportCurl(
    services: NetworkServices,
    params: ExportRequestAsCurlParams,
  ): Promise<NetworkMethodResult<ExportRequestAsCurlData>> {
    const reqid = params.reqid;
    try {
      const page = services.getSelectedPage();
      if (!page) {
        return {
          success: false,
          message: NO_ACTIVE_PAGE_MESSAGE,
          data: {curl: '', originalReqid: reqid, override: null},
        };
      }
      const networkRequest = services.getNetworkRequestById(reqid);
      const httpResponse = await networkRequest.response().catch(() => null);
      const originalData = buildOriginalData(
        reqid,
        networkRequest,
        httpResponse,
      );

      const override = this.buildOverride(params);
      const built = buildReplayRequest(originalData, override ?? undefined);

      let cookies: Array<{name: string; value: string}> | undefined;
      let cookieNote = '';
      if (params.includeCookies === true) {
        try {
          const allCookies = await page.context().cookies();
          let host: string;
          try {
            host = new URL(built.url).hostname;
          } catch {
            host = '';
          }
          cookies = allCookies
            .filter(c => cookieMatchesHost(c.domain, host))
            .map(c => ({name: c.name, value: c.value}));
        } catch {
          cookieNote = '（Cookie 读取失败，已省略）';
        }
      }

      const curl = formatCurl(built, {
        includeCookies: params.includeCookies === true,
        cookies,
      });

      return {
        success: true,
        message: `已导出 curl 命令${cookieNote}`,
        data: {curl, originalReqid: reqid, override},
      };
    } catch (error) {
      return {
        success: false,
        message: `导出 curl 失败：${error instanceof Error ? error.message : String(error)}`,
        data: {curl: '', originalReqid: reqid, override: null},
      };
    }
  }

  /**
   * 批量重放：以一条请求为模板，应用多个 override variant 分别重放。
   */
  async replayBatch(
    services: NetworkServices,
    params: ReplayNetworkRequestBatchParams,
  ): Promise<NetworkMethodResult<ReplayNetworkRequestBatchData>> {
    const reqid = params.reqid;
    const variants = params.variants ?? [];
    const concurrency = params.concurrency ?? 1;
    const maxBodyLength = params.maxBodyLength ?? DEFAULT_BATCH_MAX_BODY_LENGTH;

    if (variants.length === 0) {
      return {
        success: false,
        message: 'variants 不能为空，请至少提供一个重放变体',
        data: {
          total: 0,
          succeeded: 0,
          failed: 0,
          statusCodeDistribution: {},
          results: [],
        },
      };
    }

    try {
      const page = services.getSelectedPage();
      if (!page) {
        return {
          success: false,
          message: NO_ACTIVE_PAGE_MESSAGE,
          data: {
            total: variants.length,
            succeeded: 0,
            failed: variants.length,
            statusCodeDistribution: {},
            results: [],
          },
        };
      }
      const networkRequest = services.getNetworkRequestById(reqid);
      const httpResponse = await networkRequest.response().catch(() => null);
      const originalData = buildOriginalData(
        reqid,
        networkRequest,
        httpResponse,
      );

      const built: Array<{
        built: ReturnType<typeof buildReplayRequest>;
        override: ReplayOverride;
        buildError?: string;
      }> = [];
      for (const override of variants) {
        try {
          built.push({
            built: buildReplayRequest(originalData, override),
            override,
          });
        } catch (e) {
          built.push({
            built: {method: '', url: '', headers: {}},
            override,
            buildError: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const results: BatchVariantResult[] = new Array(variants.length);
      const queue = built.map((b, i) => ({...b, i}));
      const workers = Array.from(
        {length: Math.min(concurrency, variants.length)},
        async () => {
          while (queue.length > 0) {
            const next = queue.shift()!;
            if (next.buildError) {
              results[next.i] = {
                index: next.i,
                override: next.override,
                result: emptyReplayResponse(next.built.url),
                error: next.buildError,
              };
              continue;
            }
            try {
              const r = await executeReplay(
                page.context().request,
                next.built,
                maxBodyLength,
              );
              results[next.i] = {
                index: next.i,
                override: next.override,
                result: r,
              };
            } catch (e) {
              results[next.i] = {
                index: next.i,
                override: next.override,
                result: emptyReplayResponse(next.built.url),
                error: e instanceof Error ? e.message : String(e),
              };
            }
          }
        },
      );
      await Promise.all(workers);

      let succeeded = 0;
      let failed = 0;
      const statusCodeDistribution: Record<number, number> = {};
      for (const r of results) {
        if (r.error) {
          failed++;
        } else {
          succeeded++;
        }
        const status = r.result.status;
        statusCodeDistribution[status] =
          (statusCodeDistribution[status] ?? 0) + 1;
      }

      return {
        success: failed === 0,
        message: `批量重放完成：${succeeded}/${variants.length} 成功`,
        data: {
          total: variants.length,
          succeeded,
          failed,
          statusCodeDistribution,
          results,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `批量重放失败：${error instanceof Error ? error.message : String(error)}`,
        data: {
          total: variants.length,
          succeeded: 0,
          failed: variants.length,
          statusCodeDistribution: {},
          results: [],
        },
      };
    }
  }

  private buildOverride(
    params: ReplayNetworkRequestParams | ExportRequestAsCurlParams,
  ): ReplayOverride | null {
    const hasOverride =
      params.method ??
      params.url ??
      params.headers ??
      params.body ??
      params.replaceHeaders !== undefined;
    if (!hasOverride) {
      return null;
    }
    return {
      method: params.method,
      url: params.url,
      headers: params.headers,
      body: params.body,
      replaceHeaders: params.replaceHeaders,
    };
  }

  // ─── WebSocket ──────────────────────────────────

  /**
   * 列出 WebSocket 连接。支持 URL 过滤与分页。
   */
  listWebSockets(
    services: NetworkServices,
    params: ListWebSocketConnectionsParams,
  ): NetworkMethodResult<ListWebSocketConnectionsData> {
    try {
      let connections = services.getWebSocketConnections(
        params.includePreservedConnections,
      );

      if (params.urlFilter) {
        const filter = params.urlFilter.toLowerCase();
        connections = connections.filter(ws =>
          ws.connection.url.toLowerCase().includes(filter),
        );
      }

      const pageSize = params.pageSize ?? connections.length;
      const pageIdx = params.pageIdx ?? 0;
      const offset = pageIdx * pageSize;
      const paged = connections.slice(offset, offset + pageSize);

      return {
        success: true,
        message: `找到 ${connections.length} 个 WebSocket 连接`,
        data: {
          connections: paged.map(ws => ({
            wsid: services.getWebSocketStableId(ws),
            url: ws.connection.url,
            state: ws.connection.status,
            frameCount: ws.frames.length,
          })),
          total: connections.length,
          pageIdx,
          pageSize,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        data: {connections: [], total: 0, pageIdx: 0, pageSize: 0},
      };
    }
  }

  /**
   * 获取 WebSocket 消息。支持方向/groupId 过滤、分页、内容显示。
   * groupId 模式下复用 `trafficSummaryCache` 缓存的流量摘要。
   */
  async getWebSocketMessages(
    services: NetworkServices,
    params: GetWebSocketMessagesParams,
  ): Promise<NetworkMethodResult<GetWebSocketMessagesData>> {
    try {
      const ws = services.getWebSocketConnectionById(params.wsid);
      let frames = ws.frames;

      if (params.direction) {
        frames = frames.filter(f => f.direction === params.direction);
      }

      const pageSize = params.pageSize ?? 10;
      const pageIdx = params.pageIdx ?? 0;

      if (params.groupId) {
        const groupId = params.groupId.toUpperCase();

        let summary = this.trafficSummaryCache.get(params.wsid);
        if (!summary) {
          summary = analyzeWebSocketFramesV2(
            ws.frames,
            params.wsid,
            ws.connection.url,
          );
          this.trafficSummaryCache.set(params.wsid, summary);
        }

        const indices = summary.groupToIndices.get(groupId);
        if (!indices || indices.length === 0) {
          return {
            success: false,
            message: `Group ${groupId} not found or empty. Available groups: ${summary.groups.map(g => g.id).join(', ')}`,
            data: {
              wsid: params.wsid,
              groupId,
              availableGroups: summary.groups.map(g => g.id),
            },
          };
        }

        let filteredIndices = indices;
        if (params.direction) {
          filteredIndices = indices.filter(idx => {
            const frame = ws.frames[idx];
            return frame && frame.direction === params.direction;
          });
        }

        const lines = formatGroupMessages(ws.frames, filteredIndices, groupId, {
          pageSize,
          pageIdx,
        });

        const offset = pageIdx * pageSize;
        const paginatedIndices = filteredIndices.slice(
          offset,
          offset + pageSize,
        );
        const paginatedFrames = paginatedIndices.map(idx => ws.frames[idx]!);
        const frameData = buildFrameData(
          paginatedFrames,
          0,
          params.showContent,
        );

        return {
          success: true,
          message: lines.join('\n'),
          data: {
            wsid: params.wsid,
            mode: 'group',
            groupId,
            frames: frameData,
            pagination: {
              pageIdx,
              pageSize,
              total: filteredIndices.length,
              totalPages: Math.ceil(filteredIndices.length / pageSize),
            },
          },
        };
      }

      const lines = formatRecentMessages(frames, {pageSize, pageIdx});

      const offset = pageIdx * pageSize;
      const pageFrames = frames.slice(offset, offset + pageSize);
      const frameData = buildFrameData(pageFrames, offset, params.showContent);

      return {
        success: true,
        message: lines.join('\n'),
        data: {
          wsid: params.wsid,
          mode: 'recent',
          frames: frameData,
          pagination: {
            pageIdx,
            pageSize,
            total: frames.length,
            totalPages: Math.ceil(frames.length / pageSize),
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        data: null,
      };
    }
  }

  /**
   * 获取单条 WebSocket 消息（按帧索引）。
   */
  getWebSocketMessage(
    services: NetworkServices,
    params: GetWebSocketMessageParams,
  ): NetworkMethodResult<GetWebSocketMessageData> {
    try {
      const ws = services.getWebSocketConnectionById(params.wsid);
      const frameIndex = params.frameIndex;

      if (frameIndex >= ws.frames.length) {
        return {
          success: false,
          message: `Frame index ${frameIndex} out of range. Total frames: ${ws.frames.length}`,
          data: {
            wsid: params.wsid,
            frameIndex,
            totalFrames: ws.frames.length,
          },
        };
      }

      const frame = ws.frames[frameIndex];
      const lines = formatWebSocketFrameDetail(frame, frameIndex);

      return {
        success: true,
        message: lines.join('\n'),
        data: {
          wsid: params.wsid,
          frameIndex,
          frame: {
            direction: frame.direction,
            timestamp: frame.timestamp,
            timestampISO: new Date(frame.timestamp).toISOString(),
            opcode: frame.opcode,
            payloadSize: frame.payloadData.length,
            payloadPreview: frame.payloadData.slice(0, 500),
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        data: null,
      };
    }
  }

  /**
   * 分析 WebSocket 消息，按模式/指纹分组。结果缓存到 `trafficSummaryCache`。
   */
  async analyzeWebSocketMessages(
    services: NetworkServices,
    params: AnalyzeWebSocketMessagesParams,
  ): Promise<NetworkMethodResult<AnalyzeWebSocketMessagesData>> {
    try {
      const ws = services.getWebSocketConnectionById(params.wsid);

      // Always analyze full frames so cached group indices stay valid
      // regardless of direction. getWebSocketMessages relies on these
      // indices being relative to ws.frames, not a filtered subset.
      const summary = analyzeWebSocketFramesV2(
        ws.frames,
        params.wsid,
        ws.connection.url,
      );
      this.trafficSummaryCache.set(params.wsid, summary);

      const lines = formatTrafficSummary(summary);

      let groups = summary.groups.map(g => ({
        id: g.id,
        direction: g.direction,
        head4B: g.head4B,
        hint: g.hint,
        count: g.count,
        sizeRange: {
          min: g.minSize,
          max: g.maxSize,
          minFormatted:
            g.minSize < 1024
              ? `${g.minSize}B`
              : `${(g.minSize / 1024).toFixed(1)}KB`,
          maxFormatted:
            g.maxSize < 1024
              ? `${g.maxSize}B`
              : `${(g.maxSize / 1024).toFixed(1)}KB`,
        },
        sampleIndices: g.sampleIndices,
      }));

      if (params.direction) {
        groups = groups.filter(g => g.direction === params.direction);
      }

      return {
        success: true,
        message: lines.join('\n'),
        data: {
          wsid: params.wsid,
          url: summary.url,
          durationMs: summary.durationMs,
          totalFrames: summary.totalFrames,
          sentCount: summary.sentCount,
          receivedCount: summary.receivedCount,
          groups,
          pagination: {
            groupCount: groups.length,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        data: null,
      };
    }
  }
}
