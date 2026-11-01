/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {before, describe, it} from 'node:test';

import {zod} from '../../../src/third_party/index.js';
import {validateToolArgs} from '../../../src/tools/tool-arg-validator.js';
import {ensureToolsMeta, getToolMeta} from '../../../src/tools/tools-meta.js';
import {extractArgSpecsFromSchema} from '../../../src/tools/zod-introspect.js';

describe('ToolArgSpec range extraction', () => {
  it('extracts int/min/max from a zod number schema', () => {
    const specs = extractArgSpecsFromSchema({
      width: zod.number().int().min(1).max(10000),
    });
    assert.ok(specs.width?.range);
    assert.equal(specs.width!.range!.int, true);
    assert.equal(specs.width!.range!.min?.value, 1);
    assert.equal(specs.width!.range!.min?.inclusive, true);
    assert.equal(specs.width!.range!.max?.value, 10000);
  });

  it('returns undefined range for unbounded numbers', () => {
    assert.equal(
      extractArgSpecsFromSchema({rate: zod.number()}).rate?.range,
      undefined,
    );
  });
});

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
    const result = validateToolArgs('resize_page', {
      width: '1280',
      height: '720',
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.width, 1280);
    }
  });

  it('resize_page enforces its 1..10000 range on height', () => {
    const bad = validateToolArgs('resize_page', {width: 1280, height: 20000});
    assert.equal(bad.ok, false);
    const good = validateToolArgs('resize_page', {width: 1280, height: 720});
    assert.equal(good.ok, true);
  });
});
