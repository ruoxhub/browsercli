/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AISummarizer, CodeSummary} from '../../modules/analyzer/AISummarizer.js';
import type {CodeAnalyzer} from '../../modules/analyzer/CodeAnalyzer.js';
import type {CodeCollector} from '../../modules/collector/CodeCollector.js';
import type {PageController} from '../../modules/collector/PageController.js';
import type {CryptoDetector} from '../../modules/crypto/CryptoDetector.js';
import type {SecurityIssue, CryptoStrength} from '../../modules/crypto/CryptoDetectorEnhanced.js';
import type {Deobfuscator} from '../../modules/deobfuscator/Deobfuscator.js';
import type {HookManager} from '../../modules/hook/HookManager.js';
import type {Frame} from '../../third_party/index.js';
import type {
  DeobfuscateResult,
  UnderstandCodeResult as UnderstandCodeResultType,
  CryptoAlgorithm,
  CryptoLibrary,
} from '../../types/index.js';
import type {MessagesResult} from '../shared/types.js';

/**
 * Analyzer 工具统一返回结构（兼容旧字段 logFormat）。
 *
 * 不携带 data 的基础类型；如需 data 字段，使用 MessagesResult<T>。
 */
export interface AnalyzerResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat?: string;
}

/**
 * Analyzer 工具带数据的统一返回结构。
 * @deprecated 使用 AnalyzerResult<T> 即可，两者已统一。
 */
export interface AnalyzerDataResult<T> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat?: string;
}

export interface HookTimelineEntry {
  hookId: string;
  target: string;
  url?: string;
  event?: string;
  method?: string;
  status?: number;
  signatureIndicators?: string[];
  timestamp: number;
}

export interface CorrelatedFlow {
  url: string;
  method: string;
  firstTimestamp: number;
  lastTimestamp: number;
  eventCount: number;
  hookIds: string[];
  events: string[];
  statuses: number[];
  signatureIndicators: string[];
}

export interface RequestFingerprint {
  fingerprint: string;
  urlPattern: string;
  methods: string[];
  flowCount: number;
  totalEvents: number;
  signatureIndicators: string[];
  signatureIndicatorCount: number;
  suspiciousScore: number;
  sampleUrls: string[];
}

export interface PriorityTarget {
  target: string;
  type: 'network' | 'function';
  priorityScore: number;
  reasons: string[];
}

export interface SignatureChainHints {
  signatureParams: string[];
  candidateFunctions: string[];
  requestSinks: string[];
}

export type HookPreset = 'none' | 'api-signature' | 'network-core';

export interface CollectedFileEntry {
  url: string;
  content: string;
  size: number;
  type: string;
}

/** analyze_target 返回数据 */
export interface AnalyzeTargetData {
  target: string;
  durationMs: number;
  collection: {
    totalCollected: number;
    selectedForAnalysis: number;
    dependencies: {nodes: unknown[]; edges: unknown[]};
  };
  analysis: {
    qualityScore: number;
    securityRiskCount: number;
    cryptoAlgorithms: string[];
  };
  deobfuscation: {
    confidence: number;
    readabilityScore: number;
    transformations: number;
  } | null;
  hooks: {
    preset: HookPreset;
    autoInjected: boolean;
    hookIds: Array<{hookId: string; type: string; injected: boolean}>;
    totalRecords: number;
    activeUrls: Array<{url: string; count: number}>;
    correlatedFlows: CorrelatedFlow[];
    suspiciousFlows: CorrelatedFlow[];
    timelineSample: HookTimelineEntry[];
  };
  requestFingerprints: RequestFingerprint[];
  priorityTargets: PriorityTarget[];
  signatureChain: SignatureChainHints;
  actionPlan: string[];
  recommendedNextSteps: string[];
  whyTheseSteps: string[];
  stopIf: string[];
  nextActions: string[];
  replay?: Array<{index: number; action: string; success: boolean; message: string}>;
}

/** analyze_target 结果 */
export interface AnalyzeTargetResult extends AnalyzerDataResult<AnalyzeTargetData> {
  tooltype: 'analyze_target';
}

export interface AnalyzerRuntimeServices {
  deobfuscator: Deobfuscator;
  analyzer: CodeAnalyzer;
  summarizer: AISummarizer;
  cryptoDetector: CryptoDetector;
  collector: CodeCollector;
  hookManager: HookManager;
  pageController: PageController;
}

/** detect_crypto 返回数据 */
export interface DetectCryptoData {
  algorithms: CryptoAlgorithm[];
  libraries: CryptoLibrary[];
  confidence: number;
  securityIssues?: SecurityIssue[];
  strength?: CryptoStrength;
}

/** risk_panel 返回数据 */
export interface RiskPanelData {
  score: number;
  level: 'high' | 'medium' | 'low';
  factors: {
    securityRisks: number;
    highSeverityRisks: number;
    cryptoAlgorithms: number;
    cryptoIssues: number;
    dangerousAlgorithms: string[];
    hookSignals: number;
  };
  recommendations: string[];
}

/** summarize_project 返回数据 */
export interface SummarizeProjectData {
  totalFiles: number;
  totalSize: number;
  mainPurpose: string;
  architecture: string;
  technologies: string[];
  securityConcerns: string[];
  recommendations: string[];
}

export interface DeobfuscateCodeResult extends AnalyzerDataResult<DeobfuscateResult> {
  tooltype: 'deobfuscate';
}

export interface UnderstandCodeFnResult extends AnalyzerDataResult<UnderstandCodeResultType> {
  tooltype: 'understand';
}

export interface SummarizeFileResult extends AnalyzerDataResult<CodeSummary> {
  tooltype: 'summarize';
}

export interface SummarizeBatchResult extends AnalyzerDataResult<CodeSummary[]> {
  tooltype: 'summarize';
}

export interface SummarizeProjectResult extends AnalyzerDataResult<SummarizeProjectData> {
  tooltype: 'summarize';
}

export interface DetectCryptoFnResult extends AnalyzerDataResult<DetectCryptoData> {
  tooltype: 'detectCrypto';
}

export interface RiskPanelResult extends AnalyzerDataResult<RiskPanelData> {
  tooltype: 'riskPanel';
}

export type {Frame};

/** record_reverse_evidence 返回数据 */
export interface RecordEvidenceData {
  ok: boolean;
  taskId: string;
  taskDir: string;
  channel: string;
  mirroredChannels: string[];
  targetContext?: {
    targetKeywords: string[];
    targetUrlPatterns: string[];
    targetFunctionNames: string[];
    targetActionDescription: string;
  };
}

/** record_reverse_evidence 结果 */
export interface RecordEvidenceResult extends AnalyzerResult<RecordEvidenceData> {
  tooltype: 'record_reverse_evidence';
}

/** export_session_report 返回数据 */
export interface ExportSessionReportData {
  generatedAt: string;
  collector: {
    totalFiles: number;
    totalBytes: number;
    cacheStats: unknown;
  };
  hooks: {
    totalHooks: number;
    enabledHooks: number;
    totalRecords: number;
  } & Record<string, unknown>;
  tokenBudget: {
    usedTokens: number;
    maxTokens: number;
    usagePercent: number;
  };
  hookData?: unknown;
}

/** export_session_report 结果 */
export interface ExportSessionReportResult extends AnalyzerDataResult<ExportSessionReportData> {
  tooltype: 'export_session_report';
}