#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import readline from 'node:readline';

/**
 * 脚手架配置
 */
interface ScaffoldConfig {
  name: string;
  description: string;
  targetUrl: string;
  outputPath: string;
  tasks: string[];
}

const HELP_TEXT = `
JS Reverse MCP - 脚手架生成器
============================

用法：js-reverse scaffold [选项]

选项:
  --name <名称>           任务名称（必填）
  --desc <描述>           任务描述
  --url <URL>             目标网站 URL
  --output <路径>         输出目录（默认：artifacts/tasks/<name>）
  --tasks <任务列表>       任务列表，逗号分隔

示例:
  js-reverse scaffold --name jd-h5st --desc "京东 H5ST 签名逆向" --url "https://m.jd.com"
  js-reverse scaffold --name douyin-xbogus --desc "抖音 XBogus 签名" --url "https://www.douyin.com"
`;

const TASK_TEMPLATE = {
  envJs: `/**
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
`,
  polyfillsJs: `/**
 * Polyfills - {{NAME}}
 *
 * 在此添加目标网站特定的 polyfill 代码
 */

// 示例：如果目标网站使用了自定义加密函数，在这里添加桩实现

// 示例 Hook 点
// - JSON.stringify / JSON.parse
// - crypto.subtle.digest
// - 自定义加密/解密函数

console.log('[polyfills] {{NAME}} polyfills loaded');
`,
  entryJs: `/**
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
`,
  readmeMd: `# {{NAME}} - {{DESC}}

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
`,
  runScript: `#!/usr/bin/env node

/**
 * 运行脚本 - {{NAME}}
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const execAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('Running {{NAME}} entry point...');

  const result = await execAsync('node', ['entry.js'], {
    cwd: __dirname,
  });

  console.log('stdout:', result.stdout);
  if (result.stderr) {
    console.error('stderr:', result.stderr);
  }
}

main().catch(console.error);
`,
};

/**
 * 创建任务脚手架
 */
async function createScaffold(config: ScaffoldConfig): Promise<void> {
  const outputDir = config.outputPath || path.join('artifacts/tasks', config.name);

  console.log(`📦 创建任务脚手架：${config.name}`);
  console.log(`   描述：${config.description}`);
  console.log(`   目标：${config.targetUrl}`);
  console.log(`   输出：${outputDir}`);
  console.log('');

  // 创建目录结构
  const dirs = ['', 'run', 'env', 'network', 'replay', 'scripts'];
  for (const dir of dirs) {
    const fullPath = path.join(outputDir, dir);
    fs.mkdirSync(fullPath, {recursive: true});
  }

  // 替换模板变量
  const replaceTemplate = (content: string): string => {
    return content
      .replace(/\{\{NAME\}\}/g, config.name)
      .replace(/\{\{DESC\}\}/g, config.description)
      .replace(/\{\{URL\}\}/g, config.targetUrl)
      .replace(/\{\{DATE\}\}/g, new Date().toISOString().split('T')[0]);
  };

  // 写入文件
  const files = [
    {path: 'task.json', content: JSON.stringify({
      name: config.name,
      description: config.description,
      targetUrl: config.targetUrl,
      difficulty: 'medium',
      status: 'pending',
      createdAt: new Date().toISOString(),
    }, null, 2)},
    {path: 'env/env.js', content: replaceTemplate(TASK_TEMPLATE.envJs)},
    {path: 'env/polyfills.js', content: replaceTemplate(TASK_TEMPLATE.polyfillsJs)},
    {path: 'entry.js', content: replaceTemplate(TASK_TEMPLATE.entryJs)},
    {path: 'README.md', content: replaceTemplate(TASK_TEMPLATE.readmeMd)},
    {path: 'run/run-local.mjs', content: replaceTemplate(TASK_TEMPLATE.runScript)},
  ];

  for (const file of files) {
    const filePath = path.join(outputDir, file.path);
    fs.writeFileSync(filePath, file.content);
    console.log(`   ✅ ${file.path}`);
  }

  // 创建 .gitignore
  const gitignore = `node_modules/
*.log
.DS_Store
dist/
build/
`;
  fs.writeFileSync(path.join(outputDir, '.gitignore'), gitignore);
  console.log('   ✅ .gitignore');

  console.log('');
  console.log(`🎉 脚手架创建完成！`);
  console.log(`   下一步:`);
  console.log(`   1. cd ${outputDir}`);
  console.log(`   2. 编辑 env/env.js 配置目标环境`);
  console.log(`   3. 使用 js-reverse start 启动 daemon`);
  console.log(`   4. 使用 js-reverse call-skill observe-flow --url ${config.targetUrl} 开始分析`);
}

/**
 * 交互式创建
 */
async function interactiveCreate(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  console.log('🛠️  JS Reverse MCP - 交互式脚手架生成器');
  console.log('');

  const name = await question('任务名称（如 jd-h5st）: ');
  if (!name) {
    console.log('❌ 任务名称不能为空');
    rl.close();
    return;
  }

  // 验证任务名称格式（防止路径遍历和非法字符）
  const SAFE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
  if (!SAFE_NAME_PATTERN.test(name)) {
    console.log('❌ 任务名称只能以小写字母开头，包含小写字母、数字和连字符');
    rl.close();
    return;
  }

  const desc = await question('任务描述: ');
  const url = await question('目标 URL: ');

  await createScaffold({
    name,
    description: desc || '未命名任务',
    targetUrl: url || 'https://example.com',
    outputPath: '',
    tasks: [],
  });

  rl.close();
}

/**
 * 解析命令行参数
 */
export function parseArgs(args: string[]): Partial<ScaffoldConfig> {
  const result: Partial<ScaffoldConfig> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--name':
        result.name = next;
        i++;
        break;
      case '--desc':
        result.description = next;
        i++;
        break;
      case '--url':
        result.targetUrl = next;
        i++;
        break;
      case '--output':
        result.outputPath = next;
        i++;
        break;
      case '--tasks':
        result.tasks = next?.split(',') || [];
        i++;
        break;
      case '--help':
      case '-h':
        console.log(HELP_TEXT);
        process.exit(0);
    }
  }

  return result;
}

/**
 * 主函数
 */
export async function runScaffold(args: string[]): Promise<void> {
  const config = parseArgs(args);

  if (!config.name) {
    // 交互模式
    await interactiveCreate();
    return;
  }

  if (!config.description) {
    config.description = '未命名任务';
  }

  if (!config.targetUrl) {
    config.targetUrl = 'https://example.com';
  }

  await createScaffold(config as ScaffoldConfig);
}
