/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * apps/web/src/lib/protocol.ts —— 前端协议类型。
 *
 * 重新导出后端的 src/web/types.ts 协议定义，消除双源维护成本。
 */

export * from '../../../../src/web/types.js';

// ==================== Site Experience ====================

export interface SiteExperience {
  id: number;
  domain: string;
  name: string;
  aliases: string[];
  platformFeatures: string | null;
  validPatterns: string | null;
  knownPitfalls: string | null;
  createdAt: string;
  updatedAt: string;
}
