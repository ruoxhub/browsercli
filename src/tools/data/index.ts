/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── 数据提取工具（defineTool 格式）────────────────────

export {extractTable} from './extractTable.js';

// ─── 辅助类导出 ──────────────────────────────────────

export {captureTable} from './extractTablePage.js';
export {encodeCsv, normalizeTable} from './extractTableModel.js';

// ─── 类型导出 ─────────────────────────────────────────

export type {
  ExtractedTable,
  ExtractColumn,
  ExtractSpan,
  RawTableCapture,
  RawTableCell,
  RawTableRow,
  RawTableSection,
  RawTableSource,
} from './types.js';
