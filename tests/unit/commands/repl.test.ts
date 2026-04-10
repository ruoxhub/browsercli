/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {strict as assert} from 'node:assert';
import {describe, it} from 'node:test';

import {complete} from '../../../src/commands/repl.js';

describe('REPL tab completion', () => {
  it('补全 REPL 命令', () => {
    assert.deepStrictEqual(complete('h'), ['help']);
    assert.deepStrictEqual(complete('he'), ['help']);
    assert.deepStrictEqual(complete('hel'), ['help']);
    assert.deepStrictEqual(complete('s'), ['status']);
    assert.deepStrictEqual(complete('st'), ['status']);
    assert.deepStrictEqual(complete('e'), ['exit']);
    assert.deepStrictEqual(complete('q'), ['quit']);
  });

  it('list- 补全 list-skills 和 list-tools', () => {
    const results = complete('list-');
    assert.ok(results.includes('list-skills'));
    assert.ok(results.includes('list-tools'));
  });

  it('skill 补全技能名', () => {
    const results = complete('skill o');
    assert.ok(results.length > 0);
    assert.ok(results.some((r: string) => r.startsWith('o')));
  });

  it('tool 补全工具名', () => {
    const results = complete('tool click');
    assert.ok(results.length > 0);
    assert.ok(results.some((r: string) => r.startsWith('click')));
  });

  it('未知输入返回空数组', () => {
    assert.deepStrictEqual(complete('zzzzz'), []);
  });

  it('空输入补全所有命令', () => {
    const results = complete('');
    assert.ok(results.length >= 5);
    assert.ok(results.includes('help'));
    assert.ok(results.includes('status'));
  });
});
