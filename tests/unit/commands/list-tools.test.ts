#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {formatTools} from '../../../src/commands/list-tools.js';

describe('formatTools', () => {
  it('文本模式格式化多个工具', () => {
    const tools = [
      {name: 'hook-cookie', description: 'Hook Cookie读写'},
      {name: 'hook-xhr', description: 'Hook XHR请求'},
      {name: 'hook-fetch', description: 'Hook Fetch请求'},
    ];
    const result = formatTools(tools, false);
    assert.ok(result.includes('可用工具'));
    assert.ok(result.includes('hook-cookie'));
    assert.ok(result.includes('hook-xhr'));
    assert.ok(result.includes('hook-fetch'));
    assert.ok(!result.includes('description'));
  });

  it('JSON模式输出工具列表', () => {
    const tools = [
      {name: 'hook-cookie', description: 'Hook Cookie读写'},
      {name: 'hook-xhr', description: 'Hook XHR请求'},
    ];
    const result = formatTools(tools, true);
    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].name, 'hook-cookie');
    assert.strictEqual(parsed[1].name, 'hook-xhr');
  });

  it('处理空工具列表', () => {
    const result = formatTools([], false);
    assert.ok(result.includes('可用工具'));
    assert.ok(result.includes('(无)'));
  });

  it('处理空工具列表（JSON模式）', () => {
    const result = formatTools([], true);
    assert.strictEqual(result, '[]');
  });

  it('工具没有 description 字段也能正常输出', () => {
    const tools = [{name: 'some-tool'}];
    const result = formatTools(tools, false);
    assert.ok(result.includes('some-tool'));
  });
});
