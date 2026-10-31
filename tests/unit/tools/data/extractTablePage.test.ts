/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import vm from 'node:vm';

import type {Frame} from 'patchright';
import sinon from 'sinon';

import {normalizeTable} from '../../../../src/tools/data/extractTableModel.js';
import {
  captureTable,
  collectTableDom,
} from '../../../../src/tools/data/extractTablePage.js';
import type {RawTableCapture} from '../../../../src/tools/data/types.js';

/**
 * Minimal fake DOM: only the members `collectTableDom` touches. The collector
 * is serialized and evaluated inside this realm, so the assertions below prove
 * the real collection algorithm, not a re-implementation of it. Real Chromium
 * DOM behaviour is covered by the Task 3 acceptance run.
 */
const DOM_STUB = `
const parseAttributeSelector = token => {
  const inner = token.slice(1, -1);
  const equals = inner.indexOf('=');
  if (equals < 0) return {name: inner, value: null};
  let value = inner.slice(equals + 1);
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  if (quoted) value = value.slice(1, -1);
  return {name: inner.slice(0, equals), value};
};

const matchesSelector = (element, selector) =>
  selector.split(',').some(part => {
    const token = part.trim();
    if (!token) return false;
    if (token.startsWith('[')) {
      const parsed = parseAttributeSelector(token);
      if (parsed.value === null) return element.hasAttribute(parsed.name);
      return element.getAttribute(parsed.name) === parsed.value;
    }
    return element.tagName === token.toUpperCase();
  });

class FakeElement {
  constructor(tagName, attributes, text) {
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes || {};
    this.id = this.attributes.id || '';
    this.ownText = text || '';
    this.parentElement = null;
    this.children = [];
    this.style = {display: 'block', visibility: 'visible'};
    // UA stylesheet: [hidden] { display: none }. A page override that sets
    // display:block again must win, exactly as in Chromium.
    if (Object.prototype.hasOwnProperty.call(this.attributes, 'hidden')) {
      this.style.display = 'none';
    }
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
    return this;
  }
  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }
  getAttribute(name) {
    return this.hasAttribute(name) ? this.attributes[name] : null;
  }
  get textContent() {
    return this.ownText + this.children.map(child => child.textContent).join('');
  }
  get innerText() {
    return this.textContent;
  }
  get rowSpan() {
    return this.hasAttribute('rowspan') ? Number(this.attributes.rowspan) : 1;
  }
  get colSpan() {
    return this.hasAttribute('colspan') ? Number(this.attributes.colspan) : 1;
  }
  get rows() {
    const found = [];
    const walk = node => {
      for (const child of node.children) {
        if (child.tagName === 'TABLE') continue;
        if (child.tagName === 'TR') found.push(child);
        else walk(child);
      }
    };
    walk(this);
    return found;
  }
  get cells() {
    return this.children.filter(
      child => child.tagName === 'TD' || child.tagName === 'TH',
    );
  }
  /**
   * Mirrors Chromium's ancestor-aware checkVisibility: display is not
   * inherited, so only a chain walk sees a hidden container. The options are
   * honoured the way Chromium honours them: visibilityProperty adds
   * visibility:hidden|collapse, contentVisibilityAuto additionally treats a
   * skipped content-visibility:auto subtree as not visible (this fake models
   * such a subtree as always skipped, i.e. the offscreen worst case).
   */
  checkVisibility(options) {
    const checkVisibilityProperty = options?.visibilityProperty === true;
    const checkContentVisibility = options?.contentVisibilityAuto === true;
    let node = this;
    while (node) {
      if (node.style.display === 'none') return false;
      if (
        checkVisibilityProperty &&
        (node.style.visibility === 'hidden' ||
          node.style.visibility === 'collapse')
      ) {
        return false;
      }
      if (checkContentVisibility && node.style.contentVisibility === 'auto') {
        return false;
      }
      node = node.parentElement;
    }
    return true;
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (matchesSelector(node, selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = node => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
}

globalThis.__element = (tagName, attributes, text) =>
  new FakeElement(tagName, attributes, text);
globalThis.location = {href: 'https://example.test/frame'};
globalThis.document = {
  title: 'Fixture page',
  querySelectorAll: selector => {
    if (selector === '[[invalid]]') {
      throw new Error(
        "Failed to execute 'querySelectorAll' on 'Document': '[[invalid]]' is not a valid selector.",
      );
    }
    return globalThis.__roots || [];
  },
};
`;

const NATIVE_SETUP = `
const table = __element('table', {id: 't'});
const head = __element('thead', {});
head.append(
  __element('tr', {}).append(
    __element('th', {colspan: '2'}, 'Group'),
    __element('th', {}, 'Note'),
  ),
);
const body = __element('tbody', {});
body.append(
  __element('tr', {}).append(
    __element('td', {rowspan: '2'}, 'A'),
    __element('td', {}, '1'),
    __element('td', {}, 'x'),
  ),
);
body.append(
  __element('tr', {}).append(
    __element('td', {}, 'B'),
    __element('td', {}, 'y'),
  ),
);
const hiddenRow = __element('tr', {}).append(__element('td', {}, 'secret'));
hiddenRow.style.display = 'none';
body.append(hiddenRow);
table.append(head, body);
globalThis.__roots = [table];
`;

const ARIA_SETUP = `
const grid = __element('div', {role: 'grid'});
const headerRow = __element('div', {role: 'row'});
headerRow.append(
  __element('div', {role: 'columnheader'}, 'Name'),
  __element('div', {role: 'columnheader'}, 'Score'),
);
const dataRow = __element('div', {role: 'row'});
dataRow.append(
  __element('div', {role: 'gridcell', 'aria-rowspan': '2'}, 'Ann'),
  __element('div', {role: 'gridcell'}, '9'),
);
grid.append(headerRow, dataRow);
globalThis.__roots = [grid];
`;

