/**
 * @license
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Network 模块类型定义。
 *
 * 迁移自 `tools/network/types.ts` 与 `tools/network/WebSocketCollector.ts` 中的纯类型，
 * 并新增 `NetworkServices` 接口（对齐 `ToolContextProvider` 的网络方法子集）。
 *
 * 注意：本文件不得 import `worker/` 或 `tools/`，以避免循环依赖。
 * `TrafficSummary` 仍由 `formatters/websocketFormatter.ts` 拥有，这里仅 type-only re-export。
 */

import type {TrafficSummary} from '../../formatters/websocketFormatter.js';
import type {HTTPRequest, Page, ResourceType} from '../../third_party/index.js';
import type {PageSelector, ResolvedPage} from '../browser/PageIdentity.js';

// ─── 可过滤的资源类型 ──────────────────────────────────

/** 可过滤的网络请求资源类型列表 */
export const FILTERABLE_RESOURCE_TYPES: [ResourceType, ...ResourceType[]] = [
  'document',
  'stylesheet',
  'image',
  'media',
  'font',
  'script',
  'text-track',
  'xhr',
  'fetch',
  'event-source',
  'websocket',
  'manifest',
  'signed-exchange',
  'ping',
  'csp-violation-report',
  'preflight',
  'other',
];

// ─── 运行时服务接口 ──────────────────────────────────

/**
 * Network 运行时服务接口。
 *
 * `NetworkModule` 的方法通过此接口访问网络请求数据，调用方（tool handler）
 * 负责传入具体实现（`ToolContextProvider` 结构化满足此接口）。
 *
 * 对齐 `ToolContextProvider` 的网络方法子集（注意：不是 `DefineToolContextFactory.Context`，
 * 后者方法名不同且只暴露部分 API）。
 */
export interface NetworkServices {
  resolvePage(selector: PageSelector): ResolvedPage;
  /** 获取所有已打开的页面 */
  getPages(): Page[];
  /** 获取当前选中的页面（无选中时返回 null） */
  getSelectedPage(): Page | null;
  /** 获取当前选中的页面索引（可选，解析器在缺失时回退到 getPages 查找） */
  getSelectedPageIndex?(): number | null;
  /** 获取指定页面的所有网络请求 */
  getNetworkRequests(
    includePreservedRequests?: boolean,
    pageIdx?: number,
  ): HTTPRequest[];
  getNetworkRequestsForPage(
    page: Page,
    includePreservedRequests?: boolean,
  ): HTTPRequest[];
  /** 通过稳定 ID 获取单条网络请求 */
  getNetworkRequestById(reqid: number): HTTPRequest;
  /** 获取请求的稳定 ID */
  getNetworkRequestStableId(request: HTTPRequest): number;
  /** 获取请求发起者信息 */
  getRequestInitiator(request: HTTPRequest): RequestInitiator | undefined;
  /** 清空指定页面的网络请求缓存 */
  clearNetworkRequests(pageIdx?: number): void;
  clearNetworkRequestsForPage(page: Page): void;
  /** 获取所有 WebSocket 连接 */
  getWebSocketConnections(includePreservedData?: boolean): WebSocketData[];
  /** 通过稳定 ID 获取 WebSocket 连接 */
  getWebSocketConnectionById(wsid: number): WebSocketData;
  /** 获取 WebSocket 连接的稳定 ID */
  getWebSocketStableId(ws: unknown): number;
  /** 获取 DevTools UI 中当前选中的请求数据 */
  getDevToolsData(): Promise<DevToolsData | undefined>;
  /** 将 CDP request ID 解析为稳定 ID */
  resolveCdpRequestId(cdpRequestId: string): number | undefined;
}

/** DevTools 数据 */
export interface DevToolsData {
  cdpRequestId?: string;
  cdpBackendNodeId?: number;
}

/** 请求发起者信息 */
export interface RequestInitiator {
  type:
    | 'parser'
    | 'script'
    | 'preload'
    | 'SignedExchange'
    | 'preflight'
    | 'other';
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  stack?: {
    callFrames: Array<{
      functionName: string;
      scriptId: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    }>;
    parent?: {
      callFrames: Array<{
        functionName: string;
        scriptId: string;
        url: string;
        lineNumber: number;
        columnNumber: number;
      }>;
    };
  };
}

// ─── WebSocket 类型（迁自 WebSocketCollector.ts）──────────────────

/** WebSocket connection status. */
export type WebSocketStatus = 'connecting' | 'open' | 'closed';

/** WebSocket frame direction. */
export type WebSocketDirection = 'sent' | 'received';

/** WebSocket connection information. */
export interface WebSocketConnection {
  requestId: string;
  url: string;
  initiator?: RequestInitiator;
  status: WebSocketStatus;
  createdAt: number;
  closedAt?: number;
}

/** WebSocket frame (message). */
export interface WebSocketFrame {
  requestId: string;
  direction: WebSocketDirection;
  timestamp: number;
  opcode: number; // 1=text, 2=binary
  payloadData: string;
}

