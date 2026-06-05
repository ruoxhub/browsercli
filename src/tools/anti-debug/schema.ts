/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';

import type {AntiAntiDebugFeature, BypassTarget} from './types.js';

/** anti_anti_debug 工具的统一标识，避免在多处硬编码字面量。 */
export const ANTI_ANTI_DEBUG_TOOLTYPE = 'anti_anti_debug';

/** bypass_debugger 工具的统一标识。 */
export const BYPASS_DEBUGGER_TOOLTYPE = 'bypass_debugger';

/** Anti-Anti-Debug 工具接收的特性枚举。 */
export const antiAntiDebugFeatureSchema = zod.enum([
  'fixedWindowSize',
  'fixedTime',
  'preventClose',
  'preventHistoryBack',
  'preventConsoleClear',
  'hideWebdriver',
]) satisfies zod.ZodType<AntiAntiDebugFeature>;

/** Bypass Debugger 工具接收的目标枚举。 */
export const bypassTargetSchema = zod.enum([
  'eval',
  'Function',
  'constructor',
]) satisfies zod.ZodType<BypassTarget>;

/** Bypass Debugger 的默认目标：覆盖全部三类入口。 */
export const DEFAULT_BYPASS_TARGETS: readonly BypassTarget[] = [
  'eval',
  'Function',
  'constructor',
];
