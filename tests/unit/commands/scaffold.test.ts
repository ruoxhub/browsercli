/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {strict as assert} from 'node:assert';
import {describe, it} from 'node:test';
import {mkdtempSync, rmSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

import {
  validateTaskName,
  validateUrl,
  scaffoldCommand,
} from '../../../src/commands/scaffold.js';

describe('validateTaskName', () => {
  it('接受有效名称', () => {
    assert.strictEqual(validateTaskName('jd-h5st'), null);
    assert.strictEqual(validateTaskName('douyin-sign'), null);
    assert.strictEqual(validateTaskName('a'), null);
    assert.strictEqual(validateTaskName('my-task-123'), null);
  });

  it('拒绝大写字母开头的名称', () => {
    const err = validateTaskName('MyTask');
    assert.ok(err !== null);
    assert.ok(err?.includes('以小写字母开头'));
  });

  it('拒绝包含下划线的名称', () => {
    const err = validateTaskName('my_task');
    assert.ok(err !== null);
    assert.ok(err?.includes('下划线') || err?.includes('只能包含'));
  });

  it('拒绝包含空格的名称', () => {
    const err = validateTaskName('my task');
    assert.ok(err !== null);
  });

  it('拒绝纯数字的名称', () => {
    const err = validateTaskName('123');
    assert.ok(err !== null);
  });

  it('错误消息包含示例', () => {
    const err = validateTaskName('INVALID');
    assert.ok(err?.includes('jd-h5st'));
  });
});

describe('validateUrl', () => {
  it('接受有效 URL', () => {
    assert.strictEqual(validateUrl('https://example.com'), null);
    assert.strictEqual(validateUrl('http://127.0.0.1:9222'), null);
    assert.strictEqual(validateUrl('https://m.jd.com/path?a=1'), null);
  });

  it('undefined 返回 null', () => {
    assert.strictEqual(validateUrl(undefined), null);
  });

  it('空字符串返回 null（不校验）', () => {
    assert.strictEqual(validateUrl(''), null);
  });

  it('拒绝无效 URL', () => {
    const err = validateUrl('not-a-url');
    assert.ok(err !== null);
    assert.ok(err?.includes('not-a-url'));
  });

  it('拒绝缺少协议的 URL', () => {
    const err = validateUrl('example.com');
    // URL constructor requires protocol
    assert.ok(err !== null);
  });
});

describe('scaffoldCommand', () => {
  function makeTempDir(): string {
    return mkdtempSync(join(tmpdir(), 'scaffold-test-'));
  }

  it('创建完整的任务脚手架', async () => {
    const tempDir = makeTempDir();
    const taskName = 'test-task';

    await scaffoldCommand({
      name: taskName,
      desc: 'Test task description',
      url: 'https://example.com/api',
      output: tempDir,
    });

    const taskDir = join(tempDir, taskName);

    // 验证所有文件都已创建
    assert.ok(existsSync(join(taskDir, 'config.json')), 'config.json 应存在');
    assert.ok(existsSync(join(taskDir, 'README.md')), 'README.md 应存在');
    assert.ok(existsSync(join(taskDir, 'hook.js')), 'hook.js 应存在');
    assert.ok(existsSync(join(taskDir, 'bundle.js')), 'bundle.js 应存在');

    // 验证 config.json 内容
    const config = JSON.parse(
      readFileSync(join(taskDir, 'config.json'), 'utf-8'),
    );
    assert.strictEqual(config.name, taskName);
    assert.strictEqual(config.description, 'Test task description');
    assert.strictEqual(config.url, 'https://example.com/api');
    assert.ok(config.createdAt);

    // 验证 hook.js 包含 IIFE 和示例代码
    const hookJs = readFileSync(join(taskDir, 'hook.js'), 'utf-8');
    assert.ok(hookJs.includes('(function ()'));
    assert.ok(hookJs.includes("'use strict'"));
    assert.ok(hookJs.includes('console.log'));
    assert.ok(hookJs.includes('[test-task] Hook loaded'));

    // 验证 bundle.js 包含导出和测试入口
    const bundleJs = readFileSync(join(taskDir, 'bundle.js'), 'utf-8');
    assert.ok(bundleJs.includes('function test_task'));
    assert.ok(bundleJs.includes('require.main === module'));
    assert.ok(bundleJs.includes('module.exports'));

    // 验证 README.md 包含任务名称和 URL
    const readme = readFileSync(join(taskDir, 'README.md'), 'utf-8');
    assert.ok(readme.includes('# test-task'));
    assert.ok(readme.includes('https://example.com/api'));

    // 清理
    rmSync(tempDir, {recursive: true, force: true});
  });

  it('使用默认描述和空 URL', async () => {
    const tempDir = makeTempDir();

    await scaffoldCommand({
      name: 'minimal-task',
      output: tempDir,
    });

    const taskDir = join(tempDir, 'minimal-task');
    const config = JSON.parse(
      readFileSync(join(taskDir, 'config.json'), 'utf-8'),
    );

    assert.strictEqual(config.description, 'New task');
    assert.strictEqual(config.url, '');

    rmSync(tempDir, {recursive: true, force: true});
  });

  it('bundle.js 使用下划线替换连字符', async () => {
    const tempDir = makeTempDir();

    await scaffoldCommand({
      name: 'my-complex-task',
      output: tempDir,
    });

    const bundleJs = readFileSync(
      join(tempDir, 'my-complex-task', 'bundle.js'),
      'utf-8',
    );
    assert.ok(bundleJs.includes('function my_complex_task'));
    assert.ok(bundleJs.includes('module.exports = { my_complex_task }'));

    rmSync(tempDir, {recursive: true, force: true});
  });

  it('hook.js 包含正确的许可证头', async () => {
    const tempDir = makeTempDir();

    await scaffoldCommand({
      name: 'license-test',
      output: tempDir,
    });

    const hookJs = readFileSync(
      join(tempDir, 'license-test', 'hook.js'),
      'utf-8',
    );
    const bundleJs = readFileSync(
      join(tempDir, 'license-test', 'bundle.js'),
      'utf-8',
    );

    assert.ok(hookJs.includes('@license'));
    assert.ok(hookJs.includes('SPDX-License-Identifier: Apache-2.0'));
    assert.ok(bundleJs.includes('@license'));
    assert.ok(bundleJs.includes('SPDX-License-Identifier: Apache-2.0'));

    rmSync(tempDir, {recursive: true, force: true});
  });
});
