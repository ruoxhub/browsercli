/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export * from './hook/index.js';
export {
  buildRequestBindings,
  inferCandidateEnvNeeds,
  normalizeHookRecord,
  summarizeHookRecords,
  toHookRecordArray,
} from './hook/record-utils.js';
export type {
  HookRecordSummaryEntry,
  HookRecordSummaryResult,
  NormalizedHookRecord,
  RequestBinding,
} from './hook/record-utils.js';
