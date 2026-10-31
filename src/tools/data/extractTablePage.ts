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
  | 'not_a_table'
  | 'hidden'
  | 'bad_selector';

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
  /**
   * How an element takes part in table layout, with ancestor awareness
   * (`display` is not inherited, so a row inside `<div hidden>` still reports
   * `display: table-row` for itself).
   *
   * - `removed`: `display:none` somewhere on the chain — the box leaves the
   *   layout entirely, so its column/row slot genuinely collapses.
   * - `invisible`: `visibility:hidden|collapse` — the slot is still occupied.
   *   Splicing it out shifts every later cell under the wrong header.
   * - `visible`: collected normally.
   *
   * `contentVisibilityAuto` is deliberately NOT requested: Chromium reports a
   * below-the-fold `content-visibility:auto` subtree as not visible, which is
   * a lazily-rendered table, not a hidden container.
   */
  type LayoutState = 'visible' | 'invisible' | 'removed';
  const layoutStateOf = (element: Element): LayoutState => {
    if (!element.checkVisibility({visibilityProperty: false})) return 'removed';
    if (!element.checkVisibility({visibilityProperty: true}))
      return 'invisible';
    return 'visible';
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

  /**
   * Collects one cell while preserving positional occupancy. A `removed` cell
   * collapses its column (nothing to hold); an `invisible` cell keeps the
   * column with empty text so later cells do not slide under the wrong header.
   */
  const collectCell = (
    cells: RawTableCell[],
    element: Element,
    header: boolean,
    rowSpan: number,
    colSpan: number,
  ): void => {
    const state = layoutStateOf(element);
    if (!options.includeHidden && state === 'removed') return;
    const facts = cellFacts(element, header, rowSpan, colSpan);
    cells.push(
      !options.includeHidden && state === 'invisible'
        ? {...facts, text: ''}
        : facts,
    );
  };

  // An invalid CSS selector throws SyntaxError in the page; report it as a
  // selector problem so the adapter can map it to VALIDATION, not RUNTIME.
  let matches: NodeListOf<Element>;
  try {
    matches = document.querySelectorAll(options.selector);
  } catch (error) {
    return {
      reason: 'bad_selector',
      message: `选择器 "${options.selector}" 不是合法的 CSS 选择器：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
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

  // "隐藏容器始终拒绝": a hidden container is a hard refusal, never widened by
  // includeHidden — that option only governs hidden rows and cells.
  if (layoutStateOf(root) !== 'visible') {
    return {
      reason: 'hidden',
      message: `选择器 "${options.selector}" 命中的表格位于隐藏容器内，拒绝采集`,
    };
  }

  const rows: RawTableRow[] = [];

  if (isNativeTable) {
    const table = root as HTMLTableElement;
    for (const row of Array.from(table.rows)) {
      // Only a `display:none` row leaves the layout; a `visibility:hidden` row
      // keeps its slot, so its cells are emitted with empty text instead.
      if (!options.includeHidden && layoutStateOf(row) === 'removed') continue;
      // Defensive only: `HTMLTableRowElement.cells` already excludes nested
      // tables. The filter that actually matters is the ARIA one below.
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
        collectCell(
          cells,
          cell,
          cell.tagName.toLowerCase() === 'th',
          positiveSpan(cell.rowSpan),
          positiveSpan(cell.colSpan),
        );
      }
      // A row with no collectable cell carries no data; emitting it would
      // inflate coverage.rowsReturned with an all-null ghost row.
      if (cells.length > 0) rows.push({kind, cells});
    }
  } else {
    const rowSelector = '[role="row"]';
    // `rowheader` is the standard ARIA grid row-header cell; omitting it drops
    // the first column and shifts every later cell left.
    const cellSelector =
      '[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"], th';
    const tableBoundary = 'table, [role="table"], [role="grid"]';
    const isHeaderCell = (cell: Element): boolean => {
      const role = (cell.getAttribute('role') ?? '').toLowerCase();
      return (
        cell.tagName.toLowerCase() === 'th' ||
        role === 'columnheader' ||
        role === 'rowheader'
      );
    };

    const rowElements = Array.from(root.querySelectorAll(rowSelector)).filter(
      row => row.closest(tableBoundary) === root,
    );

    for (const row of rowElements) {
      if (!options.includeHidden && layoutStateOf(row) === 'removed') continue;
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
        collectCell(
          cells,
          cell,
          isHeaderCell(cell),
          positiveSpan(cell.getAttribute('aria-rowspan')),
          positiveSpan(cell.getAttribute('aria-colspan')),
        );
      }
      if (cells.length > 0) rows.push({kind, cells});
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

/** Mirrors `evaluateInPageRuntime`'s guard against a paused/hung page. */
const CAPTURE_TIMEOUT_MS = 10_000;

/**
 * Takes no dependency on `evaluateInPageRuntime` (which enables Runtime), and
 * races a bare timer instead. Without it a `Runtime.evaluate` that never
 * settles would hold the CDP session open forever: `finally` only runs once the
 * promise does, so the session and isolated world would both leak.
 */
async function withTimeout<T>(
  operation: Promise<T>,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${label} 超时 (${CAPTURE_TIMEOUT_MS}ms)，页面可能已被 debugger 暂停或进入死循环`,
              ),
            ),
          CAPTURE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  const frameId = await withTimeout(
    resolveSelectedFrameId(frame),
    '解析 Frame 的 CDP frameId',
  );
  if (!frameId) {
    throw new Error(
      '无法解析当前 Frame 的 CDP frameId，无法创建隔离执行上下文；请先重新选择 Frame',
    );
  }

  const client = await page.context().newCDPSession(page);
  try {
    const world = (await withTimeout(
      client.send('Page.createIsolatedWorld', {
        frameId,
        worldName: EXTRACT_TABLE_WORLD,
      }) as Promise<{executionContextId: number}>,
      '创建隔离执行上下文',
    )) as {executionContextId: number};

    const argument = JSON.stringify({
      pageUrl: page.url(),
      selector: options.selector,
      includeHidden: options.includeHidden,
    });
    const expression = `(${collectTableDom.toString()})(${argument})`;

    const evaluated = (await withTimeout(
      client.send('Runtime.evaluate', {
        expression,
        contextId: world.executionContextId,
        returnByValue: true,
        awaitPromise: true,
      }) as Promise<RuntimeEvaluateResult>,
      '执行表格采集脚本',
    )) as RuntimeEvaluateResult;

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
    if (!value || !Array.isArray((value as RawTableCapture).rows)) {
      throw new Error(
        '表格采集脚本返回了非预期结果：缺少 rows 数组，无法生成表格数据',
      );
    }
    return value as RawTableCapture;
  } finally {
    await client.detach().catch(() => undefined);
  }
}
