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
} from '../../../src/formatters/cssFormatter.js';

// Raw shapes mirror CDP CSS.getMatchedStylesForNode (see probe notes in the plan).
const prop = (
  name: string,
  value: string,
  extra: Record<string, unknown> = {},
) => ({
  name,
  value,
  text: `${name}: ${value};`,
  important: false,
  disabled: false,
  ...extra,
});

const rule = (
  selector: string,
  props: Array<ReturnType<typeof prop>>,
  origin = 'regular',
) => ({
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
        rule('.btn.primary', [
          prop('color', 'blue'),
          prop('cursor', 'pointer'),
        ]),
      ],
    };
    const report = formatMatchedStyles(raw, {elementSelector: '.btn'});
    const matched = report.rules.filter(r => r.type === 'matched');
    // last rule declares color → active; first rule's color → overloaded
    const primary = matched.find(r => r.selector === '.btn.primary')!;
    assert.ok(
      primary.properties.find(p => p.name === 'color')!.status === 'active',
    );
    const base = matched.find(r => r.selector === '.btn')!;
    assert.ok(
      base.properties.find(p => p.name === 'color')!.status === 'overloaded',
    );
    // cursor only declared once → active
    assert.ok(
      primary.properties.find(p => p.name === 'cursor')!.status === 'active',
    );
  });

  it('active/overloaded accounts for inline style having top priority', () => {
    const raw = {
      inlineStyle: {
        cssProperties: [prop('color', 'green', {important: false})],
      },
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
          {
            name: 'padding-top',
            value: '1px',
            text: null,
            important: false,
            disabled: false,
          },
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
        {
          pseudoType: 'before',
          matches: [rule('.a::before', [prop('content', 'x')])],
        },
      ],
      inherited: [
        {matchedCSSRules: [rule('body', [prop('font-size', '20px')])]},
      ],
    };
    const report = formatMatchedStyles(raw, {elementSelector: '.a'});
    assert.ok(
      report.rules.some(
        r => r.type === 'pseudo' && r.selector === '.a::before',
      ),
    );
    assert.ok(
      report.rules.some(r => r.type === 'inherited' && r.selector === 'body'),
    );
  });

  it('paginates rules when pageSize is given', () => {
    const raw = {
      matchedCSSRules: [
        rule('.a', [prop('color', 'red')]),
        rule('.b', [prop('color', 'blue')]),
        rule('.c', [prop('color', 'green')]),
      ],
    };
    const p0 = formatMatchedStyles(raw, {
      elementSelector: '.x',
      pageSize: 2,
      pageIdx: 0,
    });
    const p1 = formatMatchedStyles(raw, {
      elementSelector: '.x',
      pageSize: 2,
      pageIdx: 1,
    });
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
