/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import vm from 'node:vm';

import type {Frame} from 'patchright';

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

globalThis.window = globalThis;
globalThis.__element = (tagName, attributes, text) =>
  new FakeElement(tagName, attributes, text);
globalThis.getComputedStyle = target =>
  target.style || {display: 'block', visibility: 'visible'};
globalThis.location = {href: 'https://example.test/frame'};
globalThis.document = {
  title: 'Fixture page',
  querySelectorAll: () => globalThis.__roots || [],
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
}

function createFakeBrowser(
  realm: vm.Context,
  options: FakeBrowserOptions = {},
): FakeBrowser {
  const calls: CdpCall[] = [];
  const sessions: FakeSession[] = [];
  let counter = 0;

  const createSession = () => {
    const id = `session-${++counter}`;
    const record: FakeSession = {id, detached: 0};
    sessions.push(record);
    return {
      send: async (method: string, params?: Record<string, unknown>) => {
        calls.push({session: id, method, params});
        if (method === 'Page.getFrameTree') {
          return {frameTree: {frame: {id: 'frame-root'}}};
        }
        if (method === 'Page.createIsolatedWorld') {
          return {executionContextId: 42};
        }
        if (method === 'Runtime.evaluate') {
          if (options.failEvaluate) throw new Error('CDP runtime blew up');
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
  };

  const page = {
    url: () => 'https://example.test/page',
    frames: () => (options.resolveFrame === false ? [] : [frame]),
    context: () => ({newCDPSession: async () => createSession()}),
  };
  const frame = {page: () => page} as unknown as Frame;

  return {frame, calls, sessions};
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
    assert.equal(capture.rows[0]?.cells.length, 2);
    assert.deepEqual(
      capture.rows[0]?.cells.map(entry => entry.text),
      ['outernested', 'second'],
    );
    assert.deepEqual(capture.rows[1]?.cells, [
      cell('third'),
      cell('invisible'),
    ]);
  });

  it('skips hidden cells by default and includes them with includeHidden', () => {
    const realm = createRealm(NESTED_SETUP);

    const visibleOnly = runCollector(realm, {
      selector: 'table',
      includeHidden: false,
    });
    assert.deepEqual(visibleOnly.rows[1]?.cells, [cell('third')]);

    const withHidden = runCollector(realm, {
      selector: 'table',
      includeHidden: true,
    });
    assert.deepEqual(withHidden.rows[1]?.cells, [
      cell('third'),
      cell('invisible'),
    ]);
  });

  it('keeps rows of a nested native table out of an ARIA grid', () => {
    const capture = runCollector(createRealm(NESTED_ARIA_SETUP), {
      selector: '[role="grid"]',
      includeHidden: false,
    });

    assert.equal(capture.rows.length, 2);
    assert.deepEqual(
      capture.rows.map(row => row.cells.map(entry => entry.text)),
      [['Name'], ['outernested', '9']],
    );
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

    // Two sessions: the short-lived one the shared frameId resolver opens and
    // closes, plus the single session this tool owns. Both must be detached.
    assert.equal(browser.sessions.length, 2);
    assert.deepEqual(
      browser.sessions.map(session => session.detached),
      [1, 1],
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

    assert.equal(browser.sessions.length, 2);
    assert.deepEqual(
      browser.sessions.map(session => session.detached),
      [1, 1],
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

    assert.equal(browser.sessions.length, 0);
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
});
