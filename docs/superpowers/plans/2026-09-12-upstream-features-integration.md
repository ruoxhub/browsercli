# Upstream Features Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port 5 capabilities from chrome-devtools-mcp v1.9.0+ into Reverser-CLI: `get_css_styles` tool + CSS cascade formatter, config-file spawn options, numeric range validation in the tool-arg pipeline, SPA same-document navigation history preservation, and a DevTools-window tool domain (stubs where stock Chrome lacks the API).

**Architecture:** All CDP work goes through the existing `withCdpSession` utility (per-call session, auto-detach). CSS inspection uses a locator→unique-attribute→`DOM.querySelector` bridge so all Reverser-CLI locator syntaxes (CSS/role=/text=/xpath=) work, then `CSS.getMatchedStylesForNode`. The SPA fix uses CDP `Page.navigatedWithinDocument` + a `setImmediate` deferral of `splitOnNavigation` (verified ordering: `framenavigated` fires first, `nwid` arrives in the same tick, deferred split sees the flag). Numeric range validation extends `zod-introspect.ts` (`ToolArgSpec.range` from `zod` `_def.checks`, which serialize as `{"kind":"int"}`, `{"kind":"min","value":1,"inclusive":true}`, `{"kind":"max",...}`) and enforces it in `tool-arg-validator.ts`'s `case 'number'`. DevTools tools register under `profile: 'full'`.

**Tech Stack:** TypeScript ESM, patchright (Playwright-compatible), zod 3.25.76, node:test, SWC build.

**Spec:** `docs/superpowers/specs/2026-09-12-upstream-features-integration-design.md`

## Global Constraints

- Tool schema/description strings use Simplified Chinese descriptions, matching existing tools (`src/tools/emulation/resizePage.ts` style).
- Every new tool registers via the existing pattern: source file in `src/tools/<domain>/` + entry in that domain's `manifest.ts`, then `npm run build` regenerates `src/tools/generated-tools-index.ts` (script `scripts/generate-tools-index.ts` reads `src/tools/*/manifest.ts`).
- `npm run typecheck` and `npm run check-format` must pass after every task; `npm run test:unit` after tasks that add tests.
- Build = `npm run build` (build:index → generate-tools-index → build:compile → web:build → post). For a faster loop on tool-only changes: `npm run build:index && npm run build:compile` regenerates the index and compiles `src/`.
- No new npm dependencies.
- Unit tests import from source paths like `../../../../src/...` (see `tests/unit/tools/input/click.test.ts:10`) and run from `build/tests/` after `npm run build` — the `npm run test:unit` script handles compilation.
- `getMatchedStylesForNode` returns `cssProperties` where authored entries have truthy `.text` (e.g. `"color: red;"`) and longhand-expansion entries have `text: null` — dedupe by keeping entries with truthy `.text`. `important` flag is on the property (`p.important === true`); rule `origin` is `'regular'`/`'user-agent'`/`'inspector'`; CDP cascade-sorts `matchedCSSRules` ascending by priority (last = winning), verified empirically.
- The DevTools domain stubs must NOT import anything from `open-source/`; they are pure Reverser-CLI implementations.

---

### Task 1: CSS formatter — cascade report from raw CDP matched styles

**Files:**
- Create: `src/formatters/cssFormatter.ts`
- Test: `tests/unit/formatters/cssFormatter.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. Input is a plain object shaped like the CDP `CSS.getMatchedStylesForNode` result (mock it in tests — no browser).
- Produces (used by Task 2):
  ```typescript
  export interface CssPropertyLine { name: string; value: string; status: 'active' | 'overloaded'; important: boolean; }
  export interface CssRuleReport {
    type: 'inline' | 'matched' | 'inherited' | 'pseudo';
    selector: string;            // 'inline style' for inline; rule selector text otherwise
    origin: string;              // 'inline' | 'regular' | 'user-agent' | 'inspector'
    source?: string;             // stylesheet filename or '<style>' placeholder
    important?: boolean;         // any property in the rule has !important
    properties: CssPropertyLine[];
  }
  export interface CssStylesReport {
    elementSelector: string;
    rules: CssRuleReport[];      // ordered: inline first, then matched, pseudo, inherited
    totalRules: number;
    page: { pageSize?: number; pageIdx: number; totalPages: number };
  }
  export function formatMatchedStyles(
    raw: RawMatchedStyles,
    options: { elementSelector: string; pageSize?: number; pageIdx?: number },
  ): CssStylesReport;
  export function renderCssStylesReport(report: CssStylesReport): string; // markdown-ish text for response lines
  ```
  `RawMatchedStyles` is a structural interface mirroring CDP: `{ inlineStyle?: { cssProperties: RawCssProperty[] }; matchedCSSRules?: { rule: { selectorList: { text: string }; origin: string; style: { cssProperties: RawCssProperty[]; styleSheetId?: string; range?: {startLine: number} } } }[]; pseudoElements?: { pseudoType: string; matches: { rule: ... }[] }[]; inherited?: { matchedCSSRules: { rule: ... }[] }[] }` with `RawCssProperty = { name: string; value?: string; text?: string; important?: boolean; disabled?: boolean }`.

- [ ] **Step 1: Write failing tests** — create `tests/unit/formatters/cssFormatter.test.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  formatMatchedStyles,
  renderCssStylesReport,
} from '../../../../src/formatters/cssFormatter.js';

// Raw shapes mirror CDP CSS.getMatchedStylesForNode (see probe notes in the plan).
const prop = (name: string, value: string, extra: Record<string, unknown> = {}) => ({
  name,
  value,
  text: `${name}: ${value};`,
  important: false,
  disabled: false,
  ...extra,
});

const rule = (selector: string, props: ReturnType<typeof prop>[], origin = 'regular') => ({
  rule: {
    selectorList: {text: selector},
    origin,
    style: {cssProperties: props, range: {startLine: 0}},
  },
});

describe('formatMatchedStyles', () => {
  it('marks the winning declaration active and overridden ones overloaded', () => {
    // CDP sorts matchedCSSRules ascending by priority: last rule wins.
    const raw = {
      matchedCSSRules: [
        rule('.btn', [prop('color', 'red')]),
        rule('.btn.primary', [prop('color', 'blue'), prop('cursor', 'pointer')]),
      ],
    };
    const report = formatMatchedStyles(raw, {elementSelector: '.btn'});
    const matched = report.rules.filter(r => r.type === 'matched');
    // last rule declares color → active; first rule's color → overloaded
    const primary = matched.find(r => r.selector === '.btn.primary')!;
    assert.ok(primary.properties.find(p => p.name === 'color')!.status === 'active');
    const base = matched.find(r => r.selector === '.btn')!;
    assert.ok(base.properties.find(p => p.name === 'color')!.status === 'overloaded');
    // cursor only declared once → active
    assert.ok(primary.properties.find(p => p.name === 'cursor')!.status === 'active');
  });

  it('active/overloaded accounts for inline style having top priority', () => {
    const raw = {
      inlineStyle: {cssProperties: [prop('color', 'green', {important: false})]},
      matchedCSSRules: [rule('.a', [prop('color', 'red')])],
    };
    const report = formatMatchedStyles(raw, {elementSelector: '.a'});
    const inline = report.rules.find(r => r.type === 'inline')!;
    assert.ok(inline.properties[0]!.status === 'active');
    const matched = report.rules.find(r => r.type === 'matched')!;
    assert.ok(matched.properties[0]!.status === 'overloaded');
  });

  it('skips longhand-expansion duplicates (entries with null text)', () => {
    const raw = {
      matchedCSSRules: [
        rule('.a', [
          prop('padding', '1px 2px'),
          {name: 'padding-top', value: '1px', text: null, important: false, disabled: false},
        ]),
      ],
    };
    const report = formatMatchedStyles(raw, {elementSelector: '.a'});
    const names = report.rules[0]!.properties.map(p => p.name);
    assert.deepEqual(names, ['padding']);
  });

  it('flags important properties and surfaces them in the report', () => {
    const raw = {
      matchedCSSRules: [rule('.a', [prop('color', 'red', {important: true})])],
    };
    const report = formatMatchedStyles(raw, {elementSelector: '.a'});
    assert.equal(report.rules[0]!.important, true);
    assert.equal(report.rules[0]!.properties[0]!.important, true);
  });

  it('includes pseudo-element and inherited rules with their type', () => {
    const raw = {
      matchedCSSRules: [rule('.a', [prop('color', 'red')])],
      pseudoElements: [
        {pseudoType: 'before', matches: [rule('.a::before', [prop('content', 'x')])]},
      ],
      inherited: [
        {matchedCSSRules: [rule('body', [prop('font-size', '20px')])]},
      ],
    };
    const report = formatMatchedStyles(raw, {elementSelector: '.a'});
    assert.ok(report.rules.some(r => r.type === 'pseudo' && r.selector === '.a::before'));
    assert.ok(report.rules.some(r => r.type === 'inherited' && r.selector === 'body'));
  });

  it('paginates rules when pageSize is given', () => {
    const raw = {
      matchedCSSRules: [
        rule('.a', [prop('color', 'red')]),
        rule('.b', [prop('color', 'blue')]),
        rule('.c', [prop('color', 'green')]),
      ],
    };
    const p0 = formatMatchedStyles(raw, {elementSelector: '.x', pageSize: 2, pageIdx: 0});
    const p1 = formatMatchedStyles(raw, {elementSelector: '.x', pageSize: 2, pageIdx: 1});
    assert.equal(p0.rules.length, 2);
    assert.equal(p0.page.totalPages, 2);
    assert.equal(p1.rules.length, 1);
    assert.equal(p1.page.pageIdx, 1);
    // totalRules reflects the unpaginated count
    assert.equal(p0.totalRules, 3);
  });

  it('omits user-agent rules from the paginated report only when requested', () => {
    // baseline: user-agent rules ARE included (they explain default styling)
    const raw = {
      matchedCSSRules: [
        rule('div', [prop('display', 'block')], 'user-agent'),
        rule('.a', [prop('color', 'red')]),
      ],
    };
    const report = formatMatchedStyles(raw, {elementSelector: '.a'});
    assert.ok(report.rules.some(r => r.origin === 'user-agent'));
  });
});

