/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {checkScriptSyntaxBalance} from '../../../src/tools/script/validate-script-syntax.js';

describe('checkScriptSyntaxBalance', () => {
  it('passes balanced arrow function', () => {
    assert.strictEqual(checkScriptSyntaxBalance('() => 1 + 1'), null);
  });

  it('passes balanced function expression', () => {
    assert.strictEqual(
      checkScriptSyntaxBalance('function () { return document.cookie; }'),
      null,
    );
  });

  it('passes async arrow with promise chain', () => {
    assert.strictEqual(
      checkScriptSyntaxBalance(
        'async () => await fetch("/api").then(r => r.json())',
      ),
      null,
    );
  });

  it('flags unclosed function body (the original LLM bug)', () => {
    const issue = checkScriptSyntaxBalance('function testFetch() {');
    assert.ok(issue, 'expected an issue for unclosed body');
    assert.match(issue.reason, /缺少 1 个 '\}'/);
  });

  it('flags missing closing paren', () => {
    const issue = checkScriptSyntaxBalance('function findOffset(');
    assert.ok(issue);
    assert.match(issue.reason, /缺少 1 个 '\)'/);
  });

  it('flags an extra closing paren', () => {
    const issue = checkScriptSyntaxBalance('() => 1 + 1)');
    assert.ok(issue);
    assert.match(issue.reason, /多了一个 '\)'/);
  });

  it('does not false-positive on braces inside strings', () => {
    assert.strictEqual(
      checkScriptSyntaxBalance('() => "function foo() {"'),
      null,
    );
  });

  it('does not false-positive on braces inside line comments', () => {
    assert.strictEqual(
      checkScriptSyntaxBalance('() => 1 // function bar() {'),
      null,
    );
  });

  it('does not false-positive on braces inside block comments', () => {
    assert.strictEqual(
      checkScriptSyntaxBalance('/* function x() { */ () => 1'),
      null,
    );
  });

  it('handles template strings with ${} interpolation', () => {
    assert.strictEqual(
      checkScriptSyntaxBalance('() => `value: ${ {a: 1}.a }`'),
      null,
    );
  });

  it('flags unclosed template literal', () => {
    const issue = checkScriptSyntaxBalance('() => `hello');
    assert.ok(issue);
    assert.match(issue.reason, /模板字符串未闭合/);
  });

  it('flags unclosed string literal', () => {
    const issue = checkScriptSyntaxBalance('() => "hello');
    assert.ok(issue);
    assert.match(issue.reason, /字符串字面量未闭合/);
  });

  it('flags unclosed block comment', () => {
    const issue = checkScriptSyntaxBalance('/* unclosed');
    assert.ok(issue);
    assert.match(issue.reason, /块注释未闭合/);
  });

  it('handles escaped quote inside string', () => {
    assert.strictEqual(
      checkScriptSyntaxBalance('() => "she said \\"hi\\""'),
      null,
    );
  });
});
