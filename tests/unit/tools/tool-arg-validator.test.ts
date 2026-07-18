/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';

import {validateToolArgs} from '../../../src/tools/tool-arg-validator.js';
import {ensureToolsMeta, getToolMeta} from '../../../src/tools/tools-meta.js';

describe('validateToolArgs numeric string-id coercion', () => {
  before(async () => {
    // getToolMeta (sync) 依赖 ensureToolsMeta 预热的缓存；未初始化时
    // 会回退到空 argSpecs 导致校验被跳过。
    await ensureToolsMeta();
  });

  it('get_script_source 的 scriptId 在 meta 中为 string 类型', () => {
    const meta = getToolMeta('get_script_source');
    assert.ok(meta, 'get_script_source meta 应存在');
    assert.equal(meta!.argSpecs.scriptId?.type, 'string');
  });

  it('coerces a numeric scriptId (from CLI) to string instead of rejecting', () => {
    const result = validateToolArgs('get_script_source', {scriptId: 190139});

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.scriptId, '190139');
    }
  });

  it('still rejects a non-string, non-number value for a string param', () => {
    const result = validateToolArgs('get_script_source', {scriptId: {a: 1}});

    assert.equal(result.ok, false);
  });
});
