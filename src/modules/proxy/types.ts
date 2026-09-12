/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ClientProcessMeta {
  pid: number;
  name: string;
  path?: string;
}

/** 服务器回调产生的原始捕获记录（无稳定 id）。 */
export interface CapturedExchange {
  requestId: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  contentType: string | null;
  isOptions: boolean;
  isStatic: boolean;
  isStreaming: boolean;
  isWebSocket: boolean;
  truncated: boolean;
  timestamp: number;
  /** 客户端 IP 地址（若可用）。 */
  clientIp?: string;
  /** 请求往返耗时（毫秒）。 */
  durationMs?: number;
  /** 任一改写规则命中，默认 false。Session 水槽不摄入带此标记的 exchange（见 MitmModule.recordExchange）。 */
  modified: boolean;
  /** 命中的规则 id（可空），供证据追溯。 */
  appliedRuleIds?: string[];
  /** 响应体真实总字节数（二进制/截断时不丢证据）。 */
  responseBodySize?: number;
  /** 二进制且未截断时，缓冲字节的 base64（≤ MAX_BODY_SIZE）。 */
  responseBodyBase64?: string | null;
  /** 发起请求的客户端本地进程元数据（Local Apps 模式填充）。 */
  clientProcess?: ClientProcessMeta;
}

export interface LocalAppsConfig {
  enabled: boolean;
  targets: string[]; // 空数组代表全部进程
  systemProxyActive: boolean;
}

export interface LocalAppsStatus extends LocalAppsConfig {
  trackerDegraded: boolean;
  systemProxyUnsupported: boolean;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  path?: string;
  displayName?: string;
}

/** ProxyStore 中带稳定 id 的存储记录。 */
export type CapturedRequest = CapturedExchange & {id: number};

/** MitmModule 各方法统一返回结构。 */
export interface MitmMethodResult<T> {
  success: boolean;
  message: string;
  data: T;
}

// ─── 改写上下文与动作 ──────────────────────────────

/** beforeRequest 入参：归一化后的转发前请求视图。 */
export interface RequestContext {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** 完整请求体缓冲（可能空）。 */
  body: Buffer;
}

/** afterResponse 入参：响应视图。截断时 body 为 null。 */
export interface ResponseContext {
  requestId: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: Buffer | null;
  statusCode: number;
  headers: Record<string, string>;
  /** ≤阈值且已完整 buffer 时为未解码字节；截断时为 null。 */
  body: Buffer | null;
  truncated: boolean;
}

export interface RequestModification {
  method?: string;
  /** map_remote：重写目标 URL（支持 $1..$n 捕获组替换）。 */
  url?: string;
  setHeaders?: Record<string, string>;
  removeHeaders?: string[];
  /** 替换整个请求体（Buffer 保证 content-length 正确）。 */
  body?: Buffer;
}

export interface ResponseModification {
  setHeaders?: Record<string, string>;
  removeHeaders?: string[];
  /** 替换整个响应体（utf8 编码后发 identity）。 */
  body?: Buffer;
}

export type BeforeRequestResult =
  | {
      action: 'block';
      statusCode: number;
      /** true（或 statusCode===444）时直接断连不发响应。 */
      closeConnection?: boolean;
      body?: string;
      appliedRuleIds: string[];
    }
  | {
      action: 'respond';
      statusCode: number;
      headers?: Record<string, string>;
      body: Buffer;
      appliedRuleIds: string[];
    }
  | {
      action: 'forward';
      modification?: RequestModification;
      appliedRuleIds: string[];
    };

export interface AfterResponseResult {
  action: 'forward';
  modification?: ResponseModification;
  appliedRuleIds: string[];
}

/** MitmProxyServer 的改写插桩接口（构造第三参注入）。 */
export interface MitmInterceptor {
  beforeRequest?(ctx: RequestContext): BeforeRequestResult | void;
  afterResponse?(ctx: ResponseContext): AfterResponseResult | void;
  /** server 据此决定 relay 走 live-pipe 还是 buffer-then-decide。 */
  hasResponseBodyRules(): boolean;
}

// ─── 规则模型（判别联合）────────────────────────────

export type MitmRewriteAction =
  | {
      type: 'block';
      statusCode: number;
      closeConnection?: boolean;
      body?: string;
    }
  | {
      type: 'map_local';
      /** 目标 URL 匹配正则（可含捕获组，指向本地文件路径尾部）。 */
      urlRegex: string;
      localPath: string;
      statusCode?: number;
      contentType?: string;
    }
  | {type: 'map_remote'; urlRegex: string; replacement: string}
  | {
      type: 'modify_header';
      phase: 'request' | 'response';
      set?: Record<string, string>;
      remove?: string[];
    }
  | {
      type: 'modify_body';
      phase: 'request' | 'response';
      find: string;
      replace: string;
      regex?: boolean;
    };

