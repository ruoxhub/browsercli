#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';

const TASK_NAME_RE = /^[a-z][a-z0-9-]*$/;
const TASK_NAME_EXAMPLES = 'jd-h5st、douyin-sign、taobao-mtop';

export function validateTaskName(name: string): string | null {
  if (!TASK_NAME_RE.test(name)) {
    return `名称必须以小写字母开头，只能包含小写字母、数字和连字符。正确示例：${TASK_NAME_EXAMPLES}`;
  }
  return null;
}

export function validateUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    new URL(url);
    return null;
  } catch {
    return `无效的 URL 格式：${url}`;
  }
}

export async function scaffoldCommand(options: {
  name: string;
  desc?: string;
  url?: string;
  output?: string;
}): Promise<void> {
  const {name, desc = 'New task', url, output} = options;

  // 验证名称格式
  const nameError = validateTaskName(name);
  if (nameError) {
    console.error(`错误：${nameError}`);
    process.exit(1);
  }

  // 验证 URL 格式
  const urlError = validateUrl(url);
  if (urlError) {
    console.error(`错误：${urlError}`);
    process.exit(1);
  }

  const taskDir = output
    ? join(output, name)
    : join(process.cwd(), 'tasks', name);

  try {
    // 检查任务目录是否已存在
    if (existsSync(taskDir)) {
      console.warn(`警告：任务目录已存在：${taskDir}`);
      console.warn('将覆盖现有配置文件');
    } else {
      mkdirSync(taskDir, {recursive: true});
    }

    // 创建配置文件
    const configContent = {
      name,
      description: desc,
      url: url || '',
      createdAt: new Date().toISOString(),
    };

    writeFileSync(
      join(taskDir, 'config.json'),
      JSON.stringify(configContent, null, 2),
    );

    // 创建 README
    const readmeContent = `# ${name}

${desc}

## 配置

- URL: ${url || '待配置'}
- 创建时间：${new Date().toISOString()}

## 使用说明

\`\`\`bash
js-reverse call-skill <skill-name> --url ${url || 'https://example.com'}
\`\`\`
`;

    writeFileSync(join(taskDir, 'README.md'), readmeContent);

    // 创建 Hook 脚本模板
    const hookTemplate = `/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

// ${name} - Hook 脚本
// 目标: ${url || desc}

(function () {
  'use strict';

  // TODO: 在此添加 Hook 逻辑
  console.log('[${name}] Hook loaded');

  // 示例：Hook JSON.stringify
  const originalStringify = JSON.stringify;
  JSON.stringify = function (...args) {
    const result = originalStringify.apply(this, args);
    // TODO: 添加自定义逻辑
    return result;
  };
})();
`;

    writeFileSync(join(taskDir, 'hook.js'), hookTemplate);

    // 创建 Bundle 复现模板
    const bundleTemplate = `/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

// ${name} - Node.js 环境复现脚本
// 目标: ${url || desc}

// TODO: 在此添加签名/加密算法实现

function ${name.replace(/-/g, '_')}(params) {
  // TODO: 实现逻辑
  return params;
}

// 测试
if (require.main === module) {
  console.log(${name.replace(/-/g, '_')}({test: 'value'}));
}

module.exports = { ${name.replace(/-/g, '_')} };
`;

    writeFileSync(join(taskDir, 'bundle.js'), bundleTemplate);

    console.log(`任务脚手架创建成功：${taskDir}`);
    console.log('文件:');
    console.log(`  - config.json`);
    console.log(`  - README.md`);
    console.log(`  - hook.js`);
    console.log(`  - bundle.js`);
  } catch (error) {
    console.error(
      `创建失败：${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
