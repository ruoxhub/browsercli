/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export type CaptchaStatus = 'detected' | 'suspected' | 'not_detected';

export type CaptchaKind =
  | 'slider'
  | 'image'
  | 'widget'
  | 'browser_check'
  | 'unknown'
  | 'none';

export type CaptchaEvidenceSource = 'url' | 'title' | 'text' | 'dom';
export type CaptchaEvidenceStrength = 'weak' | 'strong';
export type CaptchaRecommendation =
  | 'continue'
  | 'observe'
  | 'ask_ai'
  | 'manual';

export interface CaptchaEvidence {
  ruleId: string;
  source: CaptchaEvidenceSource;
  strength: CaptchaEvidenceStrength;
  summary: string;
  kind?: Exclude<CaptchaKind, 'none'>;
  selector?: string;
}

export interface CaptchaAssessment {
  status: CaptchaStatus;
  detected: boolean;
  kind: CaptchaKind;
  confidence: number;
  evidence: CaptchaEvidence[];
  exclusions: CaptchaEvidence[];
  recommendation: CaptchaRecommendation;
  page: {
    url: string;
    title: string;
  };
}

export interface CaptchaWaitResult {
  cleared: boolean;
  elapsedMs: number;
  checks: number;
  assessment: CaptchaAssessment;
}

export interface CaptchaElementSnapshot {
  tagName: string;
  id: string;
  className: string;
  role: string;
  ariaLabel: string;
  src: string;
  title: string;
  alt: string;
  visible: boolean;
  hasSiteKey: boolean;
  draggable: boolean;
}

export interface CaptchaPageSnapshot {
  bodyText: string;
  elements: CaptchaElementSnapshot[];
}

export interface CaptchaAssessmentInput {
  url: string;
  title: string;
  snapshot: CaptchaPageSnapshot;
}
