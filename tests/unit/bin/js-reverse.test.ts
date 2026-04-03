/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it} from 'node:test';
import assert from 'node:assert';
import {parseCliArgs, buildCommandArgs} from '../../../src/bin/js-reverse.js';

describe('bin/js-reverse', () => {
  describe('parseCliArgs', () => {
    it('应该解析基本参数', () => {
      const args = parseCliArgs(['call', 'click', '--uid=abc123']);
      assert.strictEqual(args.command, 'call');
      assert.strictEqual(args.tool, 'click');
      assert.deepStrictEqual(args.params, {uid: 'abc123'});
    });

    it('应该解析输出格式参数', () => {
      const args = parseCliArgs([
        'call',
        'click',
        '--uid=abc',
        '--output-format=json',
      ]);
      assert.strictEqual(args.outputFormat, 'json');
    });

    it('应该解析布尔参数', () => {
      const args = parseCliArgs(['start', '--headless', '--isolated']);
      assert.strictEqual(args.params.headless, true);
      assert.strictEqual(args.params.isolated, true);
    });

    it('应该解析字符串参数', () => {
      const args = parseCliArgs([
        'start',
        '--browserUrl',
        'http://localhost:9222',
      ]);
      assert.strictEqual(args.params.browserUrl, 'http://localhost:9222');
    });

    it('没有命令时应该返回默认值', () => {
      const args = parseCliArgs([]);
      assert.strictEqual(args.command, 'help');
    });
  });

  describe('buildCommandArgs', () => {
    it('应该构建 call 命令参数', () => {
      const result = buildCommandArgs({
        command: 'call',
        tool: 'click',
        params: {uid: 'abc123'},
        outputFormat: 'text',
      });
      assert.strictEqual(result.method, 'invoke_tool');
      assert.strictEqual(result.tool, 'click');
      assert.deepStrictEqual(result.args, {uid: 'abc123'});
    });

    it('应该构建 call-skill 命令参数', () => {
      const result = buildCommandArgs({
        command: 'call-skill',
        skill: 'observe-flow',
        params: {url: 'https://example.com'},
        outputFormat: 'json',
      });
      assert.strictEqual(result.method, 'invoke_skill');
      assert.strictEqual(result.skill, 'observe-flow');
      assert.deepStrictEqual(result.args, {url: 'https://example.com'});
    });
  });
});
