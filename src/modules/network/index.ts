/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Network 模块公共导出。
 *
 * 遵循 `wasm`/`hook` 模块模式：facade 类 + 纯领域逻辑 + 类型。
 * 通过 `runtime.networkModule` 访问 facade 实例。
 */

// Facade
export {NetworkModule} from './NetworkModule.js';

// 纯领域逻辑
export {
  STRIPPED_HEADERS,
  stripManagedHeaders,
  buildReplayRequest,
  emptyReplayResponse,
  executeReplay,
  formatCurl,
} from './replayEngine.js';

export {buildEvidenceCorrelations} from './signatureDetector.js';
export {SIGNATURE_HEADER_PATTERN} from './constants.js';

// 类型
export type {
  NetworkServices,
  DevToolsData,
  RequestInitiator,
  WebSocketStatus,
  WebSocketDirection,
  WebSocketConnection,
  WebSocketFrame,
  WebSocketData,
  NetworkMethodResult,
  // 请求参数与数据
  ListNetworkRequestsParams,
  GetNetworkRequestParams,
  ClearNetworkRequestsParams,
  NetworkRequestData,
  ListNetworkRequestsData,
  NetworkEvidenceCorrelation,
  ClearNetworkRequestsData,
  GetNetworkRequestData,
  // WebSocket 参数与数据
  ListWebSocketConnectionsParams,
  GetWebSocketMessagesParams,
  GetWebSocketMessageParams,
  AnalyzeWebSocketMessagesParams,
  ListWebSocketConnectionsData,
  GetWebSocketMessageData,
  GetWebSocketMessagesData,
  // Replay
  ReplayOverride,
  BuiltReplayRequest,
  ReplayResponse,
  BatchVariantResult,
  BatchReplayResult,
  ReplayNetworkRequestParams,
  ReplayNetworkRequestData,
  ExportRequestAsCurlParams,
  ExportRequestAsCurlData,
  ReplayNetworkRequestBatchParams,
  ReplayNetworkRequestBatchData,
  TrafficSummary,
  AnalyzeWebSocketMessagesData,
} from './NetworkTypes.js';

export {FILTERABLE_RESOURCE_TYPES} from './NetworkTypes.js';