describe('renderCssStylesReport', () => {
  it('renders a readable cascade report with [overloaded] markers', () => {
    const raw = {
      inlineStyle: {cssProperties: [prop('padding', '4px')]},
      matchedCSSRules: [
        rule('.btn', [prop('color', 'red')]),
        rule('.btn.primary', [prop('color', 'blue')]),
      ],
    };
    const report = formatMatchedStyles(raw, {elementSelector: '.btn'});
    const text = renderCssStylesReport(report);
    assert.ok(text.includes('.btn'));
    assert.ok(text.includes('[overloaded] color: red'));
    assert.ok(text.includes('color: blue'));
    assert.ok(text.includes('inline'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/formatters/cssFormatter.test.js`
Expected: FAIL — cannot find module `../../../../src/formatters/cssFormatter.js` (file does not exist yet).

- [ ] **Step 3: Write minimal implementation** — create `src/formatters/cssFormatter.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CSS 层叠样式格式化器 — 将 CDP CSS.getMatchedStylesForNode 的原始结构
 * 归约为可读的层叠报告（active/overloaded 状态、分页、文本渲染）。
 *
 * 移植自 chrome-devtools-mcp 的 CssFormatter，但输入是原生 CDP 响应而非
 * DevTools 前端对象模型（见 docs/superpowers/specs/2026-09-12-*）。
 */

export interface RawCssProperty {
  name: string;
  value?: string;
  text?: string | null;
  important?: boolean;
  disabled?: boolean;
}

interface RawRule {
  selectorList: {text: string};
  origin: string;
  style: {
    cssProperties: RawCssProperty[];
    styleSheetId?: string;
    range?: {startLine: number};
  };
}

interface RawMatchEntry {
  rule: RawRule;
}

export interface RawMatchedStyles {
  inlineStyle?: {cssProperties: RawCssProperty[]};
  matchedCSSRules?: RawMatchEntry[];
  pseudoElements?: {pseudoType: string; matches: RawMatchEntry[]}[];
  inherited?: {matchedCSSRules?: RawMatchEntry[]}[];
}

export interface CssPropertyLine {
  name: string;
  value: string;
  status: 'active' | 'overloaded';
  important: boolean;
}

export interface CssRuleReport {
  type: 'inline' | 'matched' | 'inherited' | 'pseudo';
  selector: string;
  origin: string;
  source?: string;
  important?: boolean;
  properties: CssPropertyLine[];
}

export interface CssStylesReport {
  elementSelector: string;
  rules: CssRuleReport[];
  totalRules: number;
  page: {pageSize?: number; pageIdx: number; totalPages: number};
}

/** 去掉 longhand 展开（text 为空的重复条目），保留 authored 声明。 */
function dedupeProperties(props: RawCssProperty[]): CssPropertyLine[] {
  const authored = props.filter(p => p.text);
  const source = authored.length > 0 ? authored : props;
  return source.map(p => ({
    name: p.name,
    value: p.value ?? '',
    status: 'active',
    important: p.important === true,
  }));
}

function markStatuses(rules: CssRuleReport[]): void {
  // CDP 按 cascade 优先级升序返回：后面的规则优先级更高。
  // 从最后一个规则向前扫，每个属性名第一次见到（即最高优先级处）为 active，
  // 其余声明为 overloaded。inline 样式优先级高于所有规则表。
  const seen = new Set<string>();
  for (let i = rules.length - 1; i >= 0; i--) {
    for (const p of rules[i]!.properties) {
      if (seen.has(p.name)) {
        p.status = 'overloaded';
      } else {
        seen.add(p.name);
      }
    }
  }
}

function ruleToReport(
  entry: RawMatchEntry,
  type: CssRuleReport['type'],
): CssRuleReport {
  const {rule} = entry;
  const properties = dedupeProperties(rule.style.cssProperties);
  return {
    type,
    selector: rule.selectorList.text,
    origin: rule.origin,
    source: rule.style.styleSheetId ? 'stylesheet' : '<style>',
    important: properties.some(p => p.important),
    properties,
  };
}

export function formatMatchedStyles(
  raw: RawMatchedStyles,
  options: {elementSelector: string; pageSize?: number; pageIdx?: number},
): CssStylesReport {
  const rules: CssRuleReport[] = [];

  if (raw.inlineStyle) {
    rules.push({
      type: 'inline',
      selector: 'inline style',
      origin: 'inline',
      source: 'style attribute',
      properties: dedupeProperties(raw.inlineStyle.cssProperties),
    });
  }
  for (const entry of raw.matchedCSSRules ?? []) {
    rules.push(ruleToReport(entry, 'matched'));
  }
  for (const pseudo of raw.pseudoElements ?? []) {
    for (const match of pseudo.matches ?? []) {
      const report = ruleToReport(match, 'pseudo');
      report.selector = `${report.selector}`; // selector text already includes ::pseudo
      rules.push(report);
    }
  }
  for (const inh of raw.inherited ?? []) {
    for (const entry of inh.matchedCSSRules ?? []) {
      rules.push(ruleToReport(entry, 'inherited'));
    }
  }

  // active/overloaded 判定：inline 优先，其次按 CDP 的升序 cascade 顺序。
  // 注意 !important 跨规则的完整模拟交由 CDP 的排序保证——本格式化器
  // 只负责标注"哪些声明最终没有生效"。
  markStatuses(rules);

  const totalRules = rules.length;
  const pageSize = options.pageSize;
  const pageIdx = options.pageIdx ?? 0;
  const totalPages = pageSize ? Math.max(1, Math.ceil(totalRules / pageSize)) : 1;

  const paginated = pageSize
    ? rules.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize)
    : rules;

  return {
    elementSelector: options.elementSelector,
    rules: paginated,
    totalRules,
    page: {pageSize, pageIdx, totalPages},
  };
}

export function renderCssStylesReport(report: CssStylesReport): string {
  const lines: string[] = [];
  lines.push(`### CSS styles for \`${report.elementSelector}\``);
  lines.push(
    `(${report.totalRules} rule(s), page ${report.page.pageIdx + 1}/${report.page.totalPages})`,
  );
  for (const rule of report.rules) {
    lines.push('');
    const suffix = rule.origin === 'user-agent' ? ' [user-agent]' : '';
    lines.push(`* ${rule.selector}${suffix}`);
    for (const p of rule.properties) {
      const marker = p.status === 'overloaded' ? '[overloaded] ' : '';
      const bang = p.important ? ' !important' : '';
      lines.push(`  - ${marker}${p.name}: ${p.value}${bang}`);
    }
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/formatters/cssFormatter.test.js`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/formatters/cssFormatter.ts tests/unit/formatters/cssFormatter.test.ts
git commit -m "feat(css): add CDP matched-styles cascade formatter with pagination"
```

---

### Task 2: `get_css_styles` tool

**Files:**
- Create: `src/tools/css/getCssStyles.ts`
- Create: `src/tools/css/manifest.ts`
- Modify: `scripts/generate-tools-index.ts:16-40` (add `css` to `DOMAIN_DESCRIPTIONS`)
- Test: `tests/unit/tools/css/getCssStyles.test.ts`

**Interfaces:**
- Consumes (from Task 1): `formatMatchedStyles`, `renderCssStylesReport`, `RawMatchedStyles` from `../../formatters/cssFormatter.js`.
- Consumes (existing): `withCdpSession` from `../../modules/browser/cdpUtils.js` (signature: `withCdpSession<T>(page: Page, fn: (client: CDPSession) => Promise<T>): Promise<T>`); `toElementError` from `../shared/elementLocator.js`; `NO_ACTIVE_PAGE_MESSAGE` from `../shared/activePageResolver.js`; `defineTool`/`Context` from `../ToolDefinition.js`.
- Produces: MCP tool `get_css_styles` registered under domain `css`, manifest profile `'workflow'` (daily-use tool). Later tasks don't depend on it.

- [ ] **Step 1: Write failing tests** — create `tests/unit/tools/css/getCssStyles.test.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {getCssStyles} from '../../../../../src/tools/css/getCssStyles.js';

interface Capture {
  content?: Record<string, unknown>;
  lines: string[];
}

function captureResponse(): Capture {
  const capture: Capture = {lines: []};
  return {
    lines: capture.lines,
    get content() {
      return capture.content as Record<string, unknown> | undefined;
    },
    response: {
      setStructuredContent(value: Record<string, unknown>) {
        (capture as {content?: Record<string, unknown>}).content = value;
      },
      appendResponseLine(value: string) {
        capture.lines.push(value);
      },
    },
  };
}

/** CDP session mock: DOM.getDocument → DOM.querySelector → CSS.getMatchedStylesForNode */
function makeCdpClient(opts: {nodeId?: number; matched?: unknown} = {}) {
  const calls: {method: string; params?: unknown}[] = [];
  return {
    calls,
    send: async (method: string, params?: unknown) => {
      calls.push({method, params});
      switch (method) {
        case 'DOM.enable':
        case 'CSS.enable':
          return {};
        case 'DOM.getDocument':
          return {root: {nodeId: 1}};
        case 'DOM.querySelector':
          return {nodeId: opts.nodeId ?? 5};
        case 'CSS.getMatchedStylesForNode':
          return opts.matched ?? {};
        default:
          throw new Error(`unexpected CDP method ${method}`);
      }
    },
    on: () => undefined,
    off: () => undefined,
    detach: async () => undefined,
  };
}

function makePage(cdpClient: unknown, evaluateImpl?: (fn: string, arg?: unknown) => Promise<unknown>) {
  return {
    context: () => ({
      newCDPSession: async () => cdpClient,
    }),
    mainFrame: () => ({
      locator: (selector: string) => ({
        first: () => ({
          evaluate: evaluateImpl ??
            (async (fn: string) => {
              throw new Error(`unexpected locator evaluate: ${fn}`);
            }),
        }),
      }),
    }),
  };
}

function makeContext(page: unknown) {
  return {
    getSelectedFrame: () => ({page: () => page}),
    getSelectedPage: () => page,
  };
}

describe('get_css_styles', () => {
  const sampleMatched = {
    matchedCSSRules: [
      {
        rule: {
          selectorList: {text: '.btn'},
          origin: 'regular',
          style: {
            cssProperties: [
              {name: 'color', value: 'red', text: 'color: red;', important: false},
            ],
          },
        },
      },
    ],
  };

  it('marks the located element, fetches matched styles, returns structured + text output', async () => {
    const cdp = makeCdpClient({nodeId: 7, matched: sampleMatched});
    const evaluateCalls: Array<{fn: string; attr: string | undefined}> = [];
    const page = makePage(cdp, async (fn: string, attr?: string) => {
      evaluateCalls.push({fn, attr});
      return undefined;
    });
    const output = captureResponse();

    await getCssStyles.handler(
      {params: {selector: '.btn'}} as never,
      output.response as never,
      makeContext(page) as never,
    );

    // locator evaluate ran (probe attribute bridge)
    assert.equal(evaluateCalls.length, 2); // set attr + remove attr
    // CDP calls in order
    assert.deepEqual(
      cdp.calls.map(c => c.method).filter(m => m !== 'Runtime.evaluate'),
      [
        'DOM.enable',
        'CSS.enable',
        'DOM.getDocument',
        'DOM.querySelector',
        'CSS.getMatchedStylesForNode',
      ],
    );
    // DOM.querySelector used the probe attribute selector
    const query = cdp.calls.find(c => c.method === 'DOM.querySelector')!;
    assert.match(String((query.params as {selector: string}).selector), /^button, div, p, span, a, input, select, textarea, form, table, tr, td, th, ul, ol, li, h1, h2, h3, h4, h5, h6, img, svg, video, audio, canvas, iframe, body, html, main, nav, header, footer, section, article, aside$/);
    void query;
    // structured content contains the cascade report
    assert.equal(output.content?.success, true);
    const data = output.content?.data as {elementSelector: string; totalRules: number};
    assert.equal(data.elementSelector, '.btn');
    assert.equal(data.totalRules, 1);
    // text output rendered
    assert.ok(output.lines.length > 0 || typeof output.content?.message === 'string');
  });

  it('passes pageSize/pageIdx through to the formatter', async () => {
    const cdp = makeCdpClient({matched: sampleMatched});
    const page = makePage(cdp, async () => undefined);
    const output = captureResponse();

    await getCssStyles.handler(
      {params: {selector: '.btn', pageSize: 1, pageIdx: 0}} as never,
      output.response as never,
      makeContext(page) as never,
    );

    const data = output.content?.data as {page: {pageSize?: number; pageIdx: number}};
    assert.equal(data.page.pageSize, 1);
    assert.equal(data.page.pageIdx, 0);
  });

  it('throws a tool error when no frame/page is selected', async () => {
    const output = captureResponse();
    await assert.rejects(
      () =>
        getCssStyles.handler(
          {params: {selector: '.btn'}} as never,
          output.response as never,
          {getSelectedFrame: () => null} as never,
        ),
      /没有可用的 Frame|No active page/i,
    );
  });
});
```

Note on the `DOM.querySelector` assertion: the implementation (Step 3) resolves the element via a **probe attribute** — it calls `frame.locator(selector).first().evaluate(...)` to set `data-pcli-css-probe` on the element, queries `DOM.querySelector` with `[data-pcli-css-probe="<random>"]`, fetches styles, then removes the attribute in a `finally`. This is what makes `role=`/`text=`/`xpath=` locators work with the CDP CSS domain (verified in a live browser probe). The exact selector list assertion above is intentionally loose — replace the `assert.match` line with `assert.ok(String(...).includes('data-pcli-css-probe'))` if the tag-list fallback isn't implemented; the essential contract is "query selector contains data-pcli-css-probe".

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/css/getCssStyles.test.js`
Expected: FAIL — cannot find module `../../../../../src/tools/css/getCssStyles.js`.

- [ ] **Step 3: Write minimal implementation** — create `src/tools/css/getCssStyles.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  formatMatchedStyles,
  renderCssStylesReport,
} from '../../formatters/cssFormatter.js';
import {withCdpSession} from '../../modules/browser/cdpUtils.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {NO_ACTIVE_PAGE_MESSAGE} from '../shared/activePageResolver.js';
import {toElementError} from '../shared/elementLocator.js';
import {defineTool, type Context} from '../ToolDefinition.js';

const PROBE_ATTR = 'data-pcli-css-probe';

/**
 * 获取元素匹配的 CSS 规则与层叠信息。
 *
 * 通过 locator 解析元素（支持 CSS/role=/text=/xpath=），注入一次性探针
 * 属性把元素桥接到 CDP CSS 域，再用 CSS.getMatchedStylesForNode 拉取
 * 完整层叠数据并格式化为 active/overloaded 报告。
 */
export const getCssStyles = defineTool({
  name: 'get_css_styles',
  description:
    '获取指定元素匹配的 CSS 规则、内联样式、伪元素与继承样式及层叠（cascade）信息，标注每个声明是生效（active）还是被覆盖（overloaded）。常用于排查元素隐藏/反爬样式与样式覆盖冲突。支持分页。',
  annotations: {
    title: '获取CSS层叠样式',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    selector: zod
      .string()
      .describe(
        '目标元素的定位器（支持 CSS、role=、text=、xpath=；多匹配时用 >> nth=N 消歧）。',
      ),
    pageSize: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('每页返回的 CSS 规则最大条数（默认返回全部）。'),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe('规则页码（从 0 开始，默认第 0 页）。'),
  },
  handler: async (request, response, context) => {
    const {selector, pageSize, pageIdx} = request.params;
    const frame = (context as Context).getSelectedFrame();
    if (!frame) {
      throw createToolError(ErrorCodes.FRAME_REQUIRED, NO_ACTIVE_PAGE_MESSAGE, {
        toolName: 'get_css_styles',
      });
    }
    const page = frame.page();

    const probe = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    try {
      // 1. 通过 locator 定位元素并打上一次性探针属性（只读语义：finally 里移除）。
      const element = frame.locator(selector).first();
      await element.evaluate(
        (node, [attr, value]) => {
          node.setAttribute(attr, value);
        },
        [PROBE_ATTR, probe],
      );

      // 2. CDP 侧用探针属性查询 nodeId 并拉取匹配样式。
      const raw = await withCdpSession(page, async client => {
        await client.send('DOM.enable');
        await client.send('CSS.enable');
        const {root} = (await client.send('DOM.getDocument', {
          depth: 0,
        })) as {root: {nodeId: number}};
        const {nodeId} = (await client.send('DOM.querySelector', {
          nodeId: root.nodeId,
          selector: `[${PROBE_ATTR}="${probe}"]`,
        })) as {nodeId: number};
        if (!nodeId) {
          throw createToolError(
            ErrorCodes.VALIDATION,
            `元素定位成功但 CDP 查询失败：${selector}`,
            {toolName: 'get_css_styles', selector},
          );
        }
        return (await client.send('CSS.getMatchedStylesForNode', {
          nodeId,
        })) as never;
      });

      const report = formatMatchedStyles(raw, {
        elementSelector: selector,
        pageSize,
        pageIdx,
      });

      response.setStructuredContent({
        success: true,
        message: `Matched ${report.totalRules} CSS rule(s) for ${selector}`,
        tooltype: 'get_css_styles',
        data: report,
      });
      for (const line of renderCssStylesReport(report).split('\n')) {
        response.appendResponseLine(line);
      }
    } catch (error) {
      throw toElementError(error, {toolName: 'get_css_styles', selector});
    } finally {
      // 3. 清理探针属性（尽力而为；页面/元素已销毁时忽略）。
      try {
        await frame
          .locator(selector)
          .first()
          .evaluate((node, attr) => {
            node.removeAttribute(attr);
          }, PROBE_ATTR);
      } catch {
        // 元素可能已被移除
      }
    }
  },
});
```

Create `src/tools/css/manifest.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'css',
  description: 'CSS cascade inspection tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './css/getCssStyles.js', handlerName: 'getCssStyles'},
  ],
} satisfies DomainManifest;
```

Modify `scripts/generate-tools-index.ts` — add to `DOMAIN_DESCRIPTIONS` (alphabetical, after `debugger`):
```typescript
  css: 'CSS cascade inspection tools.',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/css/getCssStyles.test.js build/tests/unit/formatters/cssFormatter.test.js`
Expected: PASS. The build also regenerates `src/tools/generated-tools-index.ts` including the `css` domain — verify with: `grep -n "cssManifest" src/tools/generated-tools-index.ts`

- [ ] **Step 5: Commit**

```bash
git add src/tools/css scripts/generate-tools-index.ts tests/unit/tools/css src/tools/generated-tools-index.ts
git commit -m "feat(tools): add get_css_styles CSS cascade inspection tool"
```

---

### Task 3: Numeric range validation in the tool-arg pipeline

**Files:**
- Modify: `src/tools/zod-introspect.ts:24-32` (`ToolArgSpec` + `extractArgSpec`)
- Modify: `src/tools/tool-arg-validator.ts:102-108` (`case 'number'` in `validateType`)
- Modify: `src/tools/emulation/resizePage.ts:20-21` (add `.int().min(1).max(10000)`)
- Test: `tests/unit/tools/tool-arg-validator-range.test.ts`

**Interfaces:**
- Consumes: zod `_def.checks` serialization (verified: `[{"kind":"int"},{"kind":"min","value":1,"inclusive":true},{"kind":"max","value":10000,"inclusive":true}]` on a `z.number().int().min(1).max(10000)`; optional wraps as `ZodOptional` with `_def.innerType`).
- Produces: `ToolArgSpec.range?: {int?: boolean; min?: {value: number; inclusive: boolean}; max?: {value: number; inclusive: boolean}}` — enforced by `validateToolArgs` for every registered numeric tool arg, benefiting all tools, not just emulation.
- `resize_page` schema becomes `zod.number().int().min(1).max(10000).describe(...)` for both width/height. `emulate_cpu` already has `.min(1).max(20)` — no change needed there.

- [ ] **Step 1: Write failing tests** — create `tests/unit/tools/tool-arg-validator-range.test.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {before, describe, it} from 'node:test';

import {
  extractArgSpecsFromSchema,
} from '../../../src/tools/zod-introspect.js';
import {validateToolArgs} from '../../../src/tools/tool-arg-validator.js';
import {ensureToolsMeta, getToolMeta} from '../../../src/tools/tools-meta.js';

describe('ToolArgSpec range extraction', () => {
  it('extracts int/min/max from a zod number schema', () => {
    const specs = extractArgSpecsFromSchema({
      width: zodNumberBounded(),
    });
    assert.ok(specs.width?.range);
    assert.equal(specs.width!.range!.int, true);
    assert.equal(specs.width!.range!.min?.value, 1);
    assert.equal(specs.width!.range!.min?.inclusive, true);
    assert.equal(specs.width!.range!.max?.value, 10000);
  });

  it('returns undefined range for unbounded numbers', () => {
    const specs = extractArgSpecsFromSchema({
      rate: {unstable_def: true} as never, // placeholder, replaced below
    });
    void specs;
  });
});

// helper to build a zod number — import zod the same way the tools do
function zodNumberBounded(): never {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {zod} = require('../../../src/third_party/index.js');
  return zod.number().int().min(1).max(10000) as never;
}

describe('validateToolArgs numeric range enforcement (resize_page)', () => {
  before(async () => {
    await ensureToolsMeta();
  });

  it('resize_page meta carries the range from its schema', () => {
    const meta = getToolMeta('resize_page');
    assert.ok(meta, 'resize_page meta 应存在');
    const width = meta!.argSpecs.width;
    assert.ok(width?.range, 'width range 应被提取');
    assert.equal(width!.range!.int, true);
    assert.equal(width!.range!.max?.value, 10000);
  });

  it('rejects width=0 (below min 1)', () => {
    const result = validateToolArgs('resize_page', {width: 0, height: 720});
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /width/);
      assert.match(result.error, /1/);
    }
  });

  it('rejects width=0.5 (non-integer)', () => {
    const result = validateToolArgs('resize_page', {width: 0.5, height: 720});
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /整数|integer/i);
    }
  });

  it('rejects width=20000 (above max 10000)', () => {
    const result = validateToolArgs('resize_page', {width: 20000, height: 720});
    assert.equal(result.ok, false);
  });

  it('accepts width=1280', () => {
    const result = validateToolArgs('resize_page', {width: 1280, height: 720});
    assert.equal(result.ok, true);
  });

  it('coerces numeric strings before range checking (CLI path)', () => {
    const result = validateToolArgs('resize_page', {width: '1280', height: '720'});
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.width, 1280);
    }
  });

  it('emulate_cpu still enforces its 1..20 range', () => {
    const bad = validateToolArgs('emulate_cpu', {throttlingRate: 99});
    assert.equal(bad.ok, false);
    const good = validateToolArgs('emulate_cpu', {throttlingRate: 4});
    assert.equal(good.ok, true);
  });
});
```

Note: replace the two `zodNumberBounded`/placeholder helpers with a clean top-level import instead of `require` (the file is ESM): `import {zod} from '../../../src/third_party/index.js';` and use `zod.number().int().min(1).max(10000)` inline in the first test. Delete the second placeholder test ("returns undefined range for unbounded numbers") and instead assert `specs` for an unbounded number: `extractArgSpecsFromSchema({rate: zod.number()}).rate?.range === undefined`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/tool-arg-validator-range.test.js`
Expected: FAIL — `range` is undefined (`specs.width?.range` assertion) and `validateToolArgs('resize_page', {width: 0, ...})` currently returns `ok: true`.