const NESTED_SETUP = `
const table = __element('table', {});
const body = __element('tbody', {});
const outerRow = __element('tr', {});
const nested = __element('table', {});
nested.append(
  __element('tbody', {}).append(
    __element('tr', {}).append(__element('td', {}, 'nested')),
  ),
);
const outerCell = __element('td', {}, 'outer');
outerCell.append(nested);
outerRow.append(outerCell, __element('td', {}, 'second'));
body.append(outerRow);
const hiddenCell = __element('td', {}, 'invisible');
hiddenCell.style.visibility = 'hidden';
const withHiddenCell = __element('tr', {});
withHiddenCell.append(__element('td', {}, 'third'), hiddenCell);
body.append(withHiddenCell);
table.append(body);
globalThis.__roots = [table];
`;

const NESTED_ARIA_SETUP = `
const grid = __element('div', {role: 'grid'});
const headerRow = __element('div', {role: 'row'});
headerRow.append(__element('div', {role: 'columnheader'}, 'Name'));
const dataRow = __element('div', {role: 'row'});
const hostCell = __element('div', {role: 'gridcell'}, 'outer');
const nested = __element('table', {});
nested.append(
  __element('tbody', {}).append(
    __element('tr', {role: 'row'}).append(
      __element('td', {role: 'gridcell'}, 'nested'),
    ),
  ),
);
hostCell.append(nested);
dataRow.append(hostCell, __element('div', {role: 'gridcell'}, '9'));
grid.append(headerRow, dataRow);
globalThis.__roots = [grid];
`;

const HIDDEN_ROOT_SETUP = `
const table = __element('table', {});
table.append(
  __element('tbody', {}).append(
    __element('tr', {}).append(__element('td', {}, 'never-visible')),
  ),
);
const container = __element('div', {hidden: ''});
container.append(table);
globalThis.__roots = [table];
`;

const HIDDEN_ANCESTOR_SETUP = `
const table = __element('table', {});
table.append(
  __element('tbody', {}).append(
    __element('tr', {}).append(__element('td', {}, 'under-hidden-tbody')),
  ),
);
const hiddenBody = __element('tbody', {});
hiddenBody.style.display = 'none';
hiddenBody.append(
  __element('tr', {}).append(__element('td', {}, 'under-hidden-ancestor')),
);
table.append(hiddenBody);
const wrapper = __element('div', {});
wrapper.append(table);
globalThis.__roots = [table];
`;

const VISIBILITY_HIDDEN_CELL_SETUP = `
const table = __element('table', {});
table.append(
  __element('thead', {}).append(
    __element('tr', {}).append(
      __element('th', {}, 'Name'),
      __element('th', {}, 'Age'),
      __element('th', {}, 'City'),
    ),
  ),
  __element('tbody', {}).append(
    __element('tr', {}).append(
      __element('td', {}, 'Ann'),
      Object.assign(__element('td', {}, '42'), {style: {display: 'block', visibility: 'hidden'}}),
      __element('td', {}, 'Oslo'),
    ),
  ),
);
globalThis.__roots = [table];
`;

/** Row-spanning cell in row 1 plus a visibility:hidden row in between. */
const VISIBILITY_HIDDEN_ROW_SETUP = `
const table = __element('table', {});
const body = __element('tbody', {});
body.append(
  __element('tr', {}).append(
    __element('td', {rowspan: '3'}, 'Ann'),
    __element('td', {}, '1'),
    __element('td', {}, 'Oslo'),
  ),
);
const hiddenRow = __element('tr', {});
hiddenRow.append(
  Object.assign(__element('td', {}, 'hidden-1'), {style: {display: 'block', visibility: 'hidden'}}),
  Object.assign(__element('td', {}, 'hidden-2'), {style: {display: 'block', visibility: 'hidden'}}),
);
body.append(hiddenRow);
body.append(__element('tr', {}).append(__element('td', {}, '3'), __element('td', {}, 'Bergen')));
table.append(body);
globalThis.__roots = [table];
`;

/** ARIA grid whose first column is row headers. */
const ARIA_ROWHEADER_SETUP = `
const grid = __element('div', {role: 'grid'});
const headerRow = __element('div', {role: 'row'});
headerRow.append(
  __element('div', {role: 'columnheader'}, 'Name'),
  __element('div', {role: 'columnheader'}, 'Score'),
);
const dataRow = __element('div', {role: 'row'});
dataRow.append(
  __element('div', {role: 'rowheader'}, 'Ann'),
  __element('div', {role: 'gridcell'}, '9'),
);
grid.append(headerRow, dataRow);
globalThis.__roots = [grid];
`;

/** All-th banner row between data rows, inside tbody. */
const BANNER_ROW_SETUP = `
const table = __element('table', {});
const body = __element('tbody', {});
body.append(
  __element('tr', {}).append(__element('th', {}, 'Name'), __element('th', {}, 'Amount')),
);
body.append(__element('tr', {}).append(__element('td', {}, 'Ann'), __element('td', {}, '1')));
body.append(
  __element('tr', {}).append(__element('th', {colspan: '2'}, 'Q1 2024')),
);
body.append(__element('tr', {}).append(__element('td', {}, 'Bob'), __element('td', {}, '2')));
table.append(body);
globalThis.__roots = [table];
`;

/** Table inside a content-visibility:auto subtree that is off-screen. */
const OFFSCREEN_SETUP = `
const table = __element('table', {});
table.append(
  __element('tbody', {}).append(
    __element('tr', {}).append(__element('td', {}, 'offscreen')),
  ),
);
const lazy = __element('div', {});
lazy.style.contentVisibility = 'auto';
lazy.append(table);
globalThis.__roots = [table];
`;

/** <div hidden> whose display is forced back to block by page CSS. */
const HIDDEN_OVERRIDE_SETUP = `
const table = __element('table', {});
table.append(
  __element('tbody', {}).append(
    __element('tr', {}).append(__element('td', {}, 'visible-again')),
  ),
);
const container = __element('div', {hidden: ''});
container.style.display = 'block';
container.append(table);
globalThis.__roots = [table];
`;

