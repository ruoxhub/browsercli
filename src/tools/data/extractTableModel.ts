/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ExtractedTable,
  ExtractSpan,
  RawTableCapture,
  RawTableRow,
  RawTableSection,
} from './types.js';

interface Anchor {
  column: number;
  row: number;
  rowSpan: number;
  colSpan: number;
}

interface SectionMatrix {
  /** Row-major cell texts; covered positions are null unless propagated. */
  grid: Array<Array<string | null>>;
  anchors: Anchor[];
  width: number;
}

interface ActiveSpan {
  column: number;
  colSpan: number;
  rowsLeft: number;
}

function span(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

/**
 * Lays one row group out on a logical column matrix using an active-span
 * occupancy table. Within a row, a colspan anchor propagates its text to the
 * covered header positions (so multi-level paths can be built) and leaves data
 * positions null. A rowspan carried across rows never repeats its text: covered
 * header positions become '' (skipped by headerPath) and data positions null.
 */
function fillSection(
  rows: RawTableRow[],
  propagateCovered: boolean,
): SectionMatrix {
  const grid: Array<Array<string | null>> = [];
  const anchors: Anchor[] = [];
  let width = 0;
  let active: ActiveSpan[] = [];

  rows.forEach((row, rowIndex) => {
    const carried = active;
    const line: Array<string | null> = [];
    active = [];
    for (const spanRef of carried) {
      for (let offset = 0; offset < spanRef.colSpan; offset++) {
        // A row-span carried down contributes no new header level ('' skips it
        // in headerPath) and no data value at all.
        line[spanRef.column + offset] = propagateCovered ? '' : null;
      }
    }

    let column = 0;
    for (const cell of row.cells) {
      while (line[column] !== undefined) {
        column++;
      }
      const colSpan = span(cell.colSpan);
      const rowSpan = span(cell.rowSpan);
      for (let offset = 0; offset < colSpan; offset++) {
        line[column + offset] =
          propagateCovered || offset === 0 ? cell.text : null;
      }
      if (rowSpan > 1 || colSpan > 1) {
        anchors.push({column, row: rowIndex, rowSpan, colSpan});
      }
      if (rowSpan > 1) {
        active.push({column, colSpan, rowsLeft: rowSpan - 1});
      }
      column += colSpan;
    }

    active = carried
      .map(spanRef => ({...spanRef, rowsLeft: spanRef.rowsLeft - 1}))
      .filter(spanRef => spanRef.rowsLeft > 0)
      .concat(active);

    width = Math.max(width, line.length);
    grid.push(line);
  });

  return {grid, anchors, width};
}

function headerPathOf(
  grid: Array<Array<string | null>>,
  column: number,
): string[] {
  const path: string[] = [];
  for (const line of grid) {
    const value = line[column];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        path.push(trimmed);
      }
    }
  }
  return path;
}

function uniqueNames(
  paths: string[][],
  keys: string[],
  warnings: string[],
): string[] {
  const used = new Set<string>();
  const names: string[] = [];

  keys.forEach((key, column) => {
    const path = paths[column];
    const base = path.join(' / ');
    if (!base) {
      warnings.push(
        `Column ${key} has an empty header; using key "${key}" as its name.`,
      );
    }
    let name = base || key;
    if (used.has(name)) {
      let suffix = 2;
      while (used.has(`${name} (${suffix})`)) {
        suffix++;
      }
      const renamed = `${name} (${suffix})`;
      warnings.push(
        `Column ${key} has a duplicate header "${base || name}"; renamed to "${renamed}".`,
      );
      name = renamed;
    }
    used.add(name);
    names.push(name);
  });

  return names;
}

function toSpans(
  anchors: Anchor[],
  section: RawTableSection,
  keys: string[],
): ExtractSpan[] {
  return anchors.map(anchor => ({
    columnKey: keys[anchor.column],
    section,
    row: anchor.row,
    rowSpan: anchor.rowSpan,
    colSpan: anchor.colSpan,
  }));
}

/**
 * Turns raw browser capture facts into a normalized table: fixed positional
 * column keys, display names derived from header paths, data rows keyed by
 * column, merged-cell anchors as spans, and null for every covered position.
 */
export function normalizeTable(raw: RawTableCapture): ExtractedTable {
  const rowsOf = (kind: RawTableSection): RawTableRow[] =>
    raw.rows.filter(row => row.kind === kind);

  const headerRows = rowsOf('header');
  const dataRows = rowsOf('data');
  const footerRows = rowsOf('footer');

  const header = fillSection(headerRows, true);
  const body = fillSection(dataRows, false);
  const footer = fillSection(footerRows, false);

  const width = Math.max(header.width, body.width, footer.width);
  const keys = Array.from({length: width}, (_, index) => `c${index + 1}`);
  const warnings: string[] = [];
  const headerPaths = keys.map((_, column) =>
    headerPathOf(header.grid, column),
  );
  const names = uniqueNames(headerPaths, keys, warnings);

  const rows = body.grid.map(line => {
    const record: Record<string, string | null> = {};
    keys.forEach((key, column) => {
      const value = line[column];
      record[key] = typeof value === 'string' ? value : null;
    });
    return record;
  });

  return {
    schemaVersion: 1,
    kind: 'table',
    source: raw.source,
    columns: keys.map((key, column) => ({
      key,
      name: names[column],
      headerPath: headerPaths[column],
    })),
    rows,
    spans: [
      ...toSpans(header.anchors, 'header', keys),
      ...toSpans(body.anchors, 'data', keys),
      ...toSpans(footer.anchors, 'footer', keys),
    ],
    coverage: {rowsReturned: rows.length, datasetComplete: 'unknown'},
    warnings,
  };
}

function escapeCsvField(value: string | null): string {
  if (value === null || value === '') {
    return '';
  }
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * RFC 4180 style CSV: displayed column order, CRLF records, comma / double
 * quote / CR / LF quoted, and an empty field for null coverage positions.
 */
export function encodeCsv(table: ExtractedTable): string {
  const lines = [
    table.columns.map(column => escapeCsvField(column.name)).join(','),
    ...table.rows.map(row =>
      table.columns
        .map(column => escapeCsvField(row[column.key] ?? null))
        .join(','),
    ),
  ];
  return lines.join('\r\n');
}
