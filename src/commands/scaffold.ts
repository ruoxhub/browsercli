#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function scaffoldCommand(options: {
  name: string;
  desc?: string;
  url?: string;
  output?: string;
}): Promise<void> {
  const {name, desc = 'New task', url, output} = options;

  // 验证名称格式
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(
      '错误：名称必须以小写字母开头，只能包含小写字母、数字和连字符',
    );
    process.exit(1);
  }

  const taskDir = output
    ? join(output, name)
    : join(process.cwd(), 'tasks', name);

  try {
    // 创建任务目录
    if (!existsSync(taskDir)) {
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

    console.log(`任务脚手架创建成功：${taskDir}`);
    console.log('文件:');
    console.log(`  - config.json`);
    console.log(`  - README.md`);
  } catch (error) {
    console.error(
      `创建失败：${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
