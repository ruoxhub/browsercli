/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

/**
 * Script injection configuration entry
 * Migrated from v_jstools html_inject
 */
interface InjectConfigEntry {
  id: string;
  name: string;
  urlPattern: string;
  code: string;
  enabled: boolean;
}

/**
 * Storage for injection configs
 */
const injectConfigs = new Map<string, InjectConfigEntry>();
let nextId = 1;

function generateId(): string {
  return `inject_${nextId++}`;
}

function matchesUrlPattern(pattern: string, url: string): boolean {
  try {
    // Support glob-style patterns
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    );
    return regex.test(url);
  } catch {
    // If pattern is not a valid glob, try as substring
    return url.includes(pattern);
  }
}

function getMatchingConfigs(url: string): InjectConfigEntry[] {
  const matches: InjectConfigEntry[] = [];
  for (const config of injectConfigs.values()) {
    if (config.enabled && matchesUrlPattern(config.urlPattern, url)) {
      matches.push(config);
    }
  }
  return matches;
}

export const createInjectScript = defineTool({
  name: 'create_inject_script',
  description:
    '创建注入脚本：添加一个 URL 匹配的脚本配置，支持后续注入到浏览器页面',
  aliases: ['add-script', 'new-inject'],
  annotations: {
    title: 'Create Inject Script',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    name: zod.string().describe('脚本名称'),
    urlPattern: zod.string().describe('URL 匹配模式（支持 * 通配符）'),
    code: zod.string().describe('要注入的 JavaScript 代码'),
    enabled: zod.boolean().optional().default(true).describe('是否启用'),
  },
  handler: async (
    request: {
      params: {
        name: string;
        urlPattern: string;
        code: string;
        enabled?: boolean;
      };
    },
    response: Response,
    _context: Context,
    _runtime: unknown,
  ) => {
    const {name, urlPattern, code, enabled} = request.params;
    const id = generateId();
    injectConfigs.set(id, {
      id,
      name,
      urlPattern,
      code,
      enabled: enabled ?? true,
    });

    response.appendResponseLine('✅ 注入脚本已创建');
    response.appendResponseLine(`- ID: ${id}`);
    response.appendResponseLine(`- 名称: ${name}`);
    response.appendResponseLine(`- URL 匹配: ${urlPattern}`);
    response.appendResponseLine(`- 状态: ${enabled ? '已启用' : '已禁用'}`);
  },
});

export const listInjectScripts = defineTool({
  name: 'list_inject_scripts',
  description: '列出所有已配置的注入脚本，包括 URL 匹配规则和启用状态',
  aliases: ['list-scripts', 'inject-list'],
  annotations: {
    title: 'List Inject Scripts',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (
    _request: {params: Record<string, never>},
    response: Response,
    _context: Context,
    _runtime: unknown,
  ) => {
    if (injectConfigs.size === 0) {
      response.appendResponseLine('📋 暂无注入脚本配置');
      return;
    }

    response.appendResponseLine(`📋 共 ${injectConfigs.size} 个注入脚本配置：`);
    response.appendResponseLine('');
    for (const [, config] of injectConfigs) {
      const status = config.enabled ? '✅' : '❌';
      response.appendResponseLine(
        `- ${status} **${config.name}** (ID: ${config.id})`,
      );
      response.appendResponseLine(`  URL 匹配: ${config.urlPattern}`);
      response.appendResponseLine(
        `  代码长度: ${new TextEncoder().encode(config.code).length} bytes`,
      );
    }
  },
});

export const updateInjectScript = defineTool({
  name: 'update_inject_script',
  description: '更新注入脚本：修改已有脚本的代码、名称或启用状态',
  aliases: ['update-script'],
  annotations: {
    title: 'Update Inject Script',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    id: zod.string().describe('脚本 ID'),
    name: zod.string().optional().describe('新名称（可选）'),
    urlPattern: zod.string().optional().describe('新 URL 匹配模式（可选）'),
    code: zod.string().optional().describe('新代码（可选）'),
    enabled: zod.boolean().optional().describe('新的启用状态（可选）'),
  },
  handler: async (
    request: {
      params: {
        id: string;
        name?: string;
        urlPattern?: string;
        code?: string;
        enabled?: boolean;
      };
    },
    response: Response,
    _context: Context,
    _runtime: unknown,
  ) => {
    const {id, name, urlPattern, code, enabled} = request.params;
    const config = injectConfigs.get(id);

    if (!config) {
      response.appendResponseLine(`❌ 未找到 ID 为 "${id}" 的注入脚本`);
      return;
    }

    if (name !== undefined) config.name = name;
    if (urlPattern !== undefined) config.urlPattern = urlPattern;
    if (code !== undefined) config.code = code;
    if (enabled !== undefined) config.enabled = enabled;

    response.appendResponseLine(`✅ 注入脚本 "${config.name}" 已更新`);
    response.appendResponseLine(`- ID: ${id}`);
    response.appendResponseLine(
      `- 状态: ${config.enabled ? '已启用' : '已禁用'}`,
    );
  },
});

export const deleteInjectScript = defineTool({
  name: 'delete_inject_script',
  description: '删除注入脚本：移除指定的脚本配置',
  aliases: ['delete-script', 'remove-script'],
  annotations: {
    title: 'Delete Inject Script',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    id: zod.string().describe('要删除的脚本 ID'),
  },
  handler: async (
    request: {params: {id: string}},
    response: Response,
    _context: Context,
    _runtime: unknown,
  ) => {
    const {id} = request.params;
    const config = injectConfigs.get(id);

    if (!config) {
      response.appendResponseLine(`❌ 未找到 ID 为 "${id}" 的注入脚本`);
      return;
    }

    injectConfigs.delete(id);
    response.appendResponseLine(`✅ 注入脚本 "${config.name}" 已删除`);
  },
});

export const checkUrlMatches = defineTool({
  name: 'check_url_matches',
  description: '检查 URL 匹配：测试给定 URL 会触发哪些已配置的注入脚本',
  aliases: ['check-matches', 'test-url'],
  annotations: {
    title: 'Check URL Matches',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    url: zod.string().describe('要测试的 URL'),
  },
  handler: async (
    request: {params: {url: string}},
    response: Response,
    _context: Context,
    _runtime: unknown,
  ) => {
    const {url} = request.params;
    const matches = getMatchingConfigs(url);

    if (matches.length === 0) {
      response.appendResponseLine(`🔍 URL "${url}" 没有匹配的注入脚本`);
      return;
    }

    response.appendResponseLine(
      `🔍 URL "${url}" 匹配到 ${matches.length} 个注入脚本：`,
    );
    response.appendResponseLine('');
    for (const config of matches) {
      response.appendResponseLine(`- ✅ **${config.name}** (ID: ${config.id})`);
    }
  },
});
