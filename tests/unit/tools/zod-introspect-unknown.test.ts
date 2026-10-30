/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {zod} from '../../../src/third_party/index.js';
import {extractArgSpecsFromSchema} from '../../../src/tools/zod-introspect.js';

/**
 * zod.unknown() 必须在 argSpecs 里留下条目。
 *
 * create_hook 的 `params` 就是 zod.unknown()：类型相关参数（target、
 * object/property 等）全在它里面。一旦它在 argSpecs 中缺失，
 * buildToolArgs 会把 --params 当作未知参数拒掉，导致 function / property
 * 等 hook 类型完全无法创建。
 */
describe('zod.unknown() argument spec', () => {
  it('keeps an unknown-typed field instead of dropping it', () => {
    const specs = extractArgSpecsFromSchema({params: zod.unknown().optional()});
    assert.ok(
      specs.params,
      'params 必须出现在 argSpecs 中，否则 CLI 会拒绝 --params',
    );
    assert.equal(specs.params.type, 'json');
    assert.equal(specs.params.required, false);
  });

  it('treats a required unknown field as required', () => {
    const specs = extractArgSpecsFromSchema({payload: zod.unknown()});
    assert.ok(specs.payload);
    assert.equal(specs.payload.required, true);
  });
});