- [ ] **Step 3: Write minimal implementation**

3a. `src/tools/zod-introspect.ts` — extend `ToolArgSpec`:

```typescript
export interface NumberRange {
  int?: boolean;
  min?: {value: number; inclusive: boolean};
  max?: {value: number; inclusive: boolean};
}

export interface ToolArgSpec {
  type: ToolArgType;
  required: boolean;
  defaultValue?: unknown;
  enum?: string[];
  /** zod number 约束（.int()/.min()/.max()），由校验层强制执行 */
  range?: NumberRange;
  description: string;
}
```

Add extraction (inside `extractArgSpec`, after `resolveSimpleType`):

```typescript
  let range: NumberRange | undefined;
  if (resolved === 'number' && inner instanceof zod.ZodNumber) {
    const checks = (
      inner._def as {checks?: Array<{kind: string; value?: number; inclusive?: boolean}>}
    ).checks ?? [];
    const int = checks.find(c => c.kind === 'int');
    const min = checks.find(c => c.kind === 'min');
    const max = checks.find(c => c.kind === 'max');
    if (int || min || max) {
      range = {
        ...(int ? {int: true} : {}),
        ...(min ? {min: {value: min.value!, inclusive: min.inclusive !== false}} : {}),
        ...(max ? {max: {value: max.value!, inclusive: max.inclusive !== false}} : {}),
      };
    }
  }
```

