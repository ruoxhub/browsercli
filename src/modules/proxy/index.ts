/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Facade
export {MitmModule} from './MitmModule.js';
export {ProxyCli, tokenizeLine} from './ProxyCli.js';
export {CaManager, resolveMitmCertsDir} from './CaManager.js';
export {MitmProxyServer} from './MitmProxyServer.js';
export {ProxyStore} from './ProxyStore.js';
export {
  MitmRuleEngine,
  matchesPredicate,
  applyHeaderChanges,
  type RequestPredicateView,
} from './rewrite.js';
export {
  compileFlowFilter,
  matchesFlowFilter,
  FLOW_FILTER_HELP,
  hasDeepFilter,
  type FilterableFlow,
  type FlowFilterHelpItem,
  type FlowFilterOptions,
} from './flowFilter.js';
export {
  MAX_BODY_SIZE,
  bodyToUtf8,
  decodeCapturedBody,
  fixHeadersAfterBodyRewrite,
  isBinaryContentType,
} from './body.js';
export {normalizeHost} from './hostFilter.js';
export {matchesProcessName} from './processMatch.js';
export {
  ProcessConnectionTracker,
  parseNetstatOutput,
  parseTasklistLine,
  parseTasklistOutput,
  type ProcessInfo,
  type RunCommand,
} from './ProcessConnectionTracker.js';
export {
  SystemProxyManager,
  type SystemProxyState,
  type SystemProxyManagerOpts,
} from './SystemProxyManager.js';
export {
  parseSocks5Url,
  connectSocks5,
  createSocks5HttpConnector,
  createSocks5HttpsConnector,
  type Socks5Config,
  type Socks5Target,
} from './socks5.js';
export {
  parseUpstreamProxyUrl,
  normalizeUpstreamProxy,
  formatUpstreamProxy,
  shouldBypassUpstream,
  parseNoProxy,
  connectHttpProxy,
  connectUpstream,
  createUpstreamHttpConnector,
  createUpstreamHttpsConnector,
  type UpstreamProxyProtocol,
  type UpstreamProxyConfig,
  type UpstreamTarget,
} from './upstream.js';

// 类型
export type {
  ClientProcessMeta,
  LocalAppsConfig,
  LocalAppsStatus,
  CapturedExchange,
  CapturedRequest,
  MitmMethodResult,
  RequestContext,
  ResponseContext,
  RequestModification,
  ResponseModification,
  BeforeRequestResult,
  AfterResponseResult,
  MitmInterceptor,
  MitmRewriteAction,
  MitmRewriteRule,
  RequestPredicate,
  StartMitmProxyParams,
  StartMitmProxyData,
  MitmProxyStatusData,
  ListMitmRequestsParams,
  MitmRequestSummary,
  ListMitmRequestsData,
  GetMitmRequestParams,
  GetMitmRequestData,
  ClearMitmRequestsData,
  ExportMitmCaParams,
  ExportMitmCaData,
  AddMitmRuleParams,
  AddMitmRuleData,
  RemoveMitmRuleParams,
  RemoveMitmRuleData,
  ListMitmRulesData,
  ClearMitmRulesData,
  HostFilterAction,
  AddHostFilterParams,
  AddHostFilterData,
  RemoveHostFilterParams,
  RemoveHostFilterData,
  ListHostFiltersData,
  ClearHostFiltersData,
  ExportMitmHarParams,
  ExportMitmHarData,
} from './types.js';
