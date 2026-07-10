/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 兼容垫片：重放引擎已迁移至 `modules/network/replayEngine.ts`。
 */
export {
  STRIPPED_HEADERS,
  stripManagedHeaders,
  buildReplayRequest,
  emptyReplayResponse,
  executeReplay,
  formatCurl,
} from '../../modules/network/replayEngine.js';