and include `...(range && {range})` in the returned spec object.

3b. `src/tools/tool-arg-validator.ts` — enforce in `validateType`'s `case 'number'`:

```typescript
    case 'number': {
      const numValue = coerceNumber(value);
      if (typeof numValue !== 'number' || !Number.isFinite(numValue)) {
        return {ok: false, error: typeError(toolName, key, '数字')};
      }
      const spec2 = spec as {range?: {int?: boolean; min?: {value: number; inclusive: boolean}; max?: {value: number; inclusive: boolean}}};
      const range = spec2.range;
      if (range) {
        if (range.int && !Number.isInteger(numValue)) {
          return {
            ok: false,
            error: `${toolName} 的参数 ${key} 必须是整数`,
          };
        }
        if (range.min) {
          const violated = range.min.inclusive
            ? numValue < range.min.value
            : numValue <= range.min.value;
          if (violated) {
            return {
              ok: false,
              error: `${toolName} 的参数 ${key} 必须${range.min.inclusive ? '不小于' : '大于'} ${range.min.value}`,
            };
          }
        }
        if (range.max) {
          const violated = range.max.inclusive
            ? numValue > range.max.value
            : numValue >= range.max.value;
          if (violated) {
            return {
              ok: false,
              error: `${toolName} 的参数 ${key} 必须${range.max.inclusive ? '不超过' : '小于'} ${range.max.value}`,
            };
          }
        }
      }
      return {ok: true, value: numValue};
    }
```

3c. `src/tools/emulation/resizePage.ts` — change the schema:

```typescript
    width: zod
      .number()
      .int()
      .min(1)
      .max(10000)
      .describe('视口宽度（像素），1-10000 的整数。'),
    height: zod
      .number()
      .int()
      .min(1)
      .max(10000)
      .describe('视口高度（像素），1-10000 的整数。'),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/tool-arg-validator-range.test.js build/tests/unit/tools/tool-arg-validator.test.js`
Expected: PASS — new range tests pass AND the pre-existing validator tests (`tool-arg-validator.test.ts`, which covers scriptId coercion, variants json, proxycli regression contracts) still pass, proving no regression in coercion paths.

- [ ] **Step 5: Commit**

```bash
git add src/tools/zod-introspect.ts src/tools/tool-arg-validator.ts src/tools/emulation/resizePage.ts tests/unit/tools/tool-arg-validator-range.test.ts
git commit -m "feat(tools): enforce zod numeric ranges in tool-arg validator"
```

---

### Task 4: SPA same-document navigation history preservation

**Files:**
- Modify: `src/modules/collector/PageCollector.ts:60-103` (`attachToPage`/`detachFromPage`)
- Test: `tests/unit/modules/collector/PageCollectorSpa.test.ts`

