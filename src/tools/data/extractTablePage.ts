/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import {resolveSelectedFrameId} from '../script/script.js';

import type {
  RawTableCapture,
  RawTableCell,
  RawTableRow,
  RawTableSection,
} from './types.js';

/** Dedicated world name so the collector never touches the page's own world. */
const EXTRACT_TABLE_WORLD = 'browsercli-extract-table';

/** Reasons the collector reports as a thrown `Error.reason` for the adapter. */
export type TableCaptureFailureReason =
  | 'not_found'
  | 'ambiguous'
  | 'not_a_table';

interface CollectFailure {
  reason: TableCaptureFailureReason;
  message: string;
}

interface CollectOptions {
  /** Captured outside the page because the page cannot see the top URL. */
  pageUrl: string;
  selector: string;
  includeHidden?: boolean;
}

/** Requested shape of the browser-side collector result. */
export interface TableCaptureOptions {
  selector: string;
  includeHidden: boolean;
}

interface RuntimeEvaluateResult {
  exceptionDetails?: {
    text?: string;
    exception?: {description?: string; value?: unknown};
  };
  result: {value?: unknown};
}

function captureError(
  reason: TableCaptureFailureReason,
  message: string,
): Error {
  const error = new Error(message) as Error & {
    reason?: TableCaptureFailureReason;
  };
  error.reason = reason;
  return error;
}

/**
 * Read-only collector evaluated inside the target frame's isolated world.
 *
 * It is serialized with `Function.prototype.toString`, so it must stay
 * self-contained: no imports, no closure over module scope, no helpers from
 * this file. Anything it needs has to live inside the function body.
 */
export function collectTableDom(
  options: CollectOptions,
): RawTableCapture | CollectFailure {
  const isHidden = (element: Element): boolean => {
    if (element.hasAttribute('hidden')) return true;
    if (typeof getComputedStyle !== 'function') return false;
    const style = getComputedStyle(element);
    return (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    );
  };

  /** Native `rowSpan`/`colSpan` and ARIA spans both collapse 0 into 1. */
  const positiveSpan = (value: string | number | null | undefined): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
  };

  const textOf = (element: Element): string => {
    const innerText = (element as HTMLElement).innerText;
    const raw = typeof innerText === 'string' ? innerText : element.textContent;
    return (raw ?? '').trim();
  };

  /**
   * Section of a row, scoped to the selected table: an ancestor table's
   * `<tfoot>` must not reclassify rows of a table nested inside it.
   */
  const sectionOf = (row: Element, table: Element): string => {
    let node = row.parentElement;
    while (node && node !== table) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'thead' || tag === 'tfoot') return tag;
      node = node.parentElement;
    }
    return '';
  };

  const cellFacts = (
    element: Element,
    header: boolean,
    rowSpan: number,
    colSpan: number,
  ): RawTableCell => ({
    text: textOf(element),
    header,
    rowSpan,
    colSpan,
    headers: (element.getAttribute('headers') ?? '')
      .split(/\s+/)
      .filter(Boolean),
    scope: element.getAttribute('scope') ?? '',
    id: element.getAttribute('id') ?? '',
  });

  const matches = document.querySelectorAll(options.selector);
  if (matches.length === 0) {
    return {
      reason: 'not_found',
      message: `选择器 "${options.selector}" 没有匹配到任何元素`,
    };
  }
  if (matches.length > 1) {
    return {
      reason: 'ambiguous',
      message: `选择器 "${options.selector}" 匹配到 ${matches.length} 个元素，请提供唯一选择器`,
    };
  }

  const root = matches[0] as Element;
  const role = (root.getAttribute('role') ?? '').toLowerCase();
  const isNativeTable = root.tagName.toLowerCase() === 'table';
  if (!isNativeTable && role !== 'table' && role !== 'grid') {
    return {
      reason: 'not_a_table',
      message: `选择器 "${options.selector}" 指向 <${root.tagName.toLowerCase()}>，既不是 table 也不是 role=table/grid`,
    };
  }

  const rows: RawTableRow[] = [];

  if (isNativeTable) {
    const table = root as HTMLTableElement;
    for (const row of Array.from(table.rows)) {
      if (!options.includeHidden && isHidden(row)) continue;
      // Nested tables own their cells; never let them leak into the parent.
      const rawCells = Array.from(row.cells).filter(
        cell => cell.closest('table') === root,
      );
      const allHeaders =
        rawCells.length > 0 &&
        rawCells.every(cell => cell.tagName.toLowerCase() === 'th');
      const section = sectionOf(row, root);
      const kind: RawTableSection =
        section === 'tfoot'
          ? 'footer'
          : section === 'thead' || allHeaders
            ? 'header'
            : 'data';
      const cells: RawTableCell[] = [];
      for (const cell of rawCells) {
        if (!options.includeHidden && isHidden(cell)) continue;
        cells.push(
          cellFacts(
            cell,
            cell.tagName.toLowerCase() === 'th',
            positiveSpan(cell.rowSpan),
            positiveSpan(cell.colSpan),
          ),
        );
      }
      rows.push({kind, cells});
    }
  } else {
    const rowSelector = '[role="row"]';
    const cellSelector =
      '[role="cell"], [role="gridcell"], [role="columnheader"], th';
    const tableBoundary = 'table, [role="table"], [role="grid"]';
    const isHeaderCell = (cell: Element): boolean =>
      cell.tagName.toLowerCase() === 'th' ||
      (cell.getAttribute('role') ?? '').toLowerCase() === 'columnheader';

    const rowElements = Array.from(root.querySelectorAll(rowSelector)).filter(
      row => row.closest(tableBoundary) === root,
    );

    for (const row of rowElements) {
      if (!options.includeHidden && isHidden(row)) continue;
      const rawCells = Array.from(row.querySelectorAll(cellSelector)).filter(
        cell =>
          cell.closest(rowSelector) === row &&
          cell.closest(tableBoundary) === root,
      );
      const allHeaders =
        rawCells.length > 0 && rawCells.every(cell => isHeaderCell(cell));
      const kind: RawTableSection = allHeaders ? 'header' : 'data';
      const cells: RawTableCell[] = [];
      for (const cell of rawCells) {
        if (!options.includeHidden && isHidden(cell)) continue;
        cells.push(
          cellFacts(
            cell,
            isHeaderCell(cell),
            positiveSpan(cell.getAttribute('aria-rowspan')),
            positiveSpan(cell.getAttribute('aria-colspan')),
          ),
        );
      }
      rows.push({kind, cells});
    }
  }

  return {
    source: {
      pageUrl: options.pageUrl,
      frameUrl: String(location.href),
      title: document.title,
      selector: options.selector,
    },
    rows,
  };
}

