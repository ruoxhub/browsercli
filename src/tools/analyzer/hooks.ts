/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {HookPreset} from './types.js';

const HOOK_TYPES_BY_PRESET: Record<Exclude<HookPreset, 'none'>, readonly string[]> = {
  'network-core': ['fetch', 'xhr', 'websocket', 'eval', 'timer'],
  'api-signature': ['fetch', 'xhr', 'websocket'],
};

export function pickHookTypes(hookPreset: HookPreset): string[] {
  if (hookPreset === 'none') {
    return [];
  }
  return [...HOOK_TYPES_BY_PRESET[hookPreset]];
}