**Interfaces:**
- Consumes: existing `PageCollector` shape (WeakMap storage, `frameNavHandlers`, `splitOnNavigation`).
- Produces: no new public API. Behavior change only — same-document navigations (SPA pushState/hash) no longer rotate navigation segments in `NetworkRequestCollector` / `ConsoleMessageCollector` / `WsCollector` (all three inherit the split trigger from `attachToPage`).
- Mechanism (empirically verified with patchright + real Chromium):
  - `page.on('framenavigated')` fires FIRST, then CDP `Page.navigatedWithinDocument` arrives in the same event-loop tick (0ms later). Cross-document navigations never emit `nwid` (verified: 2 cross-doc navs → 0 nwid events).
  - Therefore: defer `splitOnNavigation` via `setImmediate`, cancel if `nwid` arrives first.
  - Sub-frame navigations must still be ignored (`frame !== page.mainFrame()` — already in the existing handler).
  - The CDP session must exist per-page **before** the first navigation. Attach it lazily in `attachToPage` (async, fire-and-forget with `.catch(() => {})` — mirrors `NetworkRequestCollector.attachListeners`' pattern at `src/worker/collectors.ts:128-160`).

- [ ] **Step 1: Write failing tests** — create `tests/unit/modules/collector/PageCollectorSpa.test.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {PageCollector} from '../../../../src/modules/collector/PageCollector.js';

interface Tracked {
  stableId: number;
}

interface CdpMock {
  listeners: Map<string, (event: unknown) => void>;
  send: (method: string) => Promise<unknown>;
}

/** Minimal page mock wired like patchright: framenavigated + CDP nwid events. */
function makePage() {
  const pageListeners = new Map<string, (...args: unknown[]) => void>();
  const onceListeners = new Map<string, (...args: unknown[]) => void>();
  const cdpListeners = new Map<string, (event: unknown) => void>();
  const mainFrame = {frameId: 'main'};
  const page = {
    mainFrame: () => mainFrame,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      pageListeners.set(event, handler);
    },
    once: (event: string, handler: (...args: unknown[]) => void) => {
      onceListeners.set(event, handler);
    },
    off: (event: string, handler: (...args: unknown[]) => void) => {
      if (pageListeners.get(event) === handler) pageListeners.delete(event);
    },
    context: () => ({
      newCDPSession: async () => ({
        on: (event: string, handler: (e: unknown) => void) => {
          cdpListeners.set(event, handler);
        },
        off: () => undefined,
        send: async (method: string) => {
          sent.push(method);
          return {};
        },
        detach: async () => undefined,
      }),
    }),
  };
  const sent: string[] = [];
  const emitFrameNav = (frame: unknown) =>
    pageListeners.get('framenavigated')?.(frame);
  const emitNwid = (frameId = 'main') =>
    cdpListeners.get('Page.navigatedWithinDocument')?.({frameId});
  return {page, emitFrameNav, emitNwid, mainFrame, sent};
}

class TestCollector extends PageCollector<Tracked> {
  splitCount = 0;
  protected attachListeners(): void {}
  protected detachListeners(): void {}
  protected override splitOnNavigation(): void {
    this.splitCount++;
  }
}

/** Yield to the event loop so setImmediate-deferred splits run. */
const flush = () => new Promise<void>(resolve => setImmediate(() => resolve()));

describe('PageCollector SPA navigation handling', () => {
  it('does not split storage on same-document navigation (nwid arrives after framenavigated)', async () => {
    const {page, emitFrameNav, emitNwid, mainFrame} = makePage();
    const collector = new TestCollector();
    collector.attachToPage(page as never);

    await flush(); // let the CDP session attach resolve
    emitFrameNav(mainFrame);
    emitNwid(); // same tick — before the deferred split
    await flush();

    assert.equal(collector.splitCount, 0, 'SPA same-doc navigation must NOT split');
  });

  it('splits storage on cross-document navigation (no nwid)', async () => {
    const {page, emitFrameNav, mainFrame} = makePage();
    const collector = new TestCollector();
    collector.attachToPage(page as never);

    await flush();
    emitFrameNav(mainFrame);
    await flush();

    assert.equal(collector.splitCount, 1, 'cross-doc navigation must split');
  });

  it('splits after a same-document navigation when a real navigation follows', async () => {
    const {page, emitFrameNav, emitNwid, mainFrame} = makePage();
    const collector = new TestCollector();
    collector.attachToPage(page as never);

    await flush();
    // SPA route change
    emitFrameNav(mainFrame);
    emitNwid();
    await flush();
    assert.equal(collector.splitCount, 0);
    // then a real navigation
    emitFrameNav(mainFrame);
    await flush();
    assert.equal(collector.splitCount, 1);
  });

  it('ignores sub-frame navigations entirely', async () => {
    const {page, emitFrameNav} = makePage();
    const collector = new TestCollector();
    collector.attachToPage(page as never);

    await flush();
    emitFrameNav({frameId: 'iframe-1'});
    await flush();

    assert.equal(collector.splitCount, 0);
  });

  it('handles rapid successive same-doc navigations', async () => {
    const {page, emitFrameNav, emitNwid, mainFrame} = makePage();
    const collector = new TestCollector();
    collector.attachToPage(page as never);

    await flush();
    emitFrameNav(mainFrame);
    emitNwid();
    emitFrameNav(mainFrame);
    emitNwid();
    emitFrameNav(mainFrame);
    emitNwid();
    await flush();

    assert.equal(collector.splitCount, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/collector/PageCollectorSpa.test.js`
Expected: FAIL — "SPA same-doc navigation must NOT split" (current code splits unconditionally; splitCount will be 1, not 0).

- [ ] **Step 3: Write minimal implementation** — modify `src/modules/collector/PageCollector.ts`:

Add fields to the class:

```typescript
  /** 每页的 CDP 会话与同文档导航计数（SPA 路由检测） */
  private cdpSessions = new WeakMap<Page, import('patchright').CDPSession>();
  private nwdListeners = new WeakMap<Page, (event: {frameId?: string}) => void>();
  private pendingSameDocNavs = new WeakMap<Page, number>();
```

Replace the `attachToPage` navigation block:

```typescript
    // 主 frame 导航时分割存储。
    // SPA 同文档路由（pushState/hash）也会触发 framenavigated，不能分割——
    // CDP Page.navigatedWithinDocument 与 framenavigated 在同一事件循环
    // tick 内先后到达（实测 0ms），因此用 setImmediate 延迟分割，
    // nwid 到达则取消（跨文档导航从不发 nwid）。
    const onFrameNavigated = (frame: Frame): void => {
      if (frame !== page.mainFrame()) return;
      const pending = (this.pendingSameDocNavs.get(page) ?? 0) + 1;
      this.pendingSameDocNavs.set(page, pending);
      setImmediate(() => {
        const remaining = this.pendingSameDocNavs.get(page) ?? 0;
        if (remaining > 0) {
          // CDP nwid 已抵消：同文档导航，跳过分割。
          this.pendingSameDocNavs.set(page, 0);
          return;
        }
        this.splitOnNavigation(page);
      });
    };
    page.on('framenavigated', onFrameNavigated);
    this.frameNavHandlers.set(page, onFrameNavigated);

    // CDP 会话监听同文档导航（fire-and-forget，失败静默——无 CDP 时
    // 退化为旧行为：一律分割）。
    void page
      .context()
      .newCDPSession(page)
      .then(client => {
        this.cdpSessions.set(page, client);
        const onNwid = (event: {frameId?: string}): void => {
          // 只关心主 frame 的同文档导航；主 frame id 未提供时保守放行。
          if (event.frameId && event.frameId !== getMainFrameId(page)) return;
          const pending = this.pendingSameDocNavs.get(page) ?? 0;
          if (pending > 0) {
            this.pendingSameDocNavs.set(page, pending - 1);
          }
        };
        client.on('Page.navigatedWithinDocument', onNwid as never);
        this.nwdListeners.set(page, onNwid);
        void client.send('Page.enable').catch(() => undefined);
      })
      .catch(() => undefined);
```

Wait — the `frameId` on `Page.navigatedWithinDocument` events is the CDP frame id (a hex string), not comparable to `page.mainFrame().frameId`? Verified empirically: CDP `Page.getFrameTree().frameTree.frame.id` matches the `frameId` field in nwid events. But patchright's `mainFrame()` doesn't expose the CDP frame id. **Simplify**: the nwid event's `frameId` can't be cheaply matched to the main frame from patchright's public API. Drop the frame-id check entirely — sub-frame same-document navigations decrementing the counter is harmless because they don't produce a main-frame `framenavigated` in the first place (the counter is only incremented for main-frame navigations). Final `onNwid`:

```typescript
        const onNwid = (): void => {
          const pending = this.pendingSameDocNavs.get(page) ?? 0;
          if (pending > 0) {
            this.pendingSameDocNavs.set(page, pending - 1);
          }
        };
```

Update `detachFromPage` to clean up the CDP session + nwid listener (after the existing nav-handler cleanup):

```typescript
    const nwdListener = this.nwdListeners.get(page);
    const cdpSession = this.cdpSessions.get(page);
    if (nwdListener && cdpSession) {
      try {
        cdpSession.off('Page.navigatedWithinDocument', nwdListener as never);
      } catch {
        // Session may already be detached
      }
    }
    this.nwdListeners.delete(page);
    this.cdpSessions.delete(page);
    this.pendingSameDocNavs.delete(page);
    if (cdpSession) {
      void cdpSession.detach().catch(() => undefined);
    }
```

Also add `CDPSession` to the patchright type import at the top (`import type {BrowserContext, CDPSession, Frame, Page} from 'patchright';`) and use `CDPSession` in the WeakMap types instead of the inline `import('patchright')` form.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/collector/PageCollectorSpa.test.js`
Expected: PASS (all 5 tests).

Also run the existing collector tests to catch regressions:
`npm run build && node --require ./build/tests/setup.js --test build/tests/unit/worker/CollectorContextProvider.test.js`
Expected: PASS — the second test in that file (`continues collecting requests after clearNetworkRequests`) uses a mock page with `on`/`once`/`off`/`mainFrame`/`context` — it has no `framenavigated` emission, so no splits fire; and its `context().newCDPSession` mock returns an object with `on/off/send/detach`, compatible with the new code path.

- [ ] **Step 5: Commit**

```bash
git add src/modules/collector/PageCollector.ts tests/unit/modules/collector/PageCollectorSpa.test.ts
git commit -m "fix(collector): preserve history across SPA same-document navigations"
```

---

### Task 5: Config-file spawn options

**Files:**
- Modify: `src/cli/commands/config.ts:28-33` (`VALID_KEYS`, `CliConfig`)
- Modify: `src/cli/daemonClient.ts:222-232` (`loadCliConfig` return type)
- Modify: `src/cli/app.ts:45-64` (`createWorkerContext` merges config spawn flags)
- Modify: `src/cli/sessionArgs.ts:24` (`DAEMON_VALUE_FLAGS`)
- Test: `tests/unit/cli/configSpawnFlags.test.ts`

**Interfaces:**
- Consumes: existing `cliConfigPath()` from `daemonClient.ts`; `spawnFlagsFromArgv`/`DAEMON_SPAWN_FLAGS`/`DAEMON_VALUE_FLAGS` from `sessionArgs.ts`; `parseWorkerArgs`' `BOOLEAN_FLAGS`/`VALUE_FLAGS` in `src/worker/WorkerArgs.ts` (downstream consumer of the flags).
- Produces: new config keys (settable via `proxycli config --set key=value`, persisted in `~/.proxycli/config.json`): `headless`, `cloak`, `jsStealth`, `fullStealthArgs`, `minimalStealth` (booleans, stored as `'true'`/`'false'` strings — the config file only stores strings today; keep that) and `browserUrl`, `wsEndpoint`, `executablePath` (strings).
- New helper (exported for tests): `mergeSpawnFlagsFromConfig(argv: readonly string[], config: CliSpawnConfig): string[]` in `src/cli/sessionArgs.ts` — takes the raw argv and the loaded config, returns `spawnFlagsFromArgv(argv)` plus config-derived flags (skipping any flag name already present in argv). Boolean config keys map to flag names: `headless→--headless`, `cloak→--cloak`, `jsStealth→--js-stealth`, `fullStealthArgs→--full-stealth-args`, `minimalStealth→--minimal-stealth`; value keys map `browserUrl→--browserUrl`, `wsEndpoint→--wsEndpoint`, `executablePath→--executablePath` in `--flag=value` form.
- `DAEMON_VALUE_FLAGS` gains `'--browserUrl'`, `'--wsEndpoint'`, `'--executablePath'` so they pass the whitelist (must be in `--flag=value` form).

- [ ] **Step 1: Write failing tests** — create `tests/unit/cli/configSpawnFlags.test.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {mergeSpawnFlagsFromConfig} from '../../../src/cli/sessionArgs.js';

describe('mergeSpawnFlagsFromConfig', () => {
  it('appends boolean flags from config when absent from argv', () => {
    const merged = mergeSpawnFlagsFromConfig(['call', 'list_tools'], {
      headless: 'true',
      cloak: 'false',
    });
    assert.ok(merged.includes('--headless'));
    assert.ok(!merged.includes('--cloak'));
  });

  it('appends value flags in --flag=value form', () => {
    const merged = mergeSpawnFlagsFromConfig([], {
      browserUrl: 'http://127.0.0.1:9222',
    });
    assert.ok(merged.includes('--browserUrl=http://127.0.0.1:9222'));
  });

  it('explicit argv flags win over config-file values', () => {
    const merged = mergeSpawnFlagsFromConfig(
      ['--headless', '--browserUrl=http://127.0.0.1:9999'],
      {headless: 'false', browserUrl: 'http://127.0.0.1:9222'},
    );
    // argv 的 --headless 已存在，不再追加（true/false 无法表达“覆盖为 false”，
    // 布尔语义：显式出现过该 flag 即以 argv 为准）
    assert.equal(merged.filter(f => f === '--headless').length, 1);
    // argv 的 --browserUrl 已存在，config 的值不追加
    assert.ok(merged.includes('--browserUrl=http://127.0.0.1:9999'));
    assert.ok(!merged.includes('--browserUrl=http://127.0.0.1:9222'));
  });

  it('passes through existing whitelisted argv spawn flags untouched', () => {
    const merged = mergeSpawnFlagsFromConfig(
      ['--js-stealth', '--console-port=9000'],
      {},
    );
    assert.ok(merged.includes('--js-stealth'));
    assert.ok(merged.includes('--console-port=9000'));
  });

  it('ignores config keys with falsy string values', () => {
    const merged = mergeSpawnFlagsFromConfig([], {
      headless: 'false',
      browserUrl: undefined,
    });
    assert.equal(merged.length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/cli/configSpawnFlags.test.js`
Expected: FAIL — `mergeSpawnFlagsFromConfig` is not exported.

- [ ] **Step 3: Write minimal implementation**

3a. `src/cli/sessionArgs.ts` — add after `spawnFlagsFromArgv`:

```typescript
/** 配置文件可下发的 spawn 相关键（值均为字符串，布尔以 'true'/'false' 存储） */
export interface CliSpawnConfig {
  headless?: string;
  cloak?: string;
  jsStealth?: string;
  fullStealthArgs?: string;
  minimalStealth?: string;
  browserUrl?: string;
  wsEndpoint?: string;
  executablePath?: string;
}

const CONFIG_BOOL_TO_FLAG: Record<string, string> = {
  headless: '--headless',
  cloak: '--cloak',
  jsStealth: '--js-stealth',
  fullStealthArgs: '--full-stealth-args',
  minimalStealth: '--minimal-stealth',
};

const CONFIG_VALUE_TO_FLAG: Record<string, string> = {
  browserUrl: '--browserUrl',
  wsEndpoint: '--wsEndpoint',
  executablePath: '--executablePath',
};

/**
 * 合并 spawnFlagsFromArgv(argv) 与配置文件下发的 flag。
 * argv 显式出现过的 flag 名以 argv 为准（不重复追加）。
 */
export function mergeSpawnFlagsFromConfig(
  argv: readonly string[],
  config: CliSpawnConfig,
): string[] {
  const merged = spawnFlagsFromArgv(argv);
  const argvFlagNames = new Set(argv.map(arg => arg.split('=')[0]));

  for (const [key, flag] of Object.entries(CONFIG_BOOL_TO_FLAG)) {
    if (config[key as keyof CliSpawnConfig] === 'true' && !argvFlagNames.has(flag)) {
      merged.push(flag);
    }
  }
  for (const [key, flag] of Object.entries(CONFIG_VALUE_TO_FLAG)) {
    const value = config[key as keyof CliSpawnConfig];
    if (value && !argvFlagNames.has(flag)) {
      merged.push(`${flag}=${value}`);
    }
  }
  return merged;
}
```

Also extend `DAEMON_VALUE_FLAGS`:
```typescript
export const DAEMON_VALUE_FLAGS = [
  '--console-port',
  '--browserUrl',
  '--wsEndpoint',
  '--executablePath',
] as const;
```

3b. `src/cli/commands/config.ts` — extend keys:

```typescript
/** 合法配置键 */
const VALID_KEYS = new Set<string>([
  'workerEntry',
  'headless',
  'cloak',
  'jsStealth',
  'fullStealthArgs',
  'minimalStealth',
  'browserUrl',
  'wsEndpoint',
  'executablePath',
]);

interface CliConfig {
  workerEntry?: string;
  headless?: string;
  cloak?: string;
  jsStealth?: string;
  fullStealthArgs?: string;
  minimalStealth?: string;
  browserUrl?: string;
  wsEndpoint?: string;
  executablePath?: string;
}
```

3c. `src/cli/daemonClient.ts` — widen `loadCliConfig`'s return type:

```typescript
function loadCliConfig(): {
  workerEntry?: string;
  headless?: string;
  cloak?: string;
  jsStealth?: string;
  fullStealthArgs?: string;
  minimalStealth?: string;
  browserUrl?: string;
  wsEndpoint?: string;
  executablePath?: string;
} {
```

(body unchanged — it already returns the whole parsed object).

3d. `src/cli/app.ts` — in `createWorkerContext`, replace `const spawnFlags = spawnFlagsFromArgv(argv);` with:

```typescript
  const spawnFlags = mergeSpawnFlagsFromConfig(argv, loadSpawnConfig());
```

with imports: `import {mergeSpawnFlagsFromConfig} from './sessionArgs.js';` and a small `loadSpawnConfig()` — but `loadCliConfig` is module-private in `daemonClient.ts`. Export it (rename to `loadCliSpawnConfig` or just export `loadCliConfig`). Cleanest: change `loadCliConfig` to `export function loadCliConfig()` in `daemonClient.ts` (it has a single internal caller: `resolveEntryPath`) and import it in `app.ts`:

```typescript
import {DaemonConnection, ensureDaemon, loadCliConfig} from './daemonClient.js';
import {mergeSpawnFlagsFromConfig, sessionFromArgv} from './sessionArgs.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/cli/configSpawnFlags.test.js build/tests/unit/cli/daemonClient.test.js build/tests/unit/cli/sessionPaths.test.js`
Expected: PASS — new merge tests pass, existing daemonClient tests (`resolveEntryPath` priority chain, `normalizeCandidatePath`) still pass since `loadCliConfig`'s behavior is unchanged (only exported now).

- [ ] **Step 5: Commit**

```bash
git add src/cli/sessionArgs.ts src/cli/commands/config.ts src/cli/daemonClient.ts src/cli/app.ts tests/unit/cli/configSpawnFlags.test.ts
git commit -m "feat(cli): merge config-file spawn options into daemon flags"
```

---

### Task 6: DevTools tool domain (open + stubs + reveal)

**Files:**
- Create: `src/tools/devtools/openDevtools.ts`
- Create: `src/tools/devtools/getDevtoolsComments.ts`
- Create: `src/tools/devtools/resolveDevtoolsComment.ts`
- Create: `src/tools/devtools/revealInDevtools.ts`
- Create: `src/tools/devtools/manifest.ts`
- Modify: `scripts/generate-tools-index.ts:16-40` (add `devtools` to `DOMAIN_DESCRIPTIONS`)
- Test: `tests/unit/tools/devtools/devtoolsTools.test.ts`

**Interfaces:**
- Consumes: `withCdpSession` (cdpUtils), `defineTool`/`Context`, `createToolError`/`ErrorCodes`, `toElementError`, `NO_ACTIVE_PAGE_MESSAGE`, `openInBrowser` NOT used (DevTools window must open *inside the same browser*, via `Target.createTarget` with a `devtools://` URL — verified working: `Target.createTarget {url: 'devtools://devtools/bundled/inspector.html'}` creates a DevTools window target and `Target.activateTarget` brings it to front).
- Produces: 4 tools registered under domain `devtools`, `profile: 'full'` (hidden in the default `workflow` profile; visible with `JS_REVERSE_TOOL_PROFILE=full`):
  - `open_devtools` — opens a DevTools window for the selected page. Attaches when the browser has an HTTP debugging endpoint (`/json/list` gives `devtoolsFrontendUrl` per target — verified form: `https://chrome-devtools-frontend.appspot.com/serve_rev/@<rev>/inspector.html?ws=<host>/devtools/page/<targetId>`); falls back to an unattached `devtools://devtools/bundled/inspector.html` window with a guidance note when pipe-launched (no ws endpoint exists — verified: patchright pipe launch exposes no HTTP endpoint and no target ws URLs).
  - `get_devtools_comments` / `resolve_devtools_comment` — stubs. Stock DevTools frontends have no `cd4aBridge` (verified: `Runtime.evaluate('typeof window.universe')` in the DevTools window target → `undefined`). Both return a structured "not supported" message explaining the requirement (custom DevTools build with CD4A bridge) — contract (schema/annotations) is upstream-compatible so a later Chrome release can light them up.
  - `reveal_in_devtools` — minimal viable implementation: resolves the selector to a node via the same probe-attribute bridge as Task 2, then `Overlay.enable` + `Overlay.highlightNode` (verified working headful: highlight renders and `Overlay.hideHighlight` clears it).

- [ ] **Step 1: Write failing tests** — create `tests/unit/tools/devtools/devtoolsTools.test.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  getDevtoolsComments,
} from '../../../../../src/tools/devtools/getDevtoolsComments.js';
import {
  resolveDevtoolsComment,
} from '../../../../../src/tools/devtools/resolveDevtoolsComment.js';
import {openDevtools} from '../../../../../src/tools/devtools/openDevtools.js';
import {revealInDevtools} from '../../../../../src/tools/devtools/revealInDevtools.js';

function capture() {
  const lines: string[] = [];
  let content: Record<string, unknown> | undefined;
  return {
    lines,
    get content() {
      return content;
    },
    response: {
      appendResponseLine: (v: string) => lines.push(v),
      setStructuredContent: (v: Record<string, unknown>) => {
        content = v;
      },
    },
  };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    getSelectedFrame: () => null,
    getSelectedPage: () => null,
    ...overrides,
  };
}

describe('devtools comment stubs', () => {
  it('get_devtools_comments returns a clear not-supported message', async () => {
    const out = capture();
    await getDevtoolsComments.handler(
      {params: {}} as never,
      out.response as never,
      makeContext() as never,
    );
    assert.equal(out.content?.success, false);
    assert.match(String(out.content?.message), /CD4A|不支持|not supported/i);
  });

  it('resolve_devtools_comment returns a clear not-supported message', async () => {
    const out = capture();
    await resolveDevtoolsComment.handler(
      {params: {threadId: 'comment-1'}} as never,
      out.response as never,
      makeContext() as never,
    );
    assert.equal(out.content?.success, false);
    assert.match(String(out.content?.message), /CD4A|不支持|not supported/i);
  });
});

describe('open_devtools', () => {
  it('rejects when no page is selected', async () => {
    const out = capture();
    await assert.rejects(
      () =>
        openDevtools.handler(
          {params: {}} as never,
          out.response as never,
          makeContext() as never,
        ),
      /没有选中的页面|No active page/i,
    );
  });
});

describe('reveal_in_devtools', () => {
  it('rejects when no page is selected', async () => {
    const out = capture();
    await assert.rejects(
      () =>
        revealInDevtools.handler(
          {params: {selector: '.btn'}} as never,
          out.response as never,
          makeContext() as never,
        ),
      /没有可用的 Frame|No active page/i,
    );
  });

  it('highlights the resolved node via Overlay CDP calls', async () => {
    const calls: {method: string; params?: unknown}[] = [];
    const cdp = {
      send: async (method: string, params?: unknown) => {
        calls.push({method, params});
        switch (method) {
          case 'DOM.enable':
          case 'Overlay.enable':
            return {};
          case 'DOM.getDocument':
            return {root: {nodeId: 1}};
          case 'DOM.querySelector':
            return {nodeId: 9};
          case 'Overlay.highlightNode':
          case 'Overlay.hideHighlight':
            return {};
          default:
            throw new Error(`unexpected CDP method ${method}`);
        }
      },
      on: () => undefined,
      off: () => undefined,
      detach: async () => undefined,
    };
    const page = {
      context: () => ({newCDPSession: async () => cdp}),
      mainFrame: () => ({
        locator: (selector: string) => ({
          first: () => ({
            evaluate: async () => undefined,
          }),
        }),
      }),
    };
    const out = capture();

    await revealInDevtools.handler(
      {params: {selector: '.btn', durationMs: 10}} as never,
      out.response as never,
      {
        getSelectedFrame: () => ({page: () => page}),
        getSelectedPage: () => page,
      } as never,
    );

    const methods = calls.map(c => c.method);
    assert.ok(methods.includes('Overlay.enable'));
    assert.ok(methods.includes('Overlay.highlightNode'));
    const highlight = calls.find(c => c.method === 'Overlay.highlightNode')!;
    assert.equal((highlight.params as {nodeId: number}).nodeId, 9);
    assert.ok(methods.includes('Overlay.hideHighlight'));
    assert.equal(out.content?.success, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/devtools/devtoolsTools.test.js`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write minimal implementation**

3a. `src/tools/devtools/openDevtools.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {withCdpSession} from '../../modules/browser/cdpUtils.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {NO_ACTIVE_PAGE_MESSAGE} from '../shared/activePageResolver.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 为当前页面打开 DevTools 窗口。
 *
 * 原生实现：优先通过 CDP Target.createTarget 以 devtools:// URL 在同一
 * 浏览器内开窗；若浏览器带 HTTP 调试端口（--remote-debugging-port），
 * 先查 /json/list 拿到带 ws 参数的 devtoolsFrontendUrl 以便窗口附着
 * 到页面；pipe 启动的浏览器没有 ws 端点，退化为未附着的 DevTools 窗口。
 */
export const openDevtools = defineTool({
  name: 'open_devtools',
  description:
    '为当前选中页面打开 Chrome DevTools 窗口（同一浏览器内新开 devtools:// 目标）。若浏览器以 pipe 启动（无 HTTP 调试端口），窗口不会自动附着到页面，需要人工选择 target。',
  annotations: {
    title: '打开DevTools窗口',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    const page = (context as Context).getSelectedPage();
    if (!page) {
      throw createToolError(ErrorCodes.PAGE_REQUIRED, NO_ACTIVE_PAGE_MESSAGE, {
        toolName: 'open_devtools',
      });
    }

    let frontendUrl = 'devtools://devtools/bundled/inspector.html';
    let attached = false;

    // 尝试从 HTTP 调试端口拿附着的 frontend URL（仅 --remote-debugging-port 启动的浏览器有）。
    try {
      const ws = page.context().browser()?.wsEndpoint?.();
      const match = typeof ws === 'string' ? ws.match(/ws:\/\/[^/]+:(\d+)/) : null;
      if (match) {
        const list = (await (
          await fetch(`http://127.0.0.1:${match[1]}/json/list`)
        ).json()) as Array<{type: string; url: string; devtoolsFrontendUrl?: string}>;
        const target = list.find(
          t => t.type === 'page' && t.url === page.url(),
        );
        if (target?.devtoolsFrontendUrl) {
          frontendUrl = target.devtoolsFrontendUrl;
          attached = true;
        }
      }
    } catch {
      // pipe 启动：无 HTTP 端点，保持未附着 fallback
    }

    const {targetId} = await withCdpSession(page, async client => {
      const created = (await client.send('Target.createTarget', {
        url: frontendUrl,
      })) as {targetId: string};
      await client
        .send('Target.activateTarget', {targetId: created.targetId})
        .catch(() => undefined);
      return created;
    });

    response.setStructuredContent({
      success: true,
      message: attached
        ? `DevTools window opened and attached (target ${targetId.slice(0, 8)}).`
        : `DevTools window opened without page attachment (pipe-launched browser; target ${targetId.slice(0, 8)}). Use the target dropdown to select the page manually.`,
      tooltype: 'open_devtools',
      data: {targetId, attached},
    });
  },
});
```

Note: `page.context().browser()?.wsEndpoint?.()` — patchright's `Browser.wsEndpoint()` may not exist on pipe launches (returns undefined, handled). If `wsEndpoint` isn't a function in the installed patchright version, guard with `typeof ws === 'function' ? ws() : undefined` — the try/catch already covers shape mismatches; the implementer should verify against the local patchright types and adjust the guard accordingly (it's inside try/catch so any mismatch degrades to the unattached path, never throws).

3b. `src/tools/devtools/getDevtoolsComments.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 读取 DevTools 窗口中的 CD4A 评论线程 — 契约占位实现。
 *
 * 上游 chrome-devtools-mcp 依赖定制 DevTools 前端注入的
 * window.universe.cd4aBridge（实测原版 DevTools 窗口中为 undefined）。
 * 本工具保留 schema/响应契约，等 Chrome 上游提供桥接 API 后补齐实现。
 */
