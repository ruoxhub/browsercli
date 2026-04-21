/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {strict as assert} from 'node:assert';
import {describe, it, mock} from 'node:test';

import type {Frame} from '../../../src/third_party/index.js';

import {
  activateVueDevtools,
  clearVueGuards,
  getVueRoutes,
} from '../../../src/tools/vue/index.js';
import type {VueGuard} from '../../../src/tools/vue/types.js';

function createErrorFrame(errorMsg: string): Frame {
  return {
    evaluate: async () => {
      throw new Error(errorMsg);
    },
  } as unknown as Frame;
}

describe('vue functions', () => {
  describe('activateVueDevtools', () => {
    it('应该在未安装 Devtools 时返回失败结果', async () => {
      const evaluate = mock.fn(async () => ({
        success: false,
        error: 'Vue Devtools hook not found',
      }));
      const frame = {evaluate} as unknown as Frame;

      const result = await activateVueDevtools(frame);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.tooltype, 'activate_vue_devtools');
    });

    it('应该在 evaluate 抛出错误时返回失败结果', async () => {
      const frame = createErrorFrame('Vue 注入失败');

      const result = await activateVueDevtools(frame);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.tooltype, 'activate_vue_devtools');
    });
  });

  describe('clearVueGuards', () => {
    it('应该在未找到 Router 时返回失败结果', async () => {
      const evaluate = mock.fn(async () => ({
        success: false,
        error: 'Vue Router not found',
      }));
      const frame = {evaluate} as unknown as Frame;

      const result = await clearVueGuards(frame);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.tooltype, 'clear_vue_guards');
    });

    it('应该支持自定义 guards 参数', async () => {
      const evaluate = mock.fn(async () => ({
        success: true,
        clearedGuards: ['beforeEach'],
      }));
      const frame = {evaluate} as unknown as Frame;
      const guards: VueGuard[] = ['beforeEach'];

      const result = await clearVueGuards(frame, guards);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'clear_vue_guards');
    });
  });

  describe('getVueRoutes', () => {
    it('应该在未找到 Router 时返回失败结果', async () => {
      const evaluate = mock.fn(async () => ({
        found: false,
        error: 'Vue Router not found',
      }));
      const frame = {evaluate} as unknown as Frame;

      const result = await getVueRoutes(frame);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.tooltype, 'get_vue_routes');
    });

    it('应该在 evaluate 抛出错误时返回失败结果', async () => {
      const frame = createErrorFrame('Vue Routes 注入失败');

      const result = await getVueRoutes(frame);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.tooltype, 'get_vue_routes');
    });
  });
});
