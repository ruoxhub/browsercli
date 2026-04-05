/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {schemaToCLIOptions} from '../../../src/bin/generate-cli.js';

describe('bin/generate-cli', () => {
  describe('schemaToCLIOptions', () => {
    it('应该从简单 schema 提取 CLI 选项', () => {
      const schema = {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '目标 URL',
          },
          timeout: {
            type: 'number',
            description: '超时时间',
          },
        },
        required: ['url'],
      };

      const options = schemaToCLIOptions(schema);

      assert.strictEqual(options.length, 2);
      assert.strictEqual(options[0]?.name, 'url');
      assert.strictEqual(options[0]?.required, true);
      assert.strictEqual(options[1]?.name, 'timeout');
      assert.strictEqual(options[1]?.required, false);
    });

    it('应该处理枚举类型', () => {
      const schema = {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            enum: ['png', 'jpeg', 'webp'],
          },
        },
      };

      const options = schemaToCLIOptions(schema);

      assert.strictEqual(options.length, 1);
      assert.deepStrictEqual(options[0]?.enum, ['png', 'jpeg', 'webp']);
    });

    it('应该处理默认值', () => {
      const schema = {
        type: 'object',
        properties: {
          quality: {
            type: 'number',
            default: 80,
          },
        },
      };

      const options = schemaToCLIOptions(schema);

      assert.strictEqual(options.length, 1);
      assert.strictEqual(options[0]?.default, 80);
    });

    it('空 schema 应该返回空数组', () => {
      assert.deepStrictEqual(schemaToCLIOptions({}), []);
      assert.deepStrictEqual(schemaToCLIOptions({type: 'object'}), []);
    });

    it('应该处理数组类型', () => {
      const schema = {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            description: '标签列表',
          },
        },
      };

      const options = schemaToCLIOptions(schema);

      assert.strictEqual(options.length, 1);
      assert.strictEqual(options[0]?.type, 'array');
    });

    it('应该处理联合类型', () => {
      const schema = {
        type: 'object',
        properties: {
          value: {
            type: ['string', 'null'],
            description: '可选值',
          },
        },
      };

      const options = schemaToCLIOptions(schema);

      assert.strictEqual(options.length, 1);
      assert.strictEqual(options[0]?.type, 'string');
    });
  });
});