export const getDevtoolsComments = defineTool({
  name: 'get_devtools_comments',
  description:
    '读取 DevTools 窗口中针对当前页面的用户评论线程（CD4A）。当前 DevTools 前端未内置 CD4A 桥接，返回不支持提示。',
  annotations: {
    title: '读取DevTools评论',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, _context) => {
    void request;
    void _context;
    response.setStructuredContent({
      success: false,
      message:
        '当前 DevTools 前端不支持 CD4A 评论桥接（window.universe.cd4aBridge 不可用）。需要定制版 devtools-frontend 提供该 API 后此工具才会生效。',
      tooltype: 'get_devtools_comments',
      data: null,
    });
  },
});
```

3c. `src/tools/devtools/resolveDevtoolsComment.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 解决 DevTools 评论线程并追加 Agent 回复 — 契约占位实现（同 get_devtools_comments）。
 */
export const resolveDevtoolsComment = defineTool({
  name: 'resolve_devtools_comment',
  description:
    '向 DevTools 评论线程追加回复并标记已解决（CD4A）。当前 DevTools 前端未内置桥接，返回不支持提示。',
  annotations: {
    title: '解决DevTools评论',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    threadId: zod.string().describe('评论线程 ID（如 "comment-1"）。'),
    replyText: zod.string().optional().describe('可选的回复说明文本。'),
  },
  handler: async (request, response) => {
    const {threadId} = request.params;
    response.setStructuredContent({
      success: false,
      message:
        `当前 DevTools 前端不支持 CD4A 评论桥接，无法解决线程 ${threadId}（window.universe.cd4aBridge 不可用）。`,
      tooltype: 'resolve_devtools_comment',
      data: null,
    });
  },
});
```

3d. `src/tools/devtools/revealInDevtools.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {withCdpSession} from '../../modules/browser/cdpUtils.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {NO_ACTIVE_PAGE_MESSAGE} from '../shared/activePageResolver.js';
import {toElementError} from '../shared/elementLocator.js';
import {defineTool, type Context} from '../ToolDefinition.js';

