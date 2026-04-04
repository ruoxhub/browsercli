/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, 'cliDefinitions.ts');
const TOOLS_DIR = path.join(__dirname, '..', 'tools');

/**
 * 工具类别标签 - 与 tools/categories.ts 保持一致
 */
const labels: Record<string, string> = {
  reverse: '逆向工程',
  analysis: '代码分析',
  debug: '调试工具',
  network: '网络监控',
  automation: '页面自动化',
  performance: '性能分析',
};

interface CliOption {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: unknown;
  enum?: unknown[];
}

interface ToolDef {
  name: string;
  description: string;
  category?: string;
  args: Record<string, CliOption>;
}

/**
 * 从工具文件中提取定义
 */
function extractToolDefs(): ToolDef[] {
  const tools: ToolDef[] = [];

  if (!fs.existsSync(TOOLS_DIR)) {
    console.warn(`工具目录不存在：${TOOLS_DIR}`);
    return tools;
  }

  const files = fs.readdirSync(TOOLS_DIR);
  for (const file of files) {
    if (
      !file.endsWith('.ts') ||
      file === 'index.ts' ||
      file === 'categories.ts'
    ) {
      continue;
    }

    const toolName = file.replace('.ts', '');
    const filePath = path.join(TOOLS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    // 尝试从 defineTool 调用中提取信息
    const nameMatch = content.match(/name:\s*['"]([^'"]+)['"]/);
    const descMatch = content.match(/description:\s*['"]([^'"]+)['"]/);
    const categoryMatch = content.match(/category:\s*['"]([^'"]+)['"]/);

    const toolNameExtracted = nameMatch?.[1] || toolName;
    const description = descMatch?.[1] || `${toolNameExtracted} tool`;
    const category = categoryMatch?.[1] || 'general';

    // 提取参数（从 schema 中）
    const args: Record<string, CliOption> = {};

    // 简单的参数提取：查找 schema 中的字段定义
    const fieldMatches = content.matchAll(
      /(\w+):\s*z\.(string|number|boolean)\(\)/g,
    );
    for (const match of fieldMatches) {
      const fieldName = match[1];
      const fieldType = match[2];
      if (fieldName && fieldType) {
        args[fieldName] = {
          name: fieldName,
          type: fieldType,
          description: `${fieldName} parameter`,
          required: true,
        };
      }
    }

    // 过滤掉不适合 CLI 的工具
    if (toolName === 'fill_form' || toolName === 'wait_for') {
      continue;
    }

    tools.push({
      name: toolNameExtracted,
      description,
      category: labels[category] || category,
      args,
    });
  }

  return tools;
}

async function generateCli() {
  const tools = extractToolDefs();

  // 按名称排序工具
  const sortedTools = tools.sort((a, b) => a.name.localeCompare(b.name));

  const commands: Record<
    string,
    {description: string; category: string; args: Record<string, CliOption>}
  > = {};

  for (const tool of sortedTools) {
    commands[tool.name] = {
      description: tool.description,
      category: tool.category,
      args: tool.args,
    };
  }

  // 生成 TypeScript 代码
  const output = `/**
 * @license
 * Copyright ${new Date().getFullYear()} Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// 注意：此文件由脚本自动生成，不要手动编辑
// 运行 'npm run cli:generate' 更新此文件

export interface ArgDef {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: string | number | boolean;
  enum?: ReadonlyArray<string | number>;
}

export type Commands = Record<
  string,
  {
    description: string;
    category: string;
    args: Record<string, ArgDef>;
  }
>;

export const commands: Commands = ${JSON.stringify(commands, null, 2)} as const;
`;

  fs.mkdirSync(path.dirname(OUTPUT_PATH), {recursive: true});
  fs.writeFileSync(OUTPUT_PATH, output);
  console.log(`CLI 定义已生成：${OUTPUT_PATH}`);
}

generateCli().catch(err => {
  console.error('生成 CLI 定义时出错:', err);
  process.exit(1);
});

/**
 * 从 JSON Schema 提取 CLI 选项
 */
export function schemaToCLIOptions(schema: Record<string, unknown>): Array<{
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: unknown;
  enum?: unknown[];
}> {
  const options: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
    default?: unknown;
    enum?: unknown[];
  }> = [];

  const properties = schema.properties as Record<string, unknown>;
  const required = (schema.required as string[]) || [];

  if (!properties) {
    return options;
  }

  for (const [name, prop] of Object.entries(properties)) {
    const field = prop as Record<string, unknown>;
    let fieldType = field.type as string | string[] | undefined;

    // 处理联合类型：type: ['string', 'null'] -> 取第一个非 null 类型
    if (Array.isArray(fieldType)) {
      fieldType =
        fieldType.find(t => t !== 'null' && t !== 'undefined') ||
        fieldType[0] ||
        'string';
    }

    const type = (fieldType as string) || 'string';
    const description = (field.description as string) || `${name} parameter`;
    const defaultVal = field.default;
    const enumVal = field.enum as unknown[] | undefined;

    options.push({
      name,
      type,
      description,
      required: required.includes(name),
      ...(defaultVal !== undefined && {default: defaultVal}),
      ...(enumVal && {enum: enumVal}),
    });
  }

  return options;
}