/** Row whose cells are all display:none — it must not survive as a ghost. */
const GHOST_ROW_SETUP = `
const table = __element('table', {});
const body = __element('tbody', {});
body.append(__element('tr', {}).append(__element('td', {}, 'keep'), __element('td', {}, 'me')));
const ghost = __element('tr', {});
ghost.append(
  Object.assign(__element('td', {}, 'gone-1'), {style: {display: 'none', visibility: 'visible'}}),
  Object.assign(__element('td', {}, 'gone-2'), {style: {display: 'none', visibility: 'visible'}}),
);
body.append(ghost);
table.append(body);
globalThis.__roots = [table];
`;

/**
 * Exactly the reported shape: an upstream `rowspan` whose coverage spans a row
 * that collects no cell. Dropping that middle row would hand the span to the
 * next surviving row and shift every later value one column left.
 */
const ROWSPAN_OVER_HIDDEN_ROW_SETUP = `
const table = __element('table', {});
const body = __element('tbody', {});
body.append(
  __element('tr', {}).append(
    __element('td', {rowspan: '2'}, 'Ann'),
    __element('td', {}, '1'),
    __element('td', {}, 'Oslo'),
  ),
);
const hiddenRow = __element('tr', {});
hiddenRow.append(
  Object.assign(__element('td', {}, 'gone-1'), {style: {display: 'none', visibility: 'visible'}}),
  Object.assign(__element('td', {}, 'gone-2'), {style: {display: 'none', visibility: 'visible'}}),
  Object.assign(__element('td', {}, 'gone-3'), {style: {display: 'none', visibility: 'visible'}}),
);
body.append(hiddenRow);
body.append(
  __element('tr', {}).append(
    __element('td', {}, '3'),
    __element('td', {}, 'Bergen'),
  ),
);
table.append(body);
globalThis.__roots = [table];
`;

/** A genuinely empty visible cell next to a visibility:hidden placeholder. */
const EMPTY_VS_HIDDEN_SETUP = `
const table = __element('table', {});
table.append(
  __element('tbody', {}).append(
    __element('tr', {}).append(
      __element('td', {}),
      Object.assign(__element('td', {}, 'secret'), {style: {display: 'block', visibility: 'hidden'}}),
    ),
  ),
);
globalThis.__roots = [table];
`;

const SECTION_SETUP = `
const outer = __element('table', {});
const outerFoot = __element('tfoot', {});
const inner = __element('table', {});
inner.append(
  __element('tbody', {}).append(
    __element('tr', {}).append(__element('td', {}, 'inner-data')),
  ),
  __element('tfoot', {}).append(
    __element('tr', {}).append(__element('td', {}, 'inner-foot')),
  ),
);
const outerFootCell = __element('td', {}, 'outer-foot');
outerFootCell.append(inner);
outerFoot.append(__element('tr', {}).append(outerFootCell));
outer.append(outerFoot);
globalThis.__roots = [inner];
`;

function createRealm(setup: string): vm.Context {
  const realm = vm.createContext({});
  vm.runInContext(DOM_STUB, realm);
  vm.runInContext(setup, realm);
  return realm;
}

function runCollector(
  realm: vm.Context,
  options: {selector: string; includeHidden: boolean},
): RawTableCapture {
  const argument = JSON.stringify({
    pageUrl: 'https://example.test/page',
    ...options,
  });
  const value = vm.runInContext(
    `(${collectTableDom.toString()})(${argument})`,
    realm,
  );
  // CDP `returnByValue` serializes the remote value, so cross-realm prototypes
  // never reach the caller; mirror that before asserting on plain objects.
  return JSON.parse(JSON.stringify(value)) as RawTableCapture;
}

interface CdpCall {
  session: string;
  method: string;
  params: Record<string, unknown> | undefined;
}

interface FakeSession {
  id: string;
  detached: number;
}

interface FakeBrowser {
  frame: Frame;
  calls: CdpCall[];
  sessions: FakeSession[];
}

interface FakeBrowserOptions {
  failEvaluate?: boolean;
  resolveFrame?: boolean;
  /** CDP method whose `send` never settles, to exercise the timeout. */
  hangOn?: string;
  /** Raw value the fake `Runtime.evaluate` returns instead of running code. */
  evaluateValue?: unknown;
  /**
   * Frame tree in depth-first order: `childFrames()` and `Page.getFrameTree`
   * both report it this way, while `page.frames()` reports attach order.
   */
  tree?: Array<{id: string; guid: string; url: string; parent?: number}>;
  /** Index into `tree` that the tool receives; defaults to the root. */
  selected?: number;
  /**
   * The selected frame still appears in `page.frames()` but its parent no
   * longer lists it in `childFrames()` (a detached frame mid-capture).
   */
  orphan?: boolean;
  /** Tree indices that expose their own CDP target (OOPIF). */
  ownTarget?: number[];
  /**
   * Error thrown by `context.newCDPSession(frame)` instead of the normal
   * "no separate CDP session" message, e.g. a closed browser.
   */
  frameSessionError?: Error;
}