/** Combined WebSocket data structure. */
export interface WebSocketData {
  connection: WebSocketConnection;
  frames: WebSocketFrame[];
}

// ─── 参数类型 ──────────────────────────────────────────

/** listNetworkRequests 参数 */
export interface ListNetworkRequestsParams {
  /** 每页最大条数，省略返回全部 */
  pageSize?: number;
  /** 结果分页页码，从 0 开始 */
  pageIdx?: number;
  /** 浏览器页面索引，省略时使用当前活跃页 */
  targetPageIdx?: number;
  targetPageId?: string;
  /** 按资源类型过滤 */
  resourceTypes?: ResourceType[];
  /** 是否包含最近 3 次导航的保留请求 */
  includePreservedRequests?: boolean;
  /** 是否包含浏览器扩展发起的请求 */
  includeExtensionRequests?: boolean;
  /** 等待匹配 URL 片段的请求出现 */
  waitForRequest?: string;
  /** 等待请求超时时间（毫秒） */
  waitTimeoutMs?: number;
  /** 按请求头关键词过滤 */
  headerFilter?: string;
  /** 按照 URL 关键词过滤（不区分大小写） */
  urlFilter?: string;
  /** 是否返回签名相关证据关联 */
  includeSignatureEvidence?: boolean;
}

/** getNetworkRequest 参数 */
export interface GetNetworkRequestParams {
  /** 网络请求稳定 ID，省略则使用 DevTools 中当前选中的请求 */
  reqid?: number;
  /** 响应体最大长度限制，默认 300 字符，超出部分截断 */
  maxBodyLength?: number;
  /** 返回完整响应体（跳过默认截断） */
  fullBody?: boolean;
  /** 将响应体写入指定文件路径，返回 savedPath，不写入响应内存 */
  saveTo?: string;
}

/** clearNetworkRequests 参数 */
export interface ClearNetworkRequestsParams {
  targetPageId?: string;
  /** 浏览器页面索引，省略时使用当前活跃页 */
  targetPageIdx?: number;
}

// ─── 数据类型 ──────────────────────────────────────────

/** 单条网络请求的摘要数据（精简版） */
export interface NetworkRequestData {
  /** 稳定 ID */
  reqid: number;
  /** 请求 URL */
  url: string;
  /** HTTP 方法 */
  method: string;
}

/** listNetworkRequests 返回数据 */
export interface ListNetworkRequestsData {
  requests: NetworkRequestData[];
  total: number;
  /** 结果分页页码 */
  pageIdx: number;
  /** 实际使用的浏览器页面索引 */
  targetPageIdx: number;
  targetPageId: string | null;
  pageSize: number | undefined;
  /** 是否因等待请求超时而提前返回 */
  timedOut?: boolean;
  /** 超时时等待的 URL 片段 */
  waitedFor?: string;
  /** 签名相关请求证据关联，仅 includeSignatureEvidence=true 时返回 */
  evidenceCorrelations?: NetworkEvidenceCorrelation[];
}

export interface NetworkEvidenceCorrelation {
  reqid: number;
  signatureIndicators: string[];
  initiator?: RequestInitiator;
  nextSteps: string[];
}

/** clearNetworkRequests 返回数据 */
export interface ClearNetworkRequestsData {
  /** 实际清空的请求数量 */
  clearedCount: number;
  /** 实际清空的浏览器页面索引 */
  targetPageIdx: number;
  targetPageId: string | null;
}

/** getNetworkRequest 返回数据（完整详情） */
export interface GetNetworkRequestData {
  /** 稳定 ID */
  reqid: number;
  /** 请求 URL */
  url: string;
  /** HTTP 方法 */
  method: string;
  /** 资源类型 */
  resourceType: string;
  /** POST 数据 */
  postData?: string;
  /** HTTP 状态码 */
  statusCode: number;
  /** 状态文本 */
  statusText?: string;
  /** 请求头 */
  requestHeaders: Record<string, string>;
  /** 响应头 */
  responseHeaders: Record<string, string>;
  /** 请求发起者 */
  initiator?: RequestInitiator;
  /** 调用堆栈 */
  stack?: RequestInitiator['stack'];
  /** 请求时间戳 */
  timestamp?: number;
  /** 响应体（文本，如果可读取） */
  responseBody?: string;
  /** 响应体是否被截断 */
  isTruncated: boolean;
  /** 完整响应体长度（字符） */
  totalBodyLength: number;
  /** 实际返回的预览长度 */
  previewLength: number;
  /** saveTo 时写入的文件路径 */
  savedPath?: string;
}

// ─── WebSocket 参数类型 ──────────────────────────────────

/** WebSocket 连接列表参数 */
export interface ListWebSocketConnectionsParams {
  pageSize?: number;
  pageIdx?: number;
  urlFilter?: string;
  includePreservedConnections?: boolean;
}

