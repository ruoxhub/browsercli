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

export interface AnalyzerResult {
  success: boolean;
  message: string;
  tooltype: string;
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

export interface AnalyzeTargetResult extends AnalyzerResult {
  data: {
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
  };
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

export interface DeobfuscateCodeResult extends AnalyzerResult {
  tooltype: 'deobfuscate';
  data: DeobfuscateResult;
}

export interface UnderstandCodeFnResult extends AnalyzerResult {
  tooltype: 'understand';
  data: UnderstandCodeResultType;
}

export interface SummarizeFileResult extends AnalyzerResult {
  tooltype: 'summarize';
  data: CodeSummary;
}

export interface SummarizeBatchResult extends AnalyzerResult {
  tooltype: 'summarize';
  data: CodeSummary[];
}

export interface SummarizeProjectResult extends AnalyzerResult {
  tooltype: 'summarize';
  data: {
    totalFiles: number;
    totalSize: number;
    mainPurpose: string;
    architecture: string;
    technologies: string[];
    securityConcerns: string[];
    recommendations: string[];
  };
}

export interface DetectCryptoFnResult extends AnalyzerResult {
  tooltype: 'detectCrypto';
  data: {
    algorithms: CryptoAlgorithm[];
    libraries: CryptoLibrary[];
    confidence: number;
    securityIssues?: SecurityIssue[];
    strength?: CryptoStrength;
  };
}

export interface RiskPanelResult extends AnalyzerResult {
  tooltype: 'riskPanel';
  data: {
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
  };
}

export type {Frame};