/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 配置选项元数据兼容聚合出口。
 * 真实定义按职责拆分在 `./category-options.ts`、`./browser-options.ts`、
 * `./runtime-options.ts`、`./tool-options.ts`、`./server-options.ts`。
 */

import type {ConfigOption} from './category-options.js';
import type {GlobalConfig} from './schema.js';
import {serverOptions} from './server-options.js';

export * from './browser-options.js';
export * from './category-options.js';
export * from './runtime-options.js';
export * from './server-options.js';
export * from './tool-options.js';

export type ConfigOptionValueType =
  | 'boolean'
  | 'string'
  | 'number'
  | 'array'
  | 'object';

export type ConfigOptionMeta = ConfigOption;

/**
 * 兼容历史导出名 `CONFIG_OPTIONS`（由 `serverOptions` 驱动）。
 */
export const CONFIG_OPTIONS: Partial<Record<keyof GlobalConfig, ConfigOption>> =
  serverOptions as Partial<Record<keyof GlobalConfig, ConfigOption>>;