export interface MitmRewriteRule {
  /** 工具层可显式给，缺省自动生成 rewrite-<n>。同 id 覆盖。 */
  id: string;
  action: MitmRewriteAction;
  enabled: boolean;
  /**
   * 匹配谓词（AND 组合，全空 = 命中所有）。
   * map_local / map_remote 专用 urlRegex 走 action 侧；此处 urlRegex 只作过滤。
   */
  urlFilter?: string;
  method?: string;
  host?: string;
  headerContains?: {name: string; value: string};
  bodyContains?: string;
  /** mitmproxy 风格的流过滤表达式（如 "~m POST & ~c 200"）。 */
  filter?: string;
}

// ─── 过滤谓词（list_mitm_requests 与规则匹配共用）────────────────────────────

export interface RequestPredicate {
  filter?: string;
  urlFilter?: string;
  urlRegex?: string;
  method?: string;
  host?: string;
  statusCode?: number;
  headerContains?: {name: string; value: string};
  bodyContains?: string;
}

// ─── 二级外部代理配置 ────────────────────────────────

export type UpstreamProxyProtocol =
  | 'http'
  | 'https'
  | 'socks5'
  | 'socks5h'
  | 'socks';

export interface UpstreamProxyConfig {
  protocol: UpstreamProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** 可选：不走二级代理的目标主机列表（支持通配符如 *.local, .corp.net 等） */
  bypassHosts?: string[];
  /** 连接超时时间（毫秒，默认 15000） */
  timeoutMs?: number;
}

// ─── 工具参数与结果类型 ──────────────────────────────

export interface StartMitmProxyParams {
  port?: number;
  upstreamProxy?: string | UpstreamProxyConfig;
}

export interface StartMitmProxyData {
  port: number;
  caCertPath: string;
  caInitialized: boolean;
  upstreamProxy?: string | null;
}

export interface MitmProxyStatusData {
  running: boolean;
  port: number | null;
  capturedCount: number;
  upstreamProxy?: string | null;
}

export interface ListMitmRequestsParams {
  pageSize?: number;
  pageIdx?: number;
  /** mitmproxy 风格的流过滤表达式（如 "~m POST & ~c 200"、"!~a ~d example.com"）。 */
  filter?: string;
  urlFilter?: string;
  method?: string;
  statusCode?: number;
  host?: string;
  headerContains?: {name: string; value: string};
  bodyContains?: string;
}

export interface MitmRequestSummary {
  id: number;
  method: string;
  url: string;
  statusCode: number;
  contentType: string | null;
  timestamp: number;
  modified: boolean;
  truncated: boolean;
}

export interface ListMitmRequestsData {
  requests: MitmRequestSummary[];
  total: number;
  pageIdx: number;
  pageSize: number | undefined;
}

export interface GetMitmRequestParams {
  id: number;
  saveTo?: string;
  format?: 'curl';
}

export interface GetMitmRequestData {
  id: number;
  requestId: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  contentType: string | null;
  isStatic: boolean;
  isStreaming: boolean;
  isWebSocket: boolean;
  truncated: boolean;
  timestamp: number;
  savedPath?: string;
  modified: boolean;
  appliedRuleIds?: string[];
  responseBodySize?: number;
  responseBodyBase64?: string | null;
  curl?: string;
}

export interface ClearMitmRequestsData {
  clearedCount: number;
}

export interface ExportMitmCaParams {
  format: 'pem' | 'der';
  outputPath: string;
}

export interface ExportMitmCaData {
  format: 'pem' | 'der';
  outputPath: string;
  bytes: number;
}

export interface AddMitmRuleParams {
  action: MitmRewriteAction;
  id?: string;
  enabled?: boolean;
  urlFilter?: string;
  method?: string;
  host?: string;
  headerContains?: {name: string; value: string};
  bodyContains?: string;
}

export interface AddMitmRuleData {
  rule: MitmRewriteRule;
}

export interface RemoveMitmRuleParams {
  id: string;
}

export interface RemoveMitmRuleData {
  removed: boolean;
}

export interface ListMitmRulesData {
  rules: MitmRewriteRule[];
}

export interface ClearMitmRulesData {
  clearedCount: number;
}

// ─── 域名过滤 ──────────────────────────────

export type HostFilterAction = 'allow' | 'block';

export interface AddHostFilterParams {
  action: HostFilterAction;
  host: string;
}

export interface AddHostFilterData {
  action: HostFilterAction;
  host: string;
}

export interface RemoveHostFilterParams {
  action: HostFilterAction;
  host: string;
}

export interface RemoveHostFilterData {
  removed: boolean;
}

export interface ListHostFiltersData {
  allow: string[];
  block: string[];
}

export interface ClearHostFiltersData {
  clearedCount: number;
}

export interface ExportMitmHarParams {
  outputPath?: string;
}

export interface ExportMitmHarData {
  har: Record<string, unknown>;
  entryCount: number;
  outputPath?: string;
}
