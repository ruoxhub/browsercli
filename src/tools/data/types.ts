/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Source metadata retained on every extracted table, as reported by the
 * browser collector.
 */
export interface RawTableSource {
  pageUrl: string;
  frameUrl: string;
  title: string;
  selector: string;
}

/**
 * One cell exactly as the page reported it. `rowSpan`/`colSpan` are the
 * effective (positive) spans after the collector resolved the DOM attributes.
 */
export interface RawTableCell {
  text: string;
  /** Reserved for Task 2's collector; normalization uses the row `kind`. */
  header: boolean;
  rowSpan: number;
  colSpan: number;
  /** Reserved for Task 2's collector (ARIA `headers`); not consumed yet. */
  headers: string[];
  /** Reserved for Task 2's collector (`scope` attribute); not consumed yet. */
  scope: string;
  /** Reserved for Task 2's collector (cell `id`); not consumed yet. */
  id: string;
}

export type RawTableSection = 'header' | 'data' | 'footer';

export interface RawTableRow {
  kind: RawTableSection;
  cells: RawTableCell[];
}

export interface RawTableCapture {
  source: RawTableSource;
  rows: RawTableRow[];
}

export interface ExtractColumn {
  /** Fixed positional key: `c1` ... `cN`. */
  key: string;
  /** Display name: `headerPath` joined with ` / `, or the key when untitled. */
  name: string;
  /** Header levels top to bottom, merged anchors propagated to covered columns. */
  headerPath: string[];
}

export interface ExtractSpan {
  /** Column key of the merged anchor. */
  columnKey: string;
  section: RawTableSection;
  /** Row index of the anchor inside its section. */
  row: number;
  rowSpan: number;
  colSpan: number;
}

export interface ExtractedTable {
  schemaVersion: 1;
  kind: 'table';
  source: RawTableSource;
  columns: ExtractColumn[];
  /** Column key to cell text; covered (merged) and absent positions are null. */
  rows: Array<Record<string, string | null>>;
  spans: ExtractSpan[];
  coverage: {rowsReturned: number; datasetComplete: 'unknown'};
  warnings: string[];
}
