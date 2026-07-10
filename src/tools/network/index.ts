/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── Network 工具（defineTool 模式）──────────────────

export {listNetworkRequests} from './listNetworkRequests.js';
export {getNetworkRequest} from './getNetworkRequest.js';
export {clearNetworkRequests} from './clearNetworkRequests.js';
export {replayNetworkRequest} from './replayNetworkRequest.js';
export {exportRequestAsCurl} from './exportRequestAsCurl.js';
export {replayNetworkRequestBatch} from './replayNetworkRequestBatch.js';

// ─── WebSocket 工具（defineTool 模式）──────────────────

export {listWebSocketConnections} from './listConnections.js';
export {getWebSocketMessages} from './getMessages.js';
export {getWebSocketMessage} from './getMessage.js';
export {analyzeWebSocketMessages} from './analyzeMessages.js';

// ─── WebSocket Collector（遗留实现，保留以兼容）──────────────────

export {WebSocketCollector} from './WebSocketCollector.js';

// ─── 类型与领域逻辑（自 modules/network 单向 re-export）──────────────────

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
  // 请求参数与数据类型
  ListNetworkRequestsParams,
  GetNetworkRequestParams,
  ClearNetworkRequestsParams,
  NetworkRequestData,
  ListNetworkRequestsData,
  NetworkEvidenceCorrelation,
  ClearNetworkRequestsData,
  GetNetworkRequestData,
  // WebSocket 参数类型
  ListWebSocketConnectionsParams,
  GetWebSocketMessagesParams,
  GetWebSocketMessageParams,
  AnalyzeWebSocketMessagesParams,
  ListWebSocketConnectionsData,
  GetWebSocketMessageData,
  // Replay 参数与数据类型
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
} from '../../modules/network/NetworkTypes.js';
export {FILTERABLE_RESOURCE_TYPES} from '../../modules/network/NetworkTypes.js';

// ─── 领域逻辑 re-export（供需要直接调用的调用方）──────────────────

export {
  STRIPPED_HEADERS,
  stripManagedHeaders,
  buildReplayRequest,
  emptyReplayResponse,
  executeReplay,
  formatCurl,
} from '../../modules/network/replayEngine.js';
export {buildEvidenceCorrelations} from '../../modules/network/signatureDetector.js';
export {SIGNATURE_HEADER_PATTERN} from '../../modules/network/constants.js';