function isCollectFailure(value: unknown): value is CollectFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {reason?: unknown}).reason === 'string'
  );
}

/**
 * Collects raw table facts from the given frame in a throwaway isolated world.
 * Creates its own CDP session and always detaches it; never enables Runtime,
 * Page or Debugger domains, so no debugger state or listener is left behind.
 */
export async function captureTable(
  frame: Frame,
  options: TableCaptureOptions,
): Promise<RawTableCapture> {
  const page = frame.page();
  const frameId = await resolveSelectedFrameId(frame);
  if (!frameId) {
    throw new Error(
      '无法解析当前 Frame 的 CDP frameId，无法创建隔离执行上下文；请先重新选择 Frame',
    );
  }

  const client = await page.context().newCDPSession(page);
  try {
    const world = (await client.send('Page.createIsolatedWorld', {
      frameId,
      worldName: EXTRACT_TABLE_WORLD,
    })) as {executionContextId: number};

    const argument = JSON.stringify({
      pageUrl: page.url(),
      selector: options.selector,
      includeHidden: options.includeHidden,
    });
    const expression = `(${collectTableDom.toString()})(${argument})`;

    const evaluated = (await client.send('Runtime.evaluate', {
      expression,
      contextId: world.executionContextId,
      returnByValue: true,
      awaitPromise: true,
    })) as RuntimeEvaluateResult;

    if (evaluated.exceptionDetails) {
      const description =
        evaluated.exceptionDetails.exception?.description ||
        evaluated.exceptionDetails.text ||
        'Runtime.evaluate 执行失败';
      throw new Error(description);
    }

    const value = evaluated.result.value;
    if (isCollectFailure(value)) {
      throw captureError(value.reason, value.message);
    }
    return value as RawTableCapture;
  } finally {
    await client.detach().catch(() => undefined);
  }
}