function createFakeBrowser(
  realm: vm.Context,
  options: FakeBrowserOptions = {},
): FakeBrowser {
  const calls: CdpCall[] = [];
  const sessions: FakeSession[] = [];
  let counter = 0;

  const sessionOwner = new Map<string, 'page' | 'frame'>();
  const frameOwners = new Map<string, Node>();
  const createSession = (owner: 'page' | 'frame') => {
    const id = `session-${++counter}`;
    const record: FakeSession = {id, detached: 0};
    sessionOwner.set(id, owner);
    sessions.push(record);
    const client = {
      send: async (method: string, params?: Record<string, unknown>) => {
        calls.push({session: id, method, params});
        if (options.hangOn === method)
          return new Promise<never>(() => undefined);
        if (method === 'Page.getFrameTree') {
          // A page-target session does not list a cross-process child: the
          // OOPIF has its own target and its own root-only frame tree.
          if (sessionOwner.get(id) === 'frame') {
            const owner = frameOwners.get(id);
            return {
              frameTree: {frame: {id: owner?.id, url: owner?.url}},
            };
          }
          const visible = walkOrder().filter(
            node => !ownTarget.has(nodes.indexOf(node)),
          );
          return {frameTree: pageTreeOf(visible)};
        }
        if (method === 'Page.createIsolatedWorld') {
          const frameId = params?.['frameId'];
          const target = resolveTreeFrame(frameId);
          if (!target) {
            throw new Error(`No frame for given id found: ${String(frameId)}`);
          }
          // A page-level session only knows frames in the page's own process.
          const isOutOfProcess = ownTarget.has(nodes.indexOf(target));
          if (isOutOfProcess && sessionOwner.get(id) !== 'frame') {
            throw new Error(`No frame for given id found: ${String(frameId)}`);
          }
          return {executionContextId: 42};
        }
        if (method === 'Runtime.evaluate') {
          if (options.failEvaluate) throw new Error('CDP runtime blew up');
          if ('evaluateValue' in options) {
            return {result: {value: options.evaluateValue}};
          }
          const expression = String(params?.['expression'] ?? '');
          try {
            const value = vm.runInContext(expression, realm);
            // CDP returnByValue serializes the remote value before it reaches us.
            return {result: {value: JSON.parse(JSON.stringify(value))}};
          } catch (error) {
            const thrown = error as Error;
            return {
              exceptionDetails: {
                text: 'Uncaught',
                exception: {
                  description: `${thrown.name}: ${thrown.message}`,
                },
              },
            };
          }
        }
        throw new Error(`unexpected CDP method: ${method}`);
      },
      detach: async () => {
        record.detached += 1;
      },
    };
    return {client, id};
  };

  // ─── frame tree ───
  // `node` is a live Frame-like object: it exposes `page()` plus the private
  // `_guid` Playwright uses, and `childFrames()` in depth-first order.
  interface Node {
    id: string;
    guid: string;
    url: string;
    children: Node[];
  }

  const buildNodes = (): Node[] => {
    const entries = options.tree ?? [
      {id: 'frame-root', guid: 'frame@root', url: 'https://example.test/page'},
    ];
    const nodes = entries.map(entry => ({
      id: entry.id,
      guid: entry.guid,
      url: entry.url,
      children: [] as Node[],
    }));
    entries.forEach((entry, index) => {
      if (entry.parent === undefined) return;
      nodes[entry.parent]?.children.push(nodes[index]!);
    });
    return nodes;
  };

  const nodes = buildNodes();
  const rootNode = nodes[0]!;
  const selectedNode = nodes[options.selected ?? 0]!;
  if (options.orphan) {
    for (const node of nodes) {
      node.children = node.children.filter(child => child !== selectedNode);
    }
  }
  const ownTarget = new Set(options.ownTarget ?? []);

  const resolveTreeFrame = (frameId: unknown): Node | undefined =>
    nodes.find(node => node.id === frameId) ??
    (frameId === 'frame-root' ? rootNode : undefined);

  /** Playwright's own DFS order — the order `Page.getFrameTree` reports. */
  const walkOrder = (): Node[] => {
    const ordered: Node[] = [];
    const walk = (node: Node): void => {
      ordered.push(node);
      for (const child of node.children) walk(child);
    };
    walk(rootNode);
    return ordered;
  };

  /** Renders the DFS `visible` list back into a CDP frame tree. */
  const pageTreeOf = (visible: Node[]) => {
    const toCdp = (node: Node): Record<string, unknown> => ({
      frame: {id: node.id, url: node.url},
      childFrames: node.children
        .filter(child => visible.includes(child))
        .map(toCdp),
    });
    return toCdp(rootNode);
  };

  const makeFrame = (node: Node): Frame => {
    const frame = {
      page: () => page,
      url: () => node.url,
      _guid: node.guid,
      childFrames: () =>
        node.children.map(child => framesByGuid.get(child.guid)!),
    } as unknown as Frame;
    // Per-target sessions: only frames with their own target (main frame,
    // OOPIF) accept newCDPSession(frame).
    if (ownTarget.has(nodes.indexOf(node))) {
      const tagged = frame as unknown as {__hasTarget: boolean; __node: Node};
      tagged.__hasTarget = true;
      tagged.__node = node;
    }
    return frame;
  };

  const framesByGuid = new Map<string, Frame>();
  for (const node of nodes) {
    framesByGuid.set(node.guid, makeFrame(node));
  }

  // `page.frames()` deliberately reports ATTACH order, which can differ from
  // the depth-first tree order. Test fixtures list `tree` in DFS order, so
  // simulating attach order means listing a nested frame after a later sibling.
  const attachOrder = [...walkOrder()].sort((a, b) => {
    const depthA = depthOf(a);
    const depthB = depthOf(b);
    return depthA === depthB ? 0 : depthA - depthB;
  });

  function depthOf(node: Node): number {
    let depth = 0;
    let current: Node | undefined = node;
    while (current) {
      const parent = nodes.find(candidate =>
        candidate.children.includes(current!),
      );
      current = parent;
      if (parent) depth += 1;
    }
    return depth;
  }

  const selectedFrame = framesByGuid.get(selectedNode.guid)!;
  const context = {
    newCDPSession: async (target: unknown) => {
      if (target === page) return createSession('page').client;
      const hasTarget =
        (target as {__hasTarget?: boolean})?.__hasTarget === true;
      if (hasTarget) {
        const ownerNode = nodes.find(
          node => node === (target as unknown as {__node?: Node}).__node,
        );
        const session = createSession('frame');
        if (ownerNode) frameOwners.set(session.id, ownerNode);
        return session.client;
      }
      if (options.frameSessionError) throw options.frameSessionError;
      // Playwright's message for a same-process subframe.
      throw new Error('This frame does not have a separate CDP session');
    },
  };
  const page = {
    url: () => rootNode.url,
    frames: () =>
      options.resolveFrame === false
        ? []
        : attachOrder.map(node => framesByGuid.get(node.guid)!),
    mainFrame: () => {
      if (options.resolveFrame === false) {
        throw new Error('Target page, context or browser has been closed');
      }
      return framesByGuid.get(rootNode.guid)!;
    },
    context: () => context,
  };

  return {frame: selectedFrame, calls, sessions};
}