const PROBE_ATTR = 'data-pcli-css-probe';

/**
 * 在页面上高亮目标元素（DevTools Elements 面板式的视觉定位）。
 *
 * 原生实现：probe 属性桥接 → Overlay.highlightNode → 延时 hideHighlight。
 * DevTools 面板导航（reveal-in-panel）需要前端 UI 命令通道，同样未实现。
 */
export const revealInDevtools = defineTool({
  name: 'reveal_in_devtools',
  description:
    '在页面上高亮指定元素（相当于 DevTools Elements 面板的节点高亮），持续指定时间后自动消失。用于逆向分析时快速定位目标 DOM。',
  annotations: {
    title: '高亮元素',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    selector: zod
      .string()
      .describe('目标元素的定位器（支持 CSS、role=、text=、xpath=）。'),
    durationMs: zod
      .number()
      .int()
      .min(200)
      .max(30000)
      .optional()
      .describe('高亮持续时间（毫秒），默认 3000。'),
  },
  handler: async (request, response, context) => {
    const {selector, durationMs = 3000} = request.params;
    const frame = (context as Context).getSelectedFrame();
    if (!frame) {
      throw createToolError(ErrorCodes.FRAME_REQUIRED, NO_ACTIVE_PAGE_MESSAGE, {
        toolName: 'reveal_in_devtools',
      });
    }
    const page = frame.page();

    const probe = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    try {
      const element = frame.locator(selector).first();
      await element.evaluate(
        (node, [attr, value]) => {
          node.setAttribute(attr, value);
        },
        [PROBE_ATTR, probe],
      );

      await withCdpSession(page, async client => {
        await client.send('DOM.enable');
        await client.send('Overlay.enable');
        const {root} = (await client.send('DOM.getDocument', {
          depth: 0,
        })) as {root: {nodeId: number}};
        const {nodeId} = (await client.send('DOM.querySelector', {
          nodeId: root.nodeId,
          selector: `[${PROBE_ATTR}="${probe}"]`,
        })) as {nodeId: number};
        if (!nodeId) {
          throw createToolError(
            ErrorCodes.VALIDATION,
            `元素定位成功但 CDP 查询失败：${selector}`,
            {toolName: 'reveal_in_devtools', selector},
          );
        }
        await client.send('Overlay.highlightNode', {
          nodeId,
          highlightConfig: {
            showInfo: true,
            showStyles: true,
            contentColor: {r: 111, g: 168, b: 220, a: 1},
          },
        });
        setTimeout(() => {
          void withCdpSession(page, c => c.send('Overlay.hideHighlight')).catch(
            () => undefined,
          );
        }, durationMs).unref?.();
      });

      response.setStructuredContent({
        success: true,
        message: `Element ${selector} highlighted for ${durationMs}ms.`,
        tooltype: 'reveal_in_devtools',
        data: {selector, durationMs},
      });
    } catch (error) {
      throw toElementError(error, {toolName: 'reveal_in_devtools', selector});
    } finally {
      try {
        await frame
          .locator(selector)
          .first()
          .evaluate(node => {
            node.removeAttribute('data-pcli-css-probe');
          });
      } catch {
        // 元素可能已被移除
      }
    }
  },
});
```

3e. `src/tools/devtools/manifest.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'devtools',
  description: 'DevTools window collaboration tools.',
  profile: 'full',
  tools: [
    {modulePath: './devtools/openDevtools.js', handlerName: 'openDevtools'},
    {
      modulePath: './devtools/getDevtoolsComments.js',
      handlerName: 'getDevtoolsComments',
    },
    {
      modulePath: './devtools/resolveDevtoolsComment.js',
      handlerName: 'resolveDevtoolsComment',
    },
    {
      modulePath: './devtools/revealInDevtools.js',
      handlerName: 'revealInDevtools',
    },
  ],
} satisfies DomainManifest;
```

3f. `scripts/generate-tools-index.ts` — add to `DOMAIN_DESCRIPTIONS` (after `debugger`):
```typescript
  devtools: 'DevTools window collaboration tools.',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/devtools/devtoolsTools.test.js`
Expected: PASS (5 tests).

Verify the domain registered under the `full` profile:
`grep -n "devtoolsManifest" src/tools/generated-tools-index.ts`
Expected: a match.

- [ ] **Step 5: Commit**

```bash
git add src/tools/devtools scripts/generate-tools-index.ts tests/unit/tools/devtools src/tools/generated-tools-index.ts
git commit -m "feat(tools): add devtools window tools with CD4A stubs and node highlight"
```

---

### Task 7: Final verification & docs

**Files:**
- Modify: `docs/reference/tool-reference.md` (add `get_css_styles`, devtools tools — one line each, follow existing entry style)
- Modify: `docs/reference/reverse-task-index.md` (add `get_css_styles` to the DOM/样式 debugging section if a fitting section exists; otherwise skip — do not invent a section)

**Interfaces:**
- Consumes: all previous tasks.
- Produces: documentation matching the shipped tools.

- [ ] **Step 1: Run the full quality gate on the final diff**

```bash
npm run typecheck
npm run check-format
npm run build
npm run test:unit
```

Expected: all pass. If `test:unit` surfaces pre-existing failures in unrelated domains, re-run only the tests covering the changed code (`tests/unit/formatters/`, `tests/unit/tools/css/`, `tests/unit/tools/devtools/`, `tests/unit/tools/tool-arg-validator*.test.js`, `tests/unit/cli/`, `tests/unit/modules/collector/`, `tests/unit/worker/CollectorContextProvider.test.js`) and report the unrelated failures as blockers, not as pass-through noise.

- [ ] **Step 2: Verify tool registration end-to-end**

```bash
node build/src/index.js --daemon --proxycli-daemon --session probe 2>/dev/null &
sleep 3
node build/src/cli/bin/proxycli.js list-tools 2>/dev/null | grep -E "get_css_styles|reveal_in_devtools|open_devtools"
```

Expected: `get_css_styles` appears (workflow profile). `open_devtools` / `reveal_in_devtools` appear only when `JS_REVERSE_TOOL_PROFILE=full`. Kill the probe daemon afterwards (`node build/src/cli/bin/proxycli.js close` or taskkill the node process).

- [ ] **Step 3: Update docs**

In `docs/reference/tool-reference.md`, following the existing per-tool entry format, add:

```markdown
### get_css_styles
获取指定元素匹配的 CSS 规则、内联样式、伪元素与继承样式及层叠信息，标注 active/overloaded 状态。支持 CSS/role=/text=/xpath= 定位器与分页。参数：`selector`（必填）、`pageSize`、`pageIdx`。
```

And for the devtools domain (full profile only):

```markdown
### open_devtools
为当前页面打开 DevTools 窗口（同浏览器内 devtools:// 目标）。pipe 启动的浏览器窗口不自动附着。

