/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 自动 Hook 技能单元测试
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { registerAutoHookSkill, type AutoHookOptions, type AutoHookSkillData } from '../../../src/skills/auto-hook.js';
import { SkillRegistry } from '../../../src/skills/SkillRunner.js';

describe('AutoHookSkill', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    // 重置注册表
    registry = SkillRegistry.getInstance();
    registerAutoHookSkill();
  });

  afterEach(() => {
    // 清理注册表
    (registry as unknown as { skills: Map<string, unknown> }).skills.clear();
  });

  describe('技能注册', () => {
    it('应该正确注册 auto-hook 技能', () => {
      const skill = registry.get('auto-hook');
      assert.ok(skill, 'auto-hook 技能应该已注册');
      assert.strictEqual(skill.name, 'auto-hook');
      assert.strictEqual(skill.category, 'hook');
      assert.ok(skill.description.includes('自动 Hook'));
    });
  });

  describe('执行结果', () => {
    it('应该返回成功的执行结果', async () => {
      const skill = registry.get('auto-hook');
      assert.ok(skill);

      const result = await skill.execute({
        url: 'https://example.com',
        options: {},
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.message);
    });

    it('应该返回 Hook 注入记录', async () => {
      const skill = registry.get('auto-hook');
      assert.ok(skill);

      const result = await skill.execute({
        url: 'https://example.com',
        options: {
          preset: 'api-signature',
          hookCrypto: true,
        },
      });

      assert.ok(result.data);
      const data = result.data as {
        url: string;
        hooksInjected: unknown[];
        cryptoDetected: unknown[];
      };
      assert.strictEqual(data.url, 'https://example.com');
      assert.ok(Array.isArray(data.hooksInjected));
      assert.ok(Array.isArray(data.cryptoDetected));
    });

    it('应该处理错误情况', async () => {
      const skill = registry.get('auto-hook');
      assert.ok(skill);

      // 模拟错误场景
      const result = await skill.execute({
        url: 'https://example.com',
        options: {
          preset: 'invalid-preset' as unknown as 'api-signature',
        },
      });

      // 应该优雅地处理无效预设
      assert.ok(result.success || result.error);
    });
  });

  describe('预设配置', () => {
    it('应该支持 api-signature 预设', async () => {
      const skill = registry.get('auto-hook');
      assert.ok(skill);

      const result = await skill.execute({
        url: 'https://example.com',
        options: {
          preset: 'api-signature',
        },
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 network-core 预设', async () => {
      const skill = registry.get('auto-hook');
      assert.ok(skill);

      const result = await skill.execute({
        url: 'https://example.com',
        options: {
          preset: 'network-core',
        },
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 none 预设', async () => {
      const skill = registry.get('auto-hook');
      assert.ok(skill);

      const result = await skill.execute({
        url: 'https://example.com',
        options: {
          preset: 'none',
        },
      });

      assert.strictEqual(result.success, true);
    });
  });

  describe('加密库 Hook', () => {
    it('应该支持 hookCrypto 选项', async () => {
      const skill = registry.get('auto-hook');
      assert.ok(skill);

      const result = await skill.execute({
        url: 'https://example.com',
        options: {
          hookCrypto: true,
        },
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 hookRsa 选项', async () => {
      const skill = registry.get('auto-hook');
      assert.ok(skill);

      const result = await skill.execute({
        url: 'https://example.com',
        options: {
          hookRsa: true,
        },
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 hookSmCrypto 选项', async () => {
      const skill = registry.get('auto-hook');
      assert.ok(skill);

      const result = await skill.execute({
        url: 'https://example.com',
        options: {
          hookSmCrypto: true,
        },
      });

      assert.strictEqual(result.success, true);
    });
  });

  describe('基础 Hook', () => {
    it('应该支持 hookTimers 选项', async () => {
      const skill = registry.get('auto-hook');
      assert.ok(skill);

      const result = await skill.execute({
        url: 'https://example.com',
        options: {
          hookTimers: true,
        },
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 hookEval 选项', async () => {
      const skill = registry.get('auto-hook');
      assert.ok(skill);

      const result = await skill.execute({
        url: 'https://example.com',
        options: {
          hookEval: true,
        },
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 hookCookie 选项', async () => {
      const skill = registry.get('auto-hook');
      assert.ok(skill);

      const result = await skill.execute({
        url: 'https://example.com',
        options: {
          hookCookie: true,
        },
      });

      assert.strictEqual(result.success, true);
    });
  });

  describe('Hook 报告生成', () => {
    it('应该生成包含所有注入 Hook 的报告', async () => {
      const skill = registry.get('auto-hook');
      assert.ok(skill);

      const result = await skill.execute({
        url: 'https://example.com',
        options: {
          preset: 'network-core',
          hookCrypto: true,
          hookTimers: true,
          hookCookie: true,
        },
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.data);

      const data = result.data as {
        url: string;
        hooksInjected: unknown[];
        cryptoDetected: unknown[];
        report?: unknown;
      };

      // 验证报告包含所有注入的 Hook
      assert.ok(data.hooksInjected.length >= 3, '应该包含多个 Hook 注入记录');
    });
  });
});
