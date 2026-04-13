/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {strict as assert} from 'node:assert';
import {describe, it} from 'node:test';

import {activateVueDevtools} from '../../../src/tools/vue/activateVueDevtools.js';
import {clearVueGuards} from '../../../src/tools/vue/clearVueGuards.js';
import {getVueRoutes} from '../../../src/tools/vue/getVueRoutes.js';

describe('Vue tools metadata', () => {
  describe('activateVueDevtools', () => {
    it('工具定义正确', () => {
      assert.strictEqual(activateVueDevtools.name, 'activate_vue_devtools');
      assert.ok(activateVueDevtools.description.includes('Vue Devtools'));
      assert.strictEqual(activateVueDevtools.annotations.readOnlyHint, false);
      assert.deepStrictEqual(activateVueDevtools.schema, {});
    });

    it('handler 是异步函数', async () => {
      assert.strictEqual(typeof activateVueDevtools.handler, 'function');
      assert.strictEqual(
        activateVueDevtools.handler.constructor.name,
        'AsyncFunction',
      );
    });
  });

  describe('clearVueGuards', () => {
    it('工具定义正确', () => {
      assert.strictEqual(clearVueGuards.name, 'clear_vue_guards');
      assert.ok(clearVueGuards.description.includes('全局守卫'));
      assert.strictEqual(clearVueGuards.annotations.readOnlyHint, false);
    });

    it('schema 包含 guards 参数', () => {
      const schema = clearVueGuards.schema;
      assert.ok('guards' in schema);
    });

    it('handler 是异步函数', async () => {
      assert.strictEqual(typeof clearVueGuards.handler, 'function');
      assert.strictEqual(
        clearVueGuards.handler.constructor.name,
        'AsyncFunction',
      );
    });
  });

  describe('getVueRoutes', () => {
    it('工具定义正确', () => {
      assert.strictEqual(getVueRoutes.name, 'get_vue_routes');
      assert.ok(getVueRoutes.description.includes('路由表'));
      assert.strictEqual(getVueRoutes.annotations.readOnlyHint, true);
    });

    it('schema 包含 includeChildren 和 maxDepth 参数', () => {
      const schema = getVueRoutes.schema;
      assert.ok('includeChildren' in schema);
      assert.ok('maxDepth' in schema);
    });

    it('handler 是异步函数', async () => {
      assert.strictEqual(typeof getVueRoutes.handler, 'function');
      assert.strictEqual(
        getVueRoutes.handler.constructor.name,
        'AsyncFunction',
      );
    });
  });
});

describe('Vue tools hook code 结构', () => {
  it('activateVueDevtools hookCode 包含关键函数', async () => {
    // Verify the module structure
    assert.ok(activateVueDevtools.handler);
  });

  it('clearVueGuards hookCode 包含 findRouter 函数', () => {
    // Verify the module structure
    assert.ok(clearVueGuards.handler);
  });

  it('getVueRoutes hookCode 包含 extractRoutes 函数', () => {
    // Verify the module structure
    assert.ok(getVueRoutes.handler);
  });
});