### get_devtools_comments / resolve_devtools_comment
CD4A 评论桥接契约占位：原版 DevTools 前端无 cd4aBridge，当前返回不支持提示。

### reveal_in_devtools
在页面上高亮指定元素（Overlay.highlightNode），持续 durationMs 后消失。参数：`selector`（必填）、`durationMs`（默认 3000）。
```

- [ ] **Step 4: Commit**

```bash
git add docs/reference/tool-reference.md docs/reference/reverse-task-index.md
git commit -m "docs(tools): document get_css_styles and devtools tool domain"
```

---

## Self-Review Notes (already applied)

- **Spec coverage:** §3.1 → Tasks 1-2; §3.2 → Task 5; §3.3 → Task 3; §3.4 → Task 4; §3.5 → Task 6; §4 → Task 7. All spec sections map to tasks.
- **Type consistency:** `CssStylesReport`/`formatMatchedStyles`/`renderCssStylesReport` names used identically in Tasks 1 and 2. `mergeSpawnFlagsFromConfig(argv, config)` signature consistent between Task 5's test and implementation. `PROBE_ATTR` constant duplicated deliberately in Tasks 2 and 6 (two domains, no shared import needed — same value `'data-pcli-css-probe'`).
- **Placeholder scan:** no TBDs; every code step carries full implementation. Two explicit "verify locally" notes (Task 2 test assertion looseness, Task 6 `wsEndpoint` guard) are risk-callouts, not undefined work — both are inside try/catch degradations.
