/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Facade
export {MitmModule} from './MitmModule.js';
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
  MAX_BODY_SIZE,
  bodyToUtf8,
  decodeCapturedBody,
  fixHeadersAfterBodyRewrite,
  isBinaryContentType,
} from './body.js';

// 类型
export type {
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
  ExportMitmHarParams,
  ExportMitmHarData,
} from './types.js';
