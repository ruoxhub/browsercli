/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {create} from 'zustand';

import type {
  SessionAnalysisMode,
  SessionAnalysisPayload,
} from '../lib/protocol';

export interface AnalysisState {
  mode: SessionAnalysisMode;
  report: SessionAnalysisPayload | null;
  analyzing: boolean;
  error: string | null;
  setMode: (mode: SessionAnalysisMode) => void;
  setReport: (report: SessionAnalysisPayload | null) => void;
  setAnalyzing: (analyzing: boolean) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

export const useAnalysisStore = create<AnalysisState>(set => ({
  mode: 'auto',
  report: null,
  analyzing: false,
  error: null,
  setMode: mode => set({mode}),
  setReport: report => set({report}),
  setAnalyzing: analyzing => set({analyzing}),
  setError: error => set({error}),
  clear: () => set({report: null, analyzing: false, error: null}),
}));
