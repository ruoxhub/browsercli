/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ToolContext — 向后兼容门面，底层已统一由 SessionContext + BrowserPage 聚合根承载（ADR-0008）。
 */

import {SessionContext} from './SessionContext.js';

export {BrowserPage, type BrowserPageDeps} from './BrowserPage.js';
export {SessionContext, type SessionContextOptions} from './SessionContext.js';
export {ServiceLocator} from './ServiceLocator.js';
export {DefineToolContextFactory} from './DefineToolContextFactory.js';

/**
 * @deprecated 新代码请直接使用 `SessionContext`。保留此类以确保既有单测与调用方无缝兼容。
 */
export class ToolContextProvider extends SessionContext {}
