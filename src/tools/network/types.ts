/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {HTTPRequest, Page, ResourceType} from '../../third_party/index.js';

// ─── 可过滤的资源类型 ──────────────────────────────────

/** 可过滤的网络请求资源类型列表 */
export const FILTERABLE_RESOURCE_TYPES: [ResourceType, ...ResourceType[]] = [
  'document',
  'stylesheet',
  'image',
  'media',
  'font',
  'script',
  'texttrack',
  'xhr',
  'fetch',
  'prefetch',
  'eventsource',
  'websocket',
  'manifest',
  'signedexchange',
  'ping',
  'cspviolationreport',
  'preflight',
  'fedcm',
  'other',
];

// ─── 运行时服务接口 ──────────────────────────────────

/**
 * Network 运行时服务（从 McpContext 提取的接口）。
 *
 * 纯函数通过此接口访问网络请求数据，
 * 调用方负责提供具体实现（如直接传入 McpContext 的方法绑定）。
 */
export interface NetworkRuntimeServices {
  /** 获取所有已打开的页面（可选，用于推导当前活跃页索引） */
  getPages?: () => Page[];
  /** 获取当前选中的页面（可选，用于推导当前活跃页索引） */
  getSelectedPage?: () => Page | null;
  /** 获取当前选中的页面索引（可选） */
  getSelectedPageIndex?: () => number | null;
  /** 获取当前选中页面的所有网络请求 */
  getNetworkRequests: (
    includePreservedRequests?: boolean,
    pageIdx?: number,
  ) => HTTPRequest[];
  /** 通过稳定 ID 获取单条网络请求 */
  getNetworkRequestById: (reqid: number) => HTTPRequest;
  /** 获取请求的稳定 ID */
  getNetworkRequestStableId: (request: HTTPRequest) => number;
  /** 获取请求发起者信息 */
  getRequestInitiator: (request: HTTPRequest) => RequestInitiator | undefined;
  /** 获取 DevTools UI 中当前选中的请求数据 */
  getDevToolsData: () => Promise<DevToolsData | undefined>;
  /** 将 CDP request ID 解析为稳定 ID */
  resolveCdpRequestId: (cdpRequestId: string) => number | undefined;
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

// ─── 参数类型 ──────────────────────────────────────────

/** listNetworkRequests 参数 */
export interface ListNetworkRequestsParams {
  /** 每页最大条数，省略返回全部 */
  pageSize?: number;
  /** 结果分页页码，从 0 开始 */
  pageIdx?: number;
  /** 浏览器页面索引，省略时使用当前活跃页 */
  targetPageIdx?: number;
  /** 按资源类型过滤 */
  resourceTypes?: ResourceType[];
  /** 是否包含最近 3 次导航的保留请求 */
  includePreservedRequests?: boolean;
  /** 等待匹配 URL 片段的请求出现 */
  waitForRequest?: string;
  /** 等待请求超时时间（毫秒） */
  waitTimeoutMs?: number;
  /** 按请求头关键词过滤 */
  headerFilter?: string;
  /** 是否返回签名相关证据关联 */
  includeSignatureEvidence?: boolean;
}

/** getNetworkRequest 参数 */
export interface GetNetworkRequestParams {
  /** 网络请求稳定 ID，省略则使用 DevTools 中当前选中的请求 */
  reqid?: number;
  /** 响应体最大长度限制，默认 300 字符，超出部分截断 */
  maxBodyLength?: number;
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
  /** POST 数据 */
  postData?: string;
  /** 请求头 */
  requestHeaders?: Record<string, string>;
}

/** listNetworkRequests 返回数据 */
export interface ListNetworkRequestsData {
  requests: NetworkRequestData[];
  total: number;
  /** 结果分页页码 */
  pageIdx: number;
  /** 实际使用的浏览器页面索引 */
  targetPageIdx: number;
  pageSize: number | undefined;
  /** 是否因等待请求超时而提前返回 */
  timedOut?: boolean;
  /** 签名相关请求证据关联，仅 includeSignatureEvidence=true 时返回 */
  evidenceCorrelations?: NetworkEvidenceCorrelation[];
}

export interface NetworkEvidenceCorrelation {
  reqid: number;
  signatureIndicators: string[];
  initiator?: RequestInitiator;
  nextSteps: string[];
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
  /** 请求时间戳 */
  timestamp?: number;
  /** 响应体（文本，如果可读取） */
  responseBody?: string;
}

// ─── 结果类型 ──────────────────────────────────────────

/** listNetworkRequests 结果 */
export interface ListNetworkRequestsResult {
  success: boolean;
  message: string;
  tooltype: string;
  logFormat: string;
  data: ListNetworkRequestsData;
}

/** getNetworkRequest 结果 */
export interface GetNetworkRequestResult {
  success: boolean;
  message: string;
  tooltype: string;
  logFormat: string;
  data: GetNetworkRequestData;
}