function cell(text: string, overrides: Record<string, unknown> = {}) {
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

describe('collectTableDom', () => {
  it('collects a native table with effective rowSpan/colSpan and trimmed text', () => {
    const capture = runCollector(createRealm(NATIVE_SETUP), {
      selector: 'table',
      includeHidden: false,
    });

    assert.deepEqual(capture.source, {
      pageUrl: 'https://example.test/page',
      frameUrl: 'https://example.test/frame',
      title: 'Fixture page',
      selector: 'table',
    });
    assert.equal(capture.rows.length, 3);
    assert.equal(capture.rows[0]?.kind, 'header');
    assert.deepEqual(capture.rows[0]?.cells, [
      cell('Group', {header: true, colSpan: 2}),
      cell('Note', {header: true}),
    ]);
    assert.equal(capture.rows[1]?.kind, 'data');
    assert.deepEqual(capture.rows[1]?.cells, [
      cell('A', {rowSpan: 2}),
      cell('1'),
      cell('x'),
    ]);
    assert.deepEqual(capture.rows[2]?.cells, [cell('B'), cell('y')]);
  });

  it('skips hidden rows by default and includes them with includeHidden', () => {
    const realm = createRealm(NATIVE_SETUP);

    const visibleOnly = runCollector(realm, {
      selector: 'table',
      includeHidden: false,
    });
    assert.equal(visibleOnly.rows.length, 3);
    assert.ok(!JSON.stringify(visibleOnly).includes('secret'));

    const withHidden = runCollector(realm, {
      selector: 'table',
      includeHidden: true,
    });
    assert.equal(withHidden.rows.length, 4);
    assert.ok(JSON.stringify(withHidden).includes('secret'));
  });

  it('collects an ARIA [role="grid"] through role rows and gridcells', () => {
    const capture = runCollector(createRealm(ARIA_SETUP), {
      selector: '[role="grid"]',
      includeHidden: false,
    });

    assert.equal(capture.rows.length, 2);
    assert.equal(capture.rows[0]?.kind, 'header');
    assert.deepEqual(capture.rows[0]?.cells, [
      cell('Name', {header: true}),
      cell('Score', {header: true}),
    ]);
    assert.equal(capture.rows[1]?.kind, 'data');
    assert.deepEqual(capture.rows[1]?.cells, [
      cell('Ann', {rowSpan: 2}),
      cell('9'),
    ]);
  });

  it('keeps nested-table cells out of the parent table', () => {
    const capture = runCollector(createRealm(NESTED_SETUP), {
      selector: 'table',
      includeHidden: true,
    });

    assert.equal(capture.rows.length, 2);
    // The assertion that matters is positional: the outer row has exactly its
    // own two cells, so the nested table's cell never appears at all.
    assert.equal(capture.rows[0]?.cells.length, 2);
    assert.equal(capture.rows[0]?.cells[1]?.text, 'second');
    // The outer cell's text is a harness artifact: this fake concatenates
    // textContent ("outernested"), whereas Chromium's innerText renders a block
    // boundary ("outer" newline "nested"). Assert containment, not the exact
    // string, so
    // the test stays true in a real browser too.
    assert.match(capture.rows[0]?.cells[0]?.text ?? '', /^outer\s*nested$/);
    assert.deepEqual(capture.rows[1]?.cells, [
      cell('third'),
      cell('invisible'),
    ]);
  });

  it('keeps a visibility:hidden cell as an empty placeholder by default', () => {
    const realm = createRealm(NESTED_SETUP);

    // visibility:hidden still occupies its column, so dropping it would shift
    // later cells; includeHidden:true is the only mode that reveals the text.
    const visibleOnly = runCollector(realm, {
      selector: 'table',
      includeHidden: false,
    });
    assert.deepEqual(visibleOnly.rows[1]?.cells, [
      cell('third'),
      cell('', {hidden: true}),
    ]);

    const withHidden = runCollector(realm, {
      selector: 'table',
      includeHidden: true,
    });
    assert.deepEqual(withHidden.rows[1]?.cells, [
      cell('third'),
      cell('invisible'),
    ]);
  });

  it('drops a display:none cell so its column genuinely collapses', () => {
    const capture = runCollector(createRealm(GHOST_ROW_SETUP), {
      selector: 'table',
      includeHidden: false,
    });

    assert.deepEqual(capture.rows, [
      {kind: 'data', cells: [cell('keep'), cell('me')]},
    ]);
  });

  it('keeps rows of a nested native table out of an ARIA grid', () => {
    const capture = runCollector(createRealm(NESTED_ARIA_SETUP), {
      selector: '[role="grid"]',
      includeHidden: false,
    });

    assert.equal(capture.rows.length, 2);
    // Same harness caveat as above: the host cell's text is fake
    // textContent concatenation, so match its shape rather than the literal.
    assert.deepEqual(
      capture.rows.map(row => row.cells.length),
      [1, 2],
    );
    assert.equal(capture.rows[1]?.cells[1]?.text, '9');
    assert.match(capture.rows[1]?.cells[0]?.text ?? '', /^outer\s*nested$/);
  });

  it('classifies thead/tfoot sections of the selected table only', () => {
    const capture = runCollector(createRealm(SECTION_SETUP), {
      selector: 'table',
      includeHidden: false,
    });

    // The selected table sits inside the outer table's <tfoot>; its own
    // tbody row must stay `data`, not inherit the ancestor section.
    assert.deepEqual(
      capture.rows.map(row => [row.kind, row.cells[0]?.text]),
      [
        ['data', 'inner-data'],
        ['footer', 'inner-foot'],
      ],
    );
  });

  it('distinguishes an empty visible cell from a hidden placeholder', () => {
    const capture = runCollector(createRealm(EMPTY_VS_HIDDEN_SETUP), {
      selector: 'table',
      includeHidden: false,
    });

    const [emptyVisible, hiddenPlaceholder] = capture.rows[0]!.cells;
    // Both normalize to null (there is no value either way) ...
    assert.equal(emptyVisible?.text, '');
    assert.equal(hiddenPlaceholder?.text, '');
    // ... but the raw facts keep them distinguishable for the adapter/CSV.
    assert.equal(emptyVisible?.header, false);
    assert.equal(hiddenPlaceholder?.header, false);
    assert.notEqual(
      JSON.stringify(emptyVisible),
      JSON.stringify(hiddenPlaceholder),
    );
  });

  it('keeps a visibility:hidden cell in its column instead of shifting', () => {
    const capture = runCollector(createRealm(VISIBILITY_HIDDEN_CELL_SETUP), {
      selector: 'table',
      includeHidden: false,
    });

    // The hidden cell still occupies its column: it must contribute an empty
    // placeholder so "Oslo" stays in the third column.
    assert.deepEqual(
      capture.rows[1]?.cells.map(entry => entry.text),
      ['Ann', '', 'Oslo'],
    );

    const table = normalizeTable(capture);
    assert.deepEqual(table.rows, [{c1: 'Ann', c2: null, c3: 'Oslo'}]);
    assert.deepEqual(
      table.columns.map(column => column.name),
      ['Name', 'Age', 'City'],
    );
  });

  it('keeps row-span alignment when a visibility:hidden row is skipped', () => {
    const capture = runCollector(createRealm(VISIBILITY_HIDDEN_ROW_SETUP), {
      selector: 'table',
      includeHidden: false,
    });

    const table = normalizeTable(capture);
    // The hidden row occupies its row slot with empty cells, so the row-span
    // anchor keeps covering it and "3"/"Bergen" stay in c2/c3.
    assert.deepEqual(table.rows, [
      {c1: 'Ann', c2: '1', c3: 'Oslo'},
      {c1: null, c2: null, c3: null},
      {c1: null, c2: '3', c3: 'Bergen'},
    ]);
    assert.deepEqual(table.spans, [
      {columnKey: 'c1', section: 'data', row: 0, rowSpan: 3, colSpan: 1},
    ]);
  });

  it('collects an ARIA rowheader as the first data column', () => {
    const capture = runCollector(createRealm(ARIA_ROWHEADER_SETUP), {
      selector: '[role="grid"]',
      includeHidden: false,
    });

    assert.deepEqual(capture.rows[1]?.cells, [
      cell('Ann', {header: true}),
      cell('9'),
    ]);

    const table = normalizeTable(capture);
    assert.deepEqual(table.rows, [{c1: 'Ann', c2: '9'}]);
  });

  it('warns instead of extending header paths with an all-th banner row', () => {
    const capture = runCollector(createRealm(BANNER_ROW_SETUP), {
      selector: 'table',
      includeHidden: false,
    });

    const table = normalizeTable(capture);
    assert.deepEqual(
      table.columns.map(column => column.name),
      ['Name', 'Amount'],
    );
    assert.deepEqual(table.rows, [
      {c1: 'Ann', c2: '1'},
      {c1: 'Bob', c2: '2'},
    ]);
    assert.ok(
      table.warnings.some(warning => /banner|header/i.test(warning)),
      `expected a banner-row warning, got ${JSON.stringify(table.warnings)}`,
    );
  });

  it('collects a table inside an offscreen content-visibility:auto subtree', () => {
    const capture = runCollector(createRealm(OFFSCREEN_SETUP), {
      selector: 'table',
      includeHidden: false,
    });

    assert.ok(
      'rows' in capture,
      `expected a capture, got ${JSON.stringify(capture)}`,
    );
    assert.deepEqual(
      (capture as RawTableCapture).rows.map(row =>
        row.cells.map(entry => entry.text),
      ),
      [['offscreen']],
    );
  });

  it('respects a page override that makes a [hidden] container visible', () => {
    const capture = runCollector(createRealm(HIDDEN_OVERRIDE_SETUP), {
      selector: 'table',
      includeHidden: false,
    });

    assert.ok(
      'rows' in capture,
      `expected a capture, got ${JSON.stringify(capture)}`,
    );
    assert.deepEqual(
      (capture as RawTableCapture).rows.map(row =>
        row.cells.map(entry => entry.text),
      ),
      [['visible-again']],
    );
  });

  it('keeps a zero-cell row that an upstream rowspan covers', () => {
    const capture = runCollector(createRealm(ROWSPAN_OVER_HIDDEN_ROW_SETUP), {
      selector: 'table',
      includeHidden: false,
    });

    // The browser renders "3"/"Bergen" in c1/c2: the rowspan covers the
    // middle row, so that row must still occupy a row in the matrix.
    const table = normalizeTable(capture);
    assert.deepEqual(table.rows, [
      {c1: 'Ann', c2: '1', c3: 'Oslo'},
      {c1: null, c2: null, c3: null},
      {c1: '3', c2: 'Bergen', c3: null},
    ]);
    assert.deepEqual(table.spans, [
      {columnKey: 'c1', section: 'data', row: 0, rowSpan: 2, colSpan: 1},
    ]);
  });

  it('drops a row that has no collectable cells instead of emitting a ghost', () => {
    const capture = runCollector(createRealm(GHOST_ROW_SETUP), {
      selector: 'table',
      includeHidden: false,
    });

    assert.deepEqual(
      capture.rows.map(row => row.cells.map(entry => entry.text)),
      [['keep', 'me']],
    );
    assert.equal(normalizeTable(capture).coverage.rowsReturned, 1);
  });

  it('skips rows under a hidden ancestor unless includeHidden is set', () => {
    const realm = createRealm(HIDDEN_ANCESTOR_SETUP);

    // display does not inherit, so only an ancestor-chain check sees that the
    // row inside the hidden <tbody> is invisible.
    const visibleOnly = runCollector(realm, {
      selector: 'table',
      includeHidden: false,
    });
    assert.deepEqual(
      visibleOnly.rows.map(row => row.cells[0]?.text),
      ['under-hidden-tbody'],
    );

    const withHidden = runCollector(realm, {
      selector: 'table',
      includeHidden: true,
    });
    assert.deepEqual(
      withHidden.rows.map(row => row.cells[0]?.text),
      ['under-hidden-tbody', 'under-hidden-ancestor'],
    );
  });
});

describe('captureTable selection failures', () => {
  const cases = [
    {
      name: 'reports not_found when the selector matches nothing',
      setup: 'globalThis.__roots = [];',
      selector: 'table',
      reason: 'not_found',
    },
    {
      name: 'reports ambiguous when the selector matches two elements',
      setup:
        "globalThis.__roots = [__element('table', {}), __element('table', {})];",
      selector: 'table',
      reason: 'ambiguous',
    },
    {
      name: 'reports not_a_table when the selector targets a plain div',
      setup: "globalThis.__roots = [__element('div', {})];",
      selector: 'div',
      reason: 'not_a_table',
    },
    {
      name: 'reports hidden when the matched root is inside a hidden container',
      setup: HIDDEN_ROOT_SETUP,
      selector: 'table',
      reason: 'hidden',
    },
    {
      name: 'reports bad_selector when the selector is not valid CSS',
      setup: 'globalThis.__roots = [];',
      selector: '[[invalid]]',
      reason: 'bad_selector',
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const browser = createFakeBrowser(createRealm(testCase.setup));
      await assert.rejects(
        () =>
          captureTable(browser.frame, {
            selector: testCase.selector,
            includeHidden: false,
          }),
        (error: unknown) => {
          assert.equal((error as {reason?: string}).reason, testCase.reason);
          return true;
        },
      );
    });
  }

  it('rejects a table under a hidden ancestor even with includeHidden', async () => {
    const browser = createFakeBrowser(createRealm(HIDDEN_ROOT_SETUP));

    // "隐藏容器始终拒绝": includeHidden only widens row/cell inclusion, never
    // the container rule.
    await assert.rejects(
      () =>
        captureTable(browser.frame, {
          selector: 'table',
          includeHidden: true,
        }),
      (error: unknown) => {
        assert.equal((error as {reason?: string}).reason, 'hidden');
        return true;
      },
    );
  });
});

