/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, 'cliDefinitions.ts');

/**
 * 工具类别标签 - 与 tools/categories.ts 保持一致
 */
const labels: Record<string, string> = {
  逆向工程: '逆向工程',
  代码分析: '代码分析',
  调试工具: '调试工具',
  网络监控: '网络监控',
  页面自动化: '页面自动化',
  性能分析: '性能分析',
};

interface CliOption {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: unknown;
  enum?: unknown[];
}

interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema | unknown>;
  required?: string[];
  default?: unknown;
  enum?: unknown[];
  items?: JsonSchema;
}

/**
 * 将 JSON Schema 转换为 CLI 选项定义
 */
export function schemaToCLIOptions(schema: JsonSchema): CliOption[] {
  if (!schema || !schema.properties) {
    return [];
  }
  const required = schema.required || [];
  const properties = schema.properties as Record<string, JsonSchema>;
  return Object.entries(properties).map(([name, prop]) => {
    const isRequired = required.includes(name);
    const description = (prop.description as string) || '';

    // 处理数组类型
    let typeStr: string;
    const propType = prop.type as string | string[] | undefined;
    if (Array.isArray(propType)) {
      typeStr = propType.includes('string') ? 'string' : propType[0]!;
    } else if (propType === 'array') {
      typeStr = 'array';
    } else if (typeof propType !== 'string') {
      typeStr = 'string';
    } else {
      typeStr = propType;
    }

    return {
      name,
      type: typeStr,
      description,
      required: isRequired,
      default: prop.default,
      enum: prop.enum,
    };
  });
}

/**
 * 从 MCP Server 获取工具定义
 */
async function fetchTools() {
  console.log('连接 MCP Server 获取工具定义...');

  // 构建后的路径：build/src/bin/generate-cli.js -> build/src/index.js
  const serverPath = path.join(__dirname, '../index.js');

  if (!fs.existsSync(serverPath)) {
    throw new Error(
      `MCP Server 不存在：${serverPath}\n请先运行 'npm run build'`,
    );
  }

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined),
    ) as Record<string, string>,
  });

  const client = new Client(
    {
      name: 'js-reverse-cli-generator',
      version: '0.1.0',
    },
    {
      capabilities: {},
    },
  );

  await client.connect(transport);
  try {
    const toolsResponse = await client.listTools();
    if (!toolsResponse.tools?.length) {
      throw new Error('未获取到任何工具定义');
    }
    const tools = toolsResponse.tools || [];
    console.log(`获取到 ${tools.length} 个工具`);
    return tools;
  } finally {
    await client.close();
  }
}

/**
 * 获取工具的类别（从工具名称前缀或注解推断）
 */
function inferToolCategory(toolName: string): string {
  // 根据工具名称前缀推断类别
  if (
    toolName.startsWith('click') ||
    toolName.startsWith('fill') ||
    toolName.startsWith('type') ||
    toolName.startsWith('press')
  ) {
    return '输入自动化';
  }
  if (
    toolName.startsWith('navigate') ||
    toolName.startsWith('select_page') ||
    toolName.startsWith('close_page') ||
    toolName.startsWith('list_pages')
  ) {
    return '导航自动化';
  }
  if (
    toolName.startsWith('list_network') ||
    toolName.startsWith('get_network')
  ) {
    return '网络监控';
  }
  if (
    toolName.startsWith('list_console') ||
    toolName.startsWith('get_console') ||
    toolName.startsWith('take_snapshot') ||
    toolName.startsWith('take_screenshot')
  ) {
    return '调试工具';
  }
  if (
    toolName.startsWith('performance') ||
    toolName.startsWith('take_memory')
  ) {
    return '性能分析';
  }
  if (toolName.startsWith('emulate') || toolName.startsWith('resize_page')) {
    return '模拟';
  }
  if (
    toolName.startsWith('observe') ||
    toolName.startsWith('hook') ||
    toolName.startsWith('rebuild')
  ) {
    return '逆向工程';
  }

  return '调试工具'; // 默认类别
}

async function generateCli() {
  const tools = await fetchTools();

  // 按名称排序工具
  const sortedTools = tools
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(tool => {
      // 过滤掉不适合 CLI 的工具
      if (tool.name === 'fill_form') {
        return false;
      }
      if (tool.name === 'wait_for') {
        return false;
      }
      return true;
    });

  const commands: Record<
    string,
    {description: string; category: string; args: Record<string, CliOption>}
  > = {};

  for (const tool of sortedTools) {
    const options = schemaToCLIOptions(tool.inputSchema);
    const args: Record<string, CliOption> = {};
    for (const opt of options) {
      args[opt.name] = opt;
    }

    // 推断类别（如果没有注解）
    const category =
      labels[tool.annotations?.category as keyof typeof labels] ||
      inferToolCategory(tool.name);

    if (!tool.description) {
      console.warn(`警告：工具 ${tool.name} 缺少描述`);
    }

    commands[tool.name] = {
      description: tool.description || '执行工具',
      category,
      args,
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
