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

describe('validateToolArgs array-of-object (json) param', () => {
  before(async () => {
    await ensureToolsMeta();
  });

  it('replay_network_request_batch 暴露 variants 为 json 规格', () => {
    const meta = getToolMeta('replay_network_request_batch');
    assert.ok(meta, 'replay_network_request_batch meta 应存在');
    assert.equal(meta!.argSpecs.variants?.type, 'json');
  });

  it('接受以 JSON 字符串传入的 --variants 并解析为数组', () => {
    const result = validateToolArgs('replay_network_request_batch', {
      reqid: 1,
      variants: '[{"method":"GET"}]',
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(Array.isArray(result.value.variants));
      assert.equal(
        (result.value.variants as Array<{method?: string}>)[0].method,
        'GET',
      );
    }
  });

  it('接受已解析的数组（非字符串）作为 variants', () => {
    const result = validateToolArgs('replay_network_request_batch', {
      reqid: 1,
      variants: [{method: 'POST'}],
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal((result.value.variants as unknown[]).length, 1);
    }
  });

  it('缺省 variants 时不报错（工具内部自动派生单变体）', () => {
    const result = validateToolArgs('replay_network_request_batch', {
      reqid: 1,
    });

    assert.equal(result.ok, true);
  });
});

describe('validateToolArgs browsercli regression contracts', () => {
  before(async () => {
    await ensureToolsMeta();
  });

  it('exposes task context arguments for evidence and rebuild tools', () => {
    for (const toolName of [
      'record_reverse_evidence',
      'export_rebuild_bundle',
    ]) {
      const meta = getToolMeta(toolName);
      assert.ok(meta, `${toolName} meta 应存在`);
      assert.equal(meta.argSpecs.taskId?.type, 'string');
      assert.equal(meta.argSpecs.taskSlug?.type, 'string');
      assert.equal(meta.argSpecs.targetUrl?.type, 'string');
      assert.equal(meta.argSpecs.goal?.type, 'string');
    }
  });

  it('applies the default occurrence for set_breakpoint_on_text', () => {
    const result = validateToolArgs('set_breakpoint_on_text', {
      text: 'targetFn',
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.occurrence, 1);
    }
  });
});
