/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {HookPreset} from './types.js';

export function pickHookTypes(
  hookPreset: HookPreset,
): string[] {
  if (hookPreset === 'none') {
    return [];
  }
  if (hookPreset === 'network-core') {
    return ['fetch', 'xhr', 'websocket', 'eval', 'timer'];
  }
  return ['fetch', 'xhr', 'websocket'];
}