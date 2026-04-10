/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {strict as assert} from 'node:assert';
import {describe, it} from 'node:test';

import {validateTaskName, validateUrl} from '../../../src/commands/scaffold.js';

describe('validateTaskName', () => {
  it('接受有效名称', () => {
    assert.strictEqual(validateTaskName('jd-h5st'), null);
    assert.strictEqual(validateTaskName('douyin-sign'), null);
    assert.strictEqual(validateTaskName('a'), null);
    assert.strictEqual(validateTaskName('my-task-123'), null);
  });

  it('拒绝大写字母开头的名称', () => {
    const err = validateTaskName('MyTask');
    assert.ok(err !== null);
    assert.ok(err?.includes('以小写字母开头'));
  });

  it('拒绝包含下划线的名称', () => {
    const err = validateTaskName('my_task');
    assert.ok(err !== null);
    assert.ok(err?.includes('下划线') || err?.includes('只能包含'));
  });

  it('拒绝包含空格的名称', () => {
    const err = validateTaskName('my task');
    assert.ok(err !== null);
  });

  it('拒绝纯数字的名称', () => {
    const err = validateTaskName('123');
    assert.ok(err !== null);
  });

  it('错误消息包含示例', () => {
    const err = validateTaskName('INVALID');
    assert.ok(err?.includes('jd-h5st'));
  });
});

describe('validateUrl', () => {
  it('接受有效 URL', () => {
    assert.strictEqual(validateUrl('https://example.com'), null);
    assert.strictEqual(validateUrl('http://127.0.0.1:9222'), null);
    assert.strictEqual(validateUrl('https://m.jd.com/path?a=1'), null);
  });

  it('undefined 返回 null', () => {
    assert.strictEqual(validateUrl(undefined), null);
  });

  it('空字符串返回 null（不校验）', () => {
    assert.strictEqual(validateUrl(''), null);
  });

  it('拒绝无效 URL', () => {
    const err = validateUrl('not-a-url');
    assert.ok(err !== null);
    assert.ok(err?.includes('not-a-url'));
  });

  it('拒绝缺少协议的 URL', () => {
    const err = validateUrl('example.com');
    // URL constructor requires protocol
    assert.ok(err !== null);
  });
});
