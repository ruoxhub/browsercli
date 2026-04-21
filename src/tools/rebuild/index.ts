/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  buildDefaultEnvCode,
  toStorageShimCode,
  buildAutoEnvCode,
  buildAutoEntryCode,
  appendTargetContextNotes,
  matchesTargetText,
  filterRuntimeEvidence,
  pickTargetScript,
  inferMissingCapabilities,
  writeArtifactFile,
} from './rebuildFn.js';

export type {
  RebuildResult,
  BuildDefaultEnvCodeResult,
  ToStorageShimCodeParams,
  ToStorageShimCodeResult,
  BuildAutoEnvCodeParams,
  BuildAutoEnvCodeResult,
  BuildAutoEntryCodeParams,
  BuildAutoEntryCodeResult,
  AppendTargetContextNotesParams,
  AppendTargetContextNotesResult,
  MatchesTargetTextParams,
  MatchesTargetTextResult,
  FilterRuntimeEvidenceParams,
  FilterRuntimeEvidenceResult,
  PickTargetScriptParams,
  PickTargetScriptResult,
  InferMissingCapabilitiesParams,
  InferMissingCapabilitiesResult,
  MissingCapability,
  BuildAutoBundleParams,
  BuildAutoBundleResult,
  BuildAutoBundleData,
  WriteArtifactFileParams,
  WriteArtifactFileResult,
} from './types.js';
