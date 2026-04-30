/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {normalizeCollectedFiles, toRecord, toMirroredNetworkEntry, toMirroredScriptEntry} from './normalize.js';
export {buildHookTimeline} from './timeline.js';
export {correlateNetworkFlows} from './flows.js';
export {buildUrlPattern, buildRequestFingerprints, buildPriorityTargets} from './fingerprints.js';
export {extractSignatureChainHints} from './signature.js';
export {buildActionPlan, buildWhyTheseSteps, buildStopConditions, recordReverseEvidence, exportSessionReport} from './reports.js';
export {pickHookTypes} from './hooks.js';
export {analyzeTarget} from './analyzeTarget.js';
export {deobfuscateCode} from './deobfuscate.js';
export {understandCode} from './understand.js';
export {summarizeFile, summarizeBatch, summarizeProject, summarizeCode} from './summarize.js';
export {detectCrypto} from './detectCrypto.js';
export {riskPanel} from './riskPanel.js';
export type {AnalyzeTargetParams} from './analyzeTarget.js';
export type {
  AnalyzerResult,
  AnalyzerRuntimeServices,
  HookTimelineEntry,
  CorrelatedFlow,
  RequestFingerprint,
  PriorityTarget,
  SignatureChainHints,
  HookPreset,
  CollectedFileEntry,
  AnalyzeTargetResult,
  DeobfuscateCodeResult,
  UnderstandCodeFnResult,
  SummarizeFileResult,
  SummarizeBatchResult,
  SummarizeProjectResult,
  DetectCryptoFnResult,
  RiskPanelResult,
  Frame,
} from './types.js';