/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';


import {Command} from 'commander';
import {z} from 'zod';

import {
  getParameterType,
  isOptional,
  formatResult,
  registerToolSchema,
} from '../../../src/commands/tool-commands.js';

describe('commands/tool-commands', () => {
  describe('getParameterType', () => {
    it('应该识别数组类型', () => {
      const arraySchema = z.array(z.string());
      assert.strictEqual(getParameterType(arraySchema), 'string');
    });

    it('应该识别布尔类型', () => {
      const boolSchema = z.boolean();
      assert.strictEqual(getParameterType(boolSchema), 'boolean');
    });

    it('应该识别数字类型', () => {
      const numberSchema = z.number();
      assert.strictEqual(getParameterType(numberSchema), 'number');
    });

    it('应该识别整数类型', () => {
      const intSchema = z.number().int();
      assert.strictEqual(getParameterType(intSchema), 'number');
    });

    it('应该识别字符串类型', () => {
      const stringSchema = z.string();
      assert.strictEqual(getParameterType(stringSchema), 'string');
    });

    it('应该识别枚举类型', () => {
      const enumSchema = z.enum(['png', 'jpeg']);
      assert.strictEqual(getParameterType(enumSchema), 'string');
    });

    it('应该处理可选类型', () => {
      const optionalSchema = z.string().optional();
      assert.strictEqual(getParameterType(optionalSchema), 'string');
    });

    it('应该处理默认值类型', () => {
      const defaultSchema = z.string().default('test');
      assert.strictEqual(getParameterType(defaultSchema), 'string');
    });
  });

  describe('isOptional', () => {
    it('应该识别可选字段', () => {
      const optionalSchema = z.string().optional();
      assert.strictEqual(isOptional(optionalSchema), true);
    });

    it('应该识别默认值字段', () => {
      const defaultSchema = z.string().default('test');
      assert.strictEqual(isOptional(defaultSchema), true);
    });

    it('应该识别必填字段', () => {
      const requiredSchema = z.string();
      assert.strictEqual(isOptional(requiredSchema), false);
    });

    it('应该识别数字默认值', () => {
      const defaultSchema = z.number().default(100);
      assert.strictEqual(isOptional(defaultSchema), true);
    });

    it('应该识别布尔默认值', () => {
      const defaultSchema = z.boolean().default(false);
      assert.strictEqual(isOptional(defaultSchema), true);
    });
  });

  describe('formatResult', () => {
    it('应该格式化成功结果', () => {
      const result = {
        success: true,
        result: '操作成功',
      };
      assert.strictEqual(formatResult(result), '操作成功');
    });

    it('应该处理失败结果', () => {
      const result = {
        success: false,
        error: '网络错误',
      };
      assert.strictEqual(formatResult(result), '执行失败：网络错误');
    });

    it('应该处理失败但无错误消息', () => {
      const result = {
        success: false,
      };
      assert.strictEqual(formatResult(result), '执行失败：未知错误');
    });

    it('应该处理成功但无结果消息', () => {
      const result = {
        success: true,
      };
      assert.strictEqual(formatResult(result), '执行成功');
    });
  });

  describe('registerToolSchema', () => {
    it('应该为必填字符串参数添加参数', () => {
      const cmd = new Command();
      const schema = {
        selector: z.string().describe('CSS 选择器'),
      };
      registerToolSchema(cmd, schema);
      const options = cmd.options;
      assert.strictEqual(options.length, 0);
      // 必填参数作为 arguments 添加，检查 _args
      assert.strictEqual((cmd as any)._args.length, 1);
      assert.strictEqual((cmd as any)._args[0]._name, 'selector');
    });

    it('应该为可选参数添加选项', () => {
      const cmd = new Command();
      const schema = {
        timeout: z.number().optional().describe('超时时间'),
      };
      registerToolSchema(cmd, schema);
      const options = cmd.options;
      assert.strictEqual(options.length, 1);
      assert.strictEqual(options[0]?.flags, '--timeout <value>');
    });

    it('应该为布尔参数添加选项', () => {
      const cmd = new Command();
      const schema = {
        fullPage: z.boolean().describe('是否截取整个页面'),
      };
      registerToolSchema(cmd, schema);
      const options = cmd.options;
      assert.strictEqual(options.length, 1);
      assert.strictEqual(options[0]?.flags, '--fullPage');
    });

    it('应该处理空 schema', () => {
      const cmd = new Command();
      registerToolSchema(cmd, {});
      assert.strictEqual(cmd.options.length, 0);
      assert.strictEqual((cmd as any)._args.length, 0);
    });

    it('应该处理 null schema', () => {
      const cmd = new Command();
      // @ts-expect-error - 测试 null 输入
      registerToolSchema(cmd, null);
      assert.strictEqual(cmd.options.length, 0);
      assert.strictEqual((cmd as any)._args.length, 0);
    });

    it('应该为带默认值的参数添加选项', () => {
      const cmd = new Command();
      const schema = {
        format: z.enum(['png', 'jpeg']).default('png').describe('图片格式'),
      };
      registerToolSchema(cmd, schema);
      const options = cmd.options;
      assert.strictEqual(options.length, 1);
      assert.strictEqual(options[0]?.flags, '--format <value>');
    });

    it('应该处理多个参数', () => {
      const cmd = new Command();
      const schema = {
        selector: z.string().describe('CSS 选择器'),
        timeout: z.number().optional().describe('超时时间'),
        fullPage: z.boolean().describe('是否全屏'),
      };
      registerToolSchema(cmd, schema);

      // 1 个必填参数 + 2 个可选参数
      assert.strictEqual((cmd as any)._args.length, 1);
      assert.strictEqual(cmd.options.length, 2);
    });
  });
});