/** WebSocket 消息列表参数 */
export interface GetWebSocketMessagesParams {
  wsid: number;
  direction?: 'sent' | 'received';
  groupId?: string;
  pageSize?: number;
  pageIdx?: number;
  showContent?: boolean;
}

/** WebSocket 单帧参数 */
export interface GetWebSocketMessageParams {
  wsid: number;
  frameIndex: number;
}

/** WebSocket 分析参数 */
export interface AnalyzeWebSocketMessagesParams {
  wsid: number;
  direction?: 'sent' | 'received';
}

// ─── Replay 类型 ──────────────────────────────────────────

/** Replay 时可覆盖的字段。全部可选。 */
export interface ReplayOverride {
  /** 覆盖 HTTP 方法（大写化） */
  method?: string;
  /** 覆盖请求 URL */
  url?: string;
  /** 与原始 headers 合并（覆盖同名键，大小写不敏感）；replaceHeaders=true 时整体替换 */
  headers?: Record<string, string>;
  /** 整体替换请求体；null 清空 body；省略保留原始 */
  body?: string | null;
  /** 默认 false=合并；true=headers 参数整体替换原始 headers */
  replaceHeaders?: boolean;
}

/** 发送给 APIRequestContext 的构建结果。 */
export interface BuiltReplayRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** 单次 replay 的归一化响应。 */
export interface ReplayResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyTruncated: boolean;
  timingMs: number;
  replayedUrl: string;
}

/** 批量 replay 中单个 variant 的结果。 */
export interface BatchVariantResult {
  index: number;
  override: ReplayOverride;
  result: ReplayResponse;
  /** executeReplay 抛出时设置；HTTP 4xx/5xx 不视为 error */
  error?: string;
}

/** 批量 replay 聚合结果。 */
export interface BatchReplayResult {
  total: number;
  succeeded: number;
  failed: number;
  statusCodeDistribution: Record<number, number>;
  results: BatchVariantResult[];
}

// ─── Replay 参数与结果类型 ──────────────────────────────────

/** replay_network_request 参数 */
export interface ReplayNetworkRequestParams {
  reqid: number;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string | null;
  replaceHeaders?: boolean;
  maxBodyLength?: number;
}

/** replay_network_request 返回数据 */
export interface ReplayNetworkRequestData extends ReplayResponse {
  originalReqid: number;
  override: ReplayOverride | null;
}

/** export_request_as_curl 参数 */
export interface ExportRequestAsCurlParams {
  reqid: number;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string | null;
  replaceHeaders?: boolean;
  includeCookies?: boolean;
}

/** export_request_as_curl 返回数据 */
export interface ExportRequestAsCurlData {
  curl: string;
  originalReqid: number;
  override: ReplayOverride | null;
}

/** replay_network_request_batch 参数 */
export interface ReplayNetworkRequestBatchParams {
  reqid: number;
  variants: ReplayOverride[];
  concurrency?: number;
  maxBodyLength?: number;
}

/** replay_network_request_batch 返回数据 */
export type ReplayNetworkRequestBatchData = BatchReplayResult;

// ─── WebSocket 返回数据类型 ──────────────────────────────────

/** list_websocket_connections 返回数据 */
export interface ListWebSocketConnectionsData {
  connections: Array<{
    wsid: number;
    url: string;
    state: WebSocketStatus;
    frameCount: number;
  }>;
  total: number;
  pageIdx: number;
  pageSize: number;
}

/** get_websocket_message 返回数据 */
export interface GetWebSocketMessageData {
  wsid: number;
  frameIndex: number;
  totalFrames?: number;
  frame?: {
    direction: WebSocketDirection;
    timestamp: number;
    timestampISO: string;
    opcode: number;
    payloadSize: number;
    payloadPreview: string;
  };
}

/** get_websocket_messages 返回数据 */
export interface GetWebSocketMessagesData {
  wsid: number;
  mode?: 'recent' | 'group';
  groupId?: string;
  frames?: Array<Record<string, unknown>>;
  pagination?: {
    pageIdx: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  availableGroups?: string[];
}

/** analyze_websocket_messages 返回数据 */
export interface AnalyzeWebSocketMessagesData {
  wsid: number;
  url: string;
  durationMs: number;
  totalFrames: number;
  sentCount: number;
  receivedCount: number;
  groups: Array<{
    id: string;
    direction: WebSocketDirection;
    head4B: string;
    hint: string;
    count: number;
    sizeRange: {
      min: number;
      max: number;
      minFormatted: string;
      maxFormatted: string;
    };
    sampleIndices: number[];
  }>;
  pagination: {
    groupCount: number;
  };
}

// ─── 通用方法结果类型 ──────────────────────────────────

/**
 * `NetworkModule` 各方法的统一返回结构。
 * tool handler 在此基础上追加 `tooltype` / `logFormat` 后写入 response。
 */
export interface NetworkMethodResult<T> {
  success: boolean;
  message: string;
  data: T;
}

/** 重新导出 TrafficSummary（由 formatters/websocketFormatter 拥有） */
export type {TrafficSummary};
