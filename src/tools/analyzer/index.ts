/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Helper functions (used internally)
export {normalizeCollectedFiles, toRecord, toMirroredNetworkEntry, toMirroredScriptEntry} from './normalize.js';
export {buildHookTimeline} from './timeline.js';
export {correlateNetworkFlows} from './flows.js';
export {buildUrlPattern, buildRequestFingerprints, buildPriorityTargets} from './fingerprints.js';
export {extractSignatureChainHints} from './signature.js';
export {buildActionPlan, buildWhyTheseSteps, buildStopConditions} from './reports.js';
export {pickHookTypes} from './hooks.js';

// MCP Tools (defined with defineTool)
export {deobfuscateCode} from './deobfuscate.js';
export {understandCode} from './understand.js';
export {summarizeCode} from './summarize.js';
export {detectCrypto} from './detectCrypto.js';
export {riskPanel} from './riskPanel.js';
export {record_reverse_evidence, export_session_report} from './reports.js';
export {analyze_target} from './analyzeTarget.js';

// Type exports
export type {AnalyzeTargetParams} from './analyzeTarget.js';
export type {
  AnalyzerResult,
  AnalyzerDataResult,
  AnalyzerRuntimeServices,
  HookTimelineEntry,
  CorrelatedFlow,
  RequestFingerprint,
  PriorityTarget,
  SignatureChainHints,
  HookPreset,
  CollectedFileEntry,
  AnalyzeTargetData,
  AnalyzeTargetResult,
  DeobfuscateCodeResult,
  UnderstandCodeFnResult,
  SummarizeFileResult,
  SummarizeBatchResult,
  SummarizeProjectResult,
  SummarizeProjectData,
  DetectCryptoFnResult,
  DetectCryptoData,
  RiskPanelResult,
  RiskPanelData,
  RecordEvidenceResult,
  RecordEvidenceData,
  ExportSessionReportResult,
  ExportSessionReportData,
  Frame,
} from './types.js';