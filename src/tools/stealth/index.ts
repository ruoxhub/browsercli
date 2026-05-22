/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── Stealth 纯函数 ───────────────────────────────────

export {
  injectStealth,
  listStealthPresets,
  listStealthFeatures,
  setUserAgent,
} from './stealth.js';

// ─── 类型导出 ─────────────────────────────────────────

export type {
  StealthInjectionOptions,
  StealthPreset,
  StealthReport,
} from './stealth.js';
