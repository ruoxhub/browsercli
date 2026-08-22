/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {before, describe, it} from 'node:test';

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

describe('validateToolArgs strict parameter validation and alias removal', () => {
  before(async () => {
    await ensureToolsMeta();
  });

  it('rejects former alias --depth for get_dom_structure and suggests maxDepth', () => {
    const result = validateToolArgs('get_dom_structure', {depth: 2});

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(
        result.error.includes('不支持参数 --depth'),
        `error 应包含 '不支持参数 --depth'，实际: ${result.error}`,
      );
      assert.ok(
        result.error.includes('maxDepth'),
        `error 应建议 maxDepth，实际: ${result.error}`,
      );
      assert.ok(
        result.error.includes('get_dom_structure 支持参数：'),
        `error 应列出支持的参数，实际: ${result.error}`,
      );
    }
  });

  it('accepts canonical parameter --maxDepth for get_dom_structure', () => {
    const result = validateToolArgs('get_dom_structure', {maxDepth: 2});

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.maxDepth, 2);
    }
  });

  it('rejects other former parameter aliases with suggestions', () => {
    const res1 = validateToolArgs('search_in_scripts', {keyword: 'target'});
    assert.equal(res1.ok, false);
    if (!res1.ok) {
      assert.ok(res1.error.includes('不支持参数 --keyword'));
      assert.ok(res1.error.includes('pattern'));
    }

    const res2 = validateToolArgs('list_network_requests', {url: 'api'});
    assert.equal(res2.ok, false);
    if (!res2.ok) {
      assert.ok(res2.error.includes('不支持参数 --url'));
      assert.ok(res2.error.includes('urlFilter'));
    }

    const res3 = validateToolArgs('collect_code', {mode: 'fast'});
    assert.equal(res3.ok, false);
    if (!res3.ok) {
      assert.ok(res3.error.includes('不支持参数 --mode'));
      assert.ok(res3.error.includes('smartMode'));
    }
  });

  it('string[] rejects scalar string and accepts string array', () => {
    const rejectResult = validateToolArgs('set_files', {
      selector: '#fileInput',
      filePaths: '/tmp/test.txt',
    });
    assert.equal(rejectResult.ok, false);
    if (!rejectResult.ok) {
      assert.ok(
        rejectResult.error.includes('必须是字符串数组'),
        `error 应提示必须是字符串数组，实际: ${rejectResult.error}`,
      );
    }

    const acceptResult = validateToolArgs('set_files', {
      selector: '#fileInput',
      filePaths: ['/tmp/test.txt'],
    });
    assert.equal(acceptResult.ok, true);
    if (acceptResult.ok) {
      assert.deepEqual(acceptResult.value.filePaths, ['/tmp/test.txt']);
    }
  });

  it('enum validation error lists all accepted case-sensitive values', () => {
    const caseResult = validateToolArgs('understand_code', {
      code: 'var x = 1;',
      focus: 'SECURITY',
    });
    assert.equal(caseResult.ok, false);
    if (!caseResult.ok) {
      assert.equal(
        caseResult.error,
        'understand_code 的参数 focus 仅支持：all, structure, business, security',
      );
    }

    const invalidResult = validateToolArgs('understand_code', {
      code: 'var x = 1;',
      focus: 'invalid_mode',
    });
    assert.equal(invalidResult.ok, false);
    if (!invalidResult.ok) {
      assert.equal(
        invalidResult.error,
        'understand_code 的参数 focus 仅支持：all, structure, business, security',
      );
    }

    const validResult = validateToolArgs('understand_code', {
      code: 'var x = 1;',
      focus: 'security',
    });
    assert.equal(validResult.ok, true);
    if (validResult.ok) {
      assert.equal(validResult.value.focus, 'security');
    }
  });
});
