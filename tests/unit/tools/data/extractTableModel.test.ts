/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  encodeCsv,
  normalizeTable,
} from '../../../../src/tools/data/extractTableModel.js';
import type {
  RawTableCell,
  RawTableRow,
  RawTableSource,
} from '../../../../src/tools/data/types.js';

const source: RawTableSource = {
  pageUrl: 'https://example.test/page',
  frameUrl: 'https://example.test/frame',
  title: 'Example',
  selector: 'table#t',
};

function cell(
  text: string,
  overrides: Partial<RawTableCell> = {},
): RawTableCell {
  return {
    text,
    header: false,
    rowSpan: 1,
    colSpan: 1,
    headers: [],
    scope: '',
    id: '',
    ...overrides,
  };
}

function header(cells: RawTableCell[]): RawTableRow {
  return {kind: 'header', cells};
}

function data(cells: RawTableCell[]): RawTableRow {
  return {kind: 'data', cells};
}

describe('normalizeTable', () => {
  it('normalizes merged cells and multi-level headers', () => {
    const table = normalizeTable({
      source,
      rows: [
        header([cell('Group', {header: true, colSpan: 2})]),
        header([cell('Name', {header: true}), cell('Value', {header: true})]),
        data([cell('A', {rowSpan: 2}), cell('1')]),
        data([cell('B')]),
      ],
    });

    assert.equal(table.schemaVersion, 1);
    assert.equal(table.kind, 'table');
    assert.deepEqual(table.source, source);
    assert.deepEqual(
      table.columns.map(column => column.key),
      ['c1', 'c2'],
    );
    assert.deepEqual(table.columns[0].headerPath, ['Group', 'Name']);
    assert.deepEqual(table.columns[1].headerPath, ['Group', 'Value']);
    assert.equal(table.columns[0].name, 'Group / Name');
    assert.equal(table.columns[1].name, 'Group / Value');

    // Covered positions are null, never a copy of the anchor text.
    assert.deepEqual(table.rows, [
      {c1: 'A', c2: '1'},
      {c1: null, c2: 'B'},
    ]);

    assert.deepEqual(table.spans, [
      {columnKey: 'c1', section: 'header', row: 0, rowSpan: 1, colSpan: 2},
      {columnKey: 'c1', section: 'data', row: 0, rowSpan: 2, colSpan: 1},
    ]);
    assert.deepEqual(table.coverage, {
      rowsReturned: 2,
      datasetComplete: 'unknown',
    });
    assert.deepEqual(table.warnings, []);
  });

  it('does not repeat a row-spanned header in its column path', () => {
    const table = normalizeTable({
      source,
      rows: [
        header([
          cell('ID', {header: true, rowSpan: 2}),
          cell('Metrics', {header: true, colSpan: 2}),
        ]),
        header([cell('Name', {header: true}), cell('Value', {header: true})]),
        data([cell('1'), cell('A'), cell('2')]),
      ],
    });

    assert.deepEqual(
      table.columns.map(column => column.key),
      ['c1', 'c2', 'c3'],
    );
    assert.deepEqual(table.columns[0].headerPath, ['ID']);
    assert.deepEqual(table.columns[1].headerPath, ['Metrics', 'Name']);
    assert.deepEqual(table.columns[2].headerPath, ['Metrics', 'Value']);
    assert.deepEqual(table.rows, [{c1: '1', c2: 'A', c3: '2'}]);
  });

  it('derives collision-free names for duplicate and blank headers', () => {
    const table = normalizeTable({
      source,
      rows: [
        header([
          cell('Name', {header: true}),
          cell('Name', {header: true}),
          cell('   ', {header: true}),
        ]),
        data([cell('1'), cell('2'), cell('3')]),
      ],
    });

    assert.deepEqual(
      table.columns.map(column => column.name),
      ['Name', 'Name (2)', 'c3'],
    );
    assert.equal(table.warnings.length, 2);
    assert.match(table.warnings[0], /duplicate/i);
    assert.match(table.warnings[0], /c2/);
    assert.match(table.warnings[1], /header/i);
    assert.match(table.warnings[1], /c3/);

    // Names are deterministic across runs.
    assert.deepEqual(
      normalizeTable({
        source,
        rows: [
          header([
            cell('Name', {header: true}),
            cell('Name', {header: true}),
            cell('   ', {header: true}),
          ]),
          data([cell('1'), cell('2'), cell('3')]),
        ],
      }).columns.map(column => column.name),
      table.columns.map(column => column.name),
    );
  });
});

describe('encodeCsv', () => {
  function csvTable() {
    return normalizeTable({
      source,
      rows: [
        header([cell('H1', {header: true}), cell('H2', {header: true})]),
        data([cell('a,b'), cell('he said "hi"')]),
        data([cell('line1\r\nline2')]),
        data([cell('cr\ronly'), cell('lf\nonly')]),
      ],
    });
  }

  it('quotes comma, double quote, CR and LF per RFC 4180', () => {
    assert.equal(
      encodeCsv(csvTable()),
      'H1,H2\r\n' +
        '"a,b","he said ""hi"""\r\n' +
        '"line1\r\nline2",\r\n' +
        '"cr\ronly","lf\nonly"',
    );
  });

  it('emits an empty field for null coverage positions', () => {
    const table = normalizeTable({
      source,
      rows: [
        header([cell('H1', {header: true}), cell('H2', {header: true})]),
        data([cell('A', {rowSpan: 2}), cell('1')]),
        data([cell('B')]),
      ],
    });

    assert.deepEqual(table.rows, [
      {c1: 'A', c2: '1'},
      {c1: null, c2: 'B'},
    ]);
    assert.equal(encodeCsv(table), 'H1,H2\r\nA,1\r\n,B');
  });
});