describe('captureTable CDP lifecycle', () => {
  it('uses one isolated world, evaluates by value and detaches the session', async () => {
    const browser = createFakeBrowser(createRealm(NATIVE_SETUP));

    const capture = await captureTable(browser.frame, {
      selector: 'table',
      includeHidden: false,
    });

    assert.equal(capture.rows.length, 3);

    const world = browser.calls.find(
      call => call.method === 'Page.createIsolatedWorld',
    );
    assert.deepEqual(world?.params, {
      frameId: 'frame-root',
      worldName: 'browsercli-extract-table',
    });

    const evaluations = browser.calls.filter(
      call => call.method === 'Runtime.evaluate',
    );
    assert.equal(evaluations.length, 1);
    assert.equal(evaluations[0]?.params?.['returnByValue'], true);
    assert.equal(evaluations[0]?.params?.['awaitPromise'], true);
    assert.equal(evaluations[0]?.params?.['contextId'], 42);
    assert.match(
      String(evaluations[0]?.params?.['expression']),
      /^\(function collectTableDom\(/,
    );

    // Exactly one session per extraction (the frameId is resolved through it),
    // detached exactly once.
    assert.deepEqual(
      browser.sessions.map(session => session.detached),
      [1],
    );
  });

  it('detaches the capture session when Runtime.evaluate throws', async () => {
    const browser = createFakeBrowser(createRealm(NATIVE_SETUP), {
      failEvaluate: true,
    });

    await assert.rejects(
      () =>
        captureTable(browser.frame, {
          selector: 'table',
          includeHidden: false,
        }),
      /CDP runtime blew up/,
    );

    assert.deepEqual(
      browser.sessions.map(session => session.detached),
      [1],
    );
  });

  it('fails clearly when the frame has no resolvable CDP frameId', async () => {
    const browser = createFakeBrowser(createRealm(NATIVE_SETUP), {
      resolveFrame: false,
    });

    await assert.rejects(
      () =>
        captureTable(browser.frame, {
          selector: 'table',
          includeHidden: false,
        }),
      /frameId/,
    );

    // The session opened before resolution is released on this path too.
    assert.deepEqual(
      browser.sessions.map(session => session.detached),
      [1],
    );
  });

  it('resolves the selected frame by tree order, not attach order', async () => {
    // page.frames() attach order: /, /a, /b, /a-child
    // getFrameTree DFS order:    /, /a, /a-child, /b
    // Selecting /b must use /b's frameId, never the one at attach index 2.
    const browser = createFakeBrowser(createRealm(NATIVE_SETUP), {
      tree: [
        {id: 'root', guid: 'frame@root', url: 'https://example.test/'},
        {id: 'a', guid: 'frame@a', url: 'https://example.test/a', parent: 0},
        {
          id: 'a-child',
          guid: 'frame@a-child',
          url: 'https://example.test/a-child',
          parent: 1,
        },
        {id: 'b', guid: 'frame@b', url: 'https://example.test/b', parent: 0},
      ],
      selected: 3,
    });

    await captureTable(browser.frame, {
      selector: 'table',
      includeHidden: false,
    });

    const world = browser.calls.find(
      call => call.method === 'Page.createIsolatedWorld',
    );
    assert.equal(world?.params?.['frameId'], 'b');

    // Every session the tool opened must be released.
    assert.deepEqual(
      browser.sessions.map(session => session.detached),
      [1],
    );
  });

  it('fails cleanly when the selected frame is absent from its own tree', async () => {
    // The frame is still reachable through page.frames() but its parent no
    // longer lists it. Falling back to the attach-order index would resolve a
    // DIFFERENT frame here, so this must be a clean failure instead.
    const browser = createFakeBrowser(createRealm(NATIVE_SETUP), {
      tree: [
        {id: 'root', guid: 'frame@root', url: 'https://example.test/'},
        {id: 'a', guid: 'frame@a', url: 'https://example.test/a', parent: 0},
        {id: 'b', guid: 'frame@b', url: 'https://example.test/b', parent: 0},
      ],
      selected: 2,
      orphan: true,
    });

    await assert.rejects(
      () =>
        captureTable(browser.frame, {
          selector: 'table',
          includeHidden: false,
        }),
      /frameId/,
    );

    // No isolated world is created, and the session opened for resolution is
    // released rather than leaked on the failure path.
    assert.equal(
      browser.calls.filter(call => call.method === 'Page.createIsolatedWorld')
        .length,
      0,
    );
    assert.deepEqual(
      browser.sessions.map(session => session.detached),
      [1],
    );
  });

  it('resolves a same-site sibling correctly while an OOPIF is present', async () => {
    // The page-session frame tree OMITS the cross-process child, while
    // Playwright's own DFS list CONTAINS it. Indexing one with the other
    // therefore shifts by one for every frame after the OOPIF: selecting /a
    // here used to return /b's data as a success.
    const browser = createFakeBrowser(createRealm(NATIVE_SETUP), {
      tree: [
        {id: 'root', guid: 'frame@root', url: 'https://example.test/'},
        {
          id: 'oopif',
          guid: 'frame@oopif',
          url: 'https://other.test/frame',
          parent: 0,
        },
        {id: 'a', guid: 'frame@a', url: 'https://example.test/a', parent: 0},
        {id: 'b', guid: 'frame@b', url: 'https://example.test/b', parent: 0},
      ],
      selected: 2,
      ownTarget: [1],
    });

    const capture = await captureTable(browser.frame, {
      selector: 'table',
      includeHidden: false,
    });

    assert.equal(capture.rows.length, 3);
    const world = browser.calls.find(
      call => call.method === 'Page.createIsolatedWorld',
    );
    assert.equal(
      world?.params?.['frameId'],
      'a',
      'must isolate /a, never the sibling that follows the OOPIF',
    );
    assert.deepEqual(
      browser.sessions.map(session => session.detached),
      [1],
    );
  });

  it('rethrows a frame-session error that is not the same-process signal', async () => {
    // Only "no separate CDP session" means "fall back to the page". A closed
    // browser must surface instead of being retried against the page.
    const browser = createFakeBrowser(createRealm(NATIVE_SETUP), {
      frameSessionError: new Error(
        'Target page, context or browser has been closed',
      ),
    });

    await assert.rejects(
      () =>
        captureTable(browser.frame, {
          selector: 'table',
          includeHidden: false,
        }),
      /browser has been closed/,
    );

    assert.deepEqual(
      browser.sessions.map(session => session.detached),
      [],
    );
  });

  it('opens the capture session on the frame target when it has one', async () => {
    // An OOPIF exposes its own CDP target; a page-level session has no frame
    // record for it, so Page.createIsolatedWorld would fail.
    const browser = createFakeBrowser(createRealm(NATIVE_SETUP), {
      tree: [
        {id: 'root', guid: 'frame@root', url: 'https://example.test/'},
        {
          id: 'oopif',
          guid: 'frame@oopif',
          url: 'https://other.test/frame',
          parent: 0,
        },
      ],
      selected: 1,
      ownTarget: [1],
    });

    const capture = await captureTable(browser.frame, {
      selector: 'table',
      includeHidden: false,
    });

    assert.equal(capture.rows.length, 3);
    const world = browser.calls.find(
      call => call.method === 'Page.createIsolatedWorld',
    );
    assert.equal(world?.params?.['frameId'], 'oopif');
    assert.deepEqual(
      browser.sessions.map(session => session.detached),
      [1],
    );
  });

  it('never enables the Runtime, Page or Debugger domains', async () => {
    const browser = createFakeBrowser(createRealm(NATIVE_SETUP));

    await captureTable(browser.frame, {
      selector: 'table',
      includeHidden: false,
    });

    assert.deepEqual(browser.calls.map(call => call.method).sort(), [
      'Page.createIsolatedWorld',
      'Page.getFrameTree',
      'Runtime.evaluate',
    ]);
  });

  it('times out and still detaches when Runtime.evaluate never settles', async () => {
    const clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
    try {
      const browser = createFakeBrowser(createRealm(NATIVE_SETUP), {
        hangOn: 'Runtime.evaluate',
      });

      const pending = assert.rejects(
        () =>
          captureTable(browser.frame, {
            selector: 'table',
            includeHidden: false,
          }),
        (error: unknown) => {
          assert.match((error as Error).message, /超时/);
          return true;
        },
      );

      await clock.tickAsync(0);
      await clock.tickAsync(30_000);
      await pending;

      // The session must be released even though the CDP call never settled.
      assert.deepEqual(
        browser.sessions.map(session => session.detached),
        [1],
      );
    } finally {
      clock.restore();
    }
  });

  it('times out and still detaches when createIsolatedWorld never settles', async () => {
    const clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
    try {
      const browser = createFakeBrowser(createRealm(NATIVE_SETUP), {
        hangOn: 'Page.createIsolatedWorld',
      });

      const pending = assert.rejects(
        () =>
          captureTable(browser.frame, {
            selector: 'table',
            includeHidden: false,
          }),
        /超时/,
      );

      await clock.tickAsync(0);
      await clock.tickAsync(30_000);
      await pending;

      assert.deepEqual(
        browser.sessions.map(session => session.detached),
        [1],
      );
    } finally {
      clock.restore();
    }
  });

  it('rejects a malformed collector result with a clear message', async () => {
    const browser = createFakeBrowser(createRealm(NATIVE_SETUP), {
      evaluateValue: {source: {selector: 'table'}},
    });

    await assert.rejects(
      () =>
        captureTable(browser.frame, {
          selector: 'table',
          includeHidden: false,
        }),
      /rows/,
    );

    assert.deepEqual(
      browser.sessions.map(session => session.detached),
      [1],
    );
  });
});
