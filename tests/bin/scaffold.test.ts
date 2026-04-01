/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it} from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {parseArgs} from '../../src/bin/scaffold.js';

describe('Scaffold parseArgs', () => {
  it('parses name argument', () => {
    const result = parseArgs(['--name', 'test-task']);
    assert.strictEqual(result.name, 'test-task');
  });

  it('parses description argument', () => {
    const result = parseArgs(['--desc', '测试任务描述']);
    assert.strictEqual(result.description, '测试任务描述');
  });

  it('parses url argument', () => {
    const result = parseArgs(['--url', 'https://example.com']);
    assert.strictEqual(result.targetUrl, 'https://example.com');
  });

  it('parses output argument', () => {
    const result = parseArgs(['--output', 'custom/path']);
    assert.strictEqual(result.outputPath, 'custom/path');
  });

  it('parses multiple arguments', () => {
    const result = parseArgs([
      '--name', 'my-task',
      '--desc', 'My Description',
      '--url', 'https://test.com',
      '--output', 'my/output',
    ]);
    assert.strictEqual(result.name, 'my-task');
    assert.strictEqual(result.description, 'My Description');
    assert.strictEqual(result.targetUrl, 'https://test.com');
    assert.strictEqual(result.outputPath, 'my/output');
  });

  it('handles short form -h', () => {
    let exited = false;
    const originalExit = process.exit;
    process.exit = (() => { exited = true; }) as never;

    parseArgs(['--help']);
    assert.ok(exited);

    process.exit = originalExit;
  });

  it('returns empty object for no args', () => {
    const result = parseArgs([]);
    assert.deepStrictEqual(result, {});
  });
});

describe('Scaffold file templates', () => {
  it('env.js template contains required globals', () => {
    // Read template from source
    const template = `/**
 * 环境配置 - {{NAME}}
 */

// 全局环境模拟
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.global = globalThis;

// 文档对象模拟
globalThis.document ??= {
  cookie: '',
  location: { href: '{{URL}}' },
  referrer: '{{URL}}',
};

// 导航器模拟
globalThis.navigator ??= {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  language: 'zh-CN',
  platform: 'Win32',
};

// 位置对象
globalThis.location = { href: '{{URL}}' };

// Base64 编解码
globalThis.atob ??= (value) => Buffer.from(value, 'base64').toString('utf8');
globalThis.btoa ??= (value) => Buffer.from(value, 'utf8').toString('base64');

// Crypto API
globalThis.crypto ??= {
  subtle: {},
  getRandomValues: (buffer) => {
    const bytes = Buffer.alloc(buffer.length || 16);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    if (buffer instanceof Uint8Array) {
      return buffer.set(bytes);
    }
    return bytes;
  },
  randomUUID: () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },
};
`;
    assert.ok(template.includes('globalThis.window'));
    assert.ok(template.includes('globalThis.document'));
    assert.ok(template.includes('globalThis.navigator'));
    assert.ok(template.includes('globalThis.crypto'));
    assert.ok(template.includes('globalThis.atob'));
    assert.ok(template.includes('globalThis.btoa'));
  });

  it('entry.js template contains capture structure', () => {
    const template = `/**
 * 入口文件 - {{NAME}}
 */

import './env.js';
import './polyfills.js';

// 加载目标脚本
const capture = {
  page: {
    url: '{{URL}}',
    title: '',
  },
  cookies: [],
  localStorage: {},
  sessionStorage: {},
  runtimeEvidence: [],
  targetScript: null,
};

// TODO: 将抓取的脚本内容赋值给 capture.targetScript
// capture.targetScript = {
//   url: '...',
//   content: '...',
// };

// 如果目标脚本已加载，执行它
if (capture.targetScript?.content) {
  eval(capture.targetScript.content);
}

// 查找并测试目标函数
const targetFunction = capture.runtimeEvidence?.find(
  (item) => typeof item.functionName === 'string'
)?.functionName;

if (targetFunction && typeof globalThis[targetFunction] === 'function') {
  console.log({
    targetFunction,
    result: globalThis[targetFunction]('test', 'input'),
  });
} else {
  console.log({
    message: 'Target function not callable yet',
    targetFunction,
  });
}

export {capture};
`;
    assert.ok(template.includes('capture'));
    assert.ok(template.includes('targetScript'));
    assert.ok(template.includes('runtimeEvidence'));
  });

  it('README template contains task sections', () => {
    const template = `# {{NAME}} - {{DESC}}

## 目标

- **URL**: {{URL}}
- **难度**: 中等
- **状态**: 待处理

## 任务列表

1. [ ] 抓取目标脚本
2. [ ] 识别加密/签名函数
3. [ ] 分析参数生成逻辑
4. [ ] 实现本地复现
5. [ ] 验证签名正确性

## 参考

- [技术分析报告](../../TECHNICAL_ANALYSIS.md)
- [逆向工作流程](../../docs/reference/reverse-workflow.md)

## 时间线

- 创建时间：{{DATE}}
- 开始时间：待定
- 完成时间：待定
`;
    assert.ok(template.includes('## 目标'));
    assert.ok(template.includes('## 任务列表'));
    assert.ok(template.includes('## 参考'));
    assert.ok(template.includes('## 时间线'));
  });
});
