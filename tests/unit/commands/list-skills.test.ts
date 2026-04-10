/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {strict as assert} from 'node:assert';
import {describe, it} from 'node:test';

import {formatSkills} from '../../../src/commands/list-skills.js';

describe('formatSkills', () => {
  it('文本模式格式化多个技能', () => {
    const skills = [
      {name: 'observe-flow', description: '观察页面流程', category: '逆向'},
      {name: 'auto-hook', description: '自动注入Hook'},
    ];
    const result = formatSkills(skills);

    assert.ok(result.includes('可用技能'));
    assert.ok(result.includes('observe-flow'));
    assert.ok(result.includes('逆向'));
    assert.ok(result.includes('auto-hook'));
  });

  it('处理空技能列表并给出提示', () => {
    const result = formatSkills([]);

    assert.ok(result.includes('可用技能'));
    assert.ok(result.includes('(无可用技能)'));
    assert.ok(result.includes('js-reverse start'));
  });

  it('技能没有 category 字段也能正常输出', () => {
    const skills = [{name: 'some-skill', description: '描述'}];
    const result = formatSkills(skills);

    assert.ok(result.includes('some-skill'));
    assert.ok(result.includes('描述'));
    assert.ok(!result.includes('[]'));
  });

  it('技能名称后正确使用分类标记', () => {
    const skills = [
      {name: 'skill-a', description: 'desc', category: '采集'},
      {name: 'skill-b', description: 'desc'},
    ];
    const result = formatSkills(skills);

    assert.ok(result.includes('[采集]'));
    assert.ok(!result.includes('[undefined]'));
    assert.ok(result.includes('skill-b: desc'));
  });
});
