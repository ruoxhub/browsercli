/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {HTTPRequest, ResourceType} from '../../third_party/index.js';

// ─── 可过滤的资源类型 ──────────────────────────────────

/** 可过滤的网络请求资源类型列表 */
export const FILTERABLE_RESOURCE_TYPES: readonly [
  ResourceType,
  ...ResourceType[],
] = [
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
  /** 获取当前选中页面的所有网络请求 */
  getNetworkRequests: (includePreservedRequests?: boolean) => HTTPRequest[];
  /** 通过稳定 ID 获取单条网络请求 */
  getNetworkRequestById: (reqid: number) => HTTPRequest;
  /** 获取请求的稳定 ID */
  getNetworkRequestStableId: (request: HTTPRequest) => number;
  /** 获取请求发起者信息 */
  getRequestInitiator: (
    request: HTTPRequest,
  ) => RequestInitiator | undefined;
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
  /** 页码（0-based），省略返回第一页 */
  pageIdx?: number;
  /** 按资源类型过滤 */
  resourceTypes?: ResourceType[];
  /** 是否包含最近 3 次导航的保留请求 */
  includePreservedRequests?: boolean;
}

/** getNetworkRequest 参数 */
export interface GetNetworkRequestParams {
  /** 网络请求稳定 ID，省略则使用 DevTools 中当前选中的请求 */
  reqid?: number;
}

// ─── 数据类型 ──────────────────────────────────────────

/** 单条网络请求的摘要数据 */
export interface NetworkRequestData {
  /** 稳定 ID */
  reqid: number;
  /** 请求 URL */
  url: string;
  /** HTTP 方法 */
  method: string;
  /** 资源类型 */
  resourceType: string;
  /** HTTP 状态码 */
  statusCode: number;
  /** 请求头 */
  requestHeaders: Record<string, string>;
  /** 响应头 */
  responseHeaders: Record<string, string>;
  /** 请求发起者 */
  initiator?: RequestInitiator;
}

/** listNetworkRequests 返回数据 */
export interface ListNetworkRequestsData {
  requests: NetworkRequestData[];
  total: number;
  pageIdx: number;
  pageSize: number | undefined;
}

/** getNetworkRequest 返回数据 */
export interface GetNetworkRequestData extends NetworkRequestData {}

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
