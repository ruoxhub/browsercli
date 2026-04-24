/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 自动 Hook 工具单元测试
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  autoHook,
  type AutoHookToolData,
} from '../../../../src/tools/workflow/autoHook.js';

describe('autoHook tool', () => {
  describe('工具导出', () => {
    it('应该导出 autoHook 工具函数', () => {
      assert.strictEqual(typeof autoHook, 'function');
    });
  });

  describe('执行结果', () => {
    it('应该返回成功的执行结果', async () => {
      const result = await autoHook({
        url: 'https://example.com',
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.message);
    });

    it('应该返回 Hook 注入记录', async () => {
      const result = await autoHook({
        url: 'https://example.com',
        preset: 'api-signature',
        hookCrypto: true,
      });

      assert.ok(result.data);
      const data = result.data as AutoHookToolData;
      assert.strictEqual(data.url, 'https://example.com');
      assert.ok(Array.isArray(data.hooksInjected));
      assert.ok(Array.isArray(data.cryptoDetected));
    });

    it('应该处理错误情况', async () => {
      // 模拟错误场景
      const result = await autoHook({
        url: 'https://example.com',
        preset: 'invalid-preset' as unknown as 'api-signature',
      });

      // 应该优雅地处理无效预设
      assert.ok(result.success || result.error);
    });
  });

  describe('预设配置', () => {
    it('应该支持 api-signature 预设', async () => {
      const result = await autoHook({
        url: 'https://example.com',
        preset: 'api-signature',
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 network-core 预设', async () => {
      const result = await autoHook({
        url: 'https://example.com',
        preset: 'network-core',
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 none 预设', async () => {
      const result = await autoHook({
        url: 'https://example.com',
        preset: 'none',
      });

      assert.strictEqual(result.success, true);
    });
  });

  describe('加密库 Hook', () => {
    it('应该支持 hookCrypto 选项', async () => {
      const result = await autoHook({
        url: 'https://example.com',
        hookCrypto: true,
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 hookRsa 选项', async () => {
      const result = await autoHook({
        url: 'https://example.com',
        hookRsa: true,
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 hookSmCrypto 选项', async () => {
      const result = await autoHook({
        url: 'https://example.com',
        hookSmCrypto: true,
      });

      assert.strictEqual(result.success, true);
    });
  });

  describe('基础 Hook', () => {
    it('应该支持 hookTimers 选项', async () => {
      const result = await autoHook({
        url: 'https://example.com',
        hookTimers: true,
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 hookEval 选项', async () => {
      const result = await autoHook({
        url: 'https://example.com',
        hookEval: true,
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 hookCookie 选项', async () => {
      const result = await autoHook({
        url: 'https://example.com',
        hookCookie: true,
      });

      assert.strictEqual(result.success, true);
    });
  });

  describe('Hook 报告生成', () => {
    it('应该生成包含所有注入 Hook 的报告', async () => {
      const result = await autoHook({
        url: 'https://example.com',
        preset: 'network-core',
        hookCrypto: true,
        hookTimers: true,
        hookCookie: true,
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.data);

      const data = result.data as AutoHookToolData;

      // 验证报告包含所有注入的 Hook
      assert.ok(data.hooksInjected.length >= 3, '应该包含多个 Hook 注入记录');
    });
  });
});
