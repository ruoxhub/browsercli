/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Context} from '../tools/ToolDefinition.js';

import type {BrowserPage} from './BrowserPage.js';
import type {SessionContext} from './SessionContext.js';

/**
 * 向后兼容工厂壳：实际 Context 构造已收敛至 SessionContext.toToolContext()（ADR-0008）。
 */
export class DefineToolContextFactory {
  constructor(private readonly session: SessionContext) {}

  create(targetPage?: BrowserPage): Context {
    return this.session.toToolContext(targetPage);
  }
}
