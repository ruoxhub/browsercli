/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {DaemonContext} from '../types.js';
import {AxiError} from '../errors.js';
import {parseArgs, getFlag} from '../args-parser.js';
import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';

const TASK_NAME_RE = /^[a-z][a-z0-9-]*$/;

// JavaScript reserved words that cannot be used as function names
const RESERVED_WORDS = new Set([
  'break',
  'case',
  'catch',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'class',
  'const',
  'enum',
  'let',
  'static',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
]);

export const scaffoldCommand: AxiCliCommand<DaemonContext> = async (
  args,
  _ctx,
) => {
  const parsed = parseArgs(args);
  const name = getFlag(parsed, 'name');
  const desc = getFlag(parsed, 'desc', 'New task');
  const url = getFlag(parsed, 'url');
  const output = getFlag(parsed, 'output');

  if (!name) {
    throw new AxiError('缺少 --name 参数', 'VALIDATION_ERROR', [
      '用法：js-reverse scaffold --name <task-name> [--desc <desc>] [--url <url>]',
    ]);
  }

  if (!TASK_NAME_RE.test(name)) {
    throw new AxiError(
      '名称必须以小写字母开头，只能包含小写字母、数字和连字符',
      'VALIDATION_ERROR',
      ['示例：jd-h5st、douyin-sign、taobao-mtop'],
    );
  }

  if (RESERVED_WORDS.has(name)) {
    throw new AxiError(
      `名称 "${name}" 是 JavaScript 保留字，不能使用`,
      'VALIDATION_ERROR',
      ['请选择其他名称：jd-h5st、douyin-sign、taobao-mtop'],
    );
  }

  if (url) {
    try {
      new URL(url);
    } catch {
      throw new AxiError(`无效的 URL 格式：${url}`, 'VALIDATION_ERROR');
    }
  }

  const taskDir = output
    ? join(output, name)
    : join(process.cwd(), 'tasks', name);

  try {
    if (existsSync(taskDir)) {
      // Directory exists, will overwrite configs
    } else {
      mkdirSync(taskDir, {recursive: true});
    }

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
})();
`;

    writeFileSync(join(taskDir, 'hook.js'), hookTemplate);

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

    // Return user-friendly success message (not JSON) for CLI output
    return `任务脚手架创建成功！

📁 目录: ${taskDir}
📄 文件: config.json, README.md, hook.js, bundle.js

⚡ 下一步:
   cd ${taskDir}
   # 编辑 hook.js 实现 Hook 逻辑
   # 编辑 bundle.js 实现签名算法
`;
  } catch (error) {
    if (error instanceof AxiError) throw error;
    throw new AxiError(
      `创建失败：${error instanceof Error ? error.message : error}`,
      'SCAFFOLD_ERROR',
    );
  }
};
