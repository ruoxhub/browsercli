/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool, type Context, type Response} from './ToolDefinition.js';

// Code templates migrated from v_jstools html_codes
const TEMPLATES: Record<
  string,
  {name: string; description: string; file: string}
> = {
  babel_ast: {
    name: 'Babel AST 工具',
    description:
      'Babel AST 解析和生成工具代码，包含 parser/generator/traverse/types',
    file: 'babel_asttool',
  },
  babel_pack: {
    name: 'Babel 打包',
    description: 'Babel 打包工具代码',
    file: 'babel_pack',
  },
  cryptojs: {
    name: 'CryptoJS',
    description: 'CryptoJS 加密库（AES/DES/MD5/SHA 等）',
    file: 'cryptojs',
  },
  uglify_es: {
    name: 'UglifyJS ES',
    description: 'UglifyJS 代码压缩工具',
    file: 'uglify_es',
  },
  request: {
    name: 'Request',
    description: 'HTTP 请求库',
    file: 'request',
  },
  jsencrypt: {
    name: 'JSEncrypt',
    description: 'RSA 加密/解密库',
    file: 'jsencrypt',
  },
  cheerio: {
    name: 'Cheerio',
    description: '服务端 jQuery 兼容 API（HTML 解析）',
    file: 'cheerio',
  },
  terser: {
    name: 'Terser',
    description: 'JavaScript 压缩/格式化工具',
    file: 'terser',
  },
  parse5: {
    name: 'Parse5',
    description: 'HTML 解析器（符合 WHATWG 标准）',
    file: 'parse5',
  },
  jquery: {
    name: 'jQuery',
    description: 'jQuery 核心库 + jQuery UI',
    file: 'jquery.min',
  },
  express_pack: {
    name: 'Express 打包',
    description: 'Express 框架打包代码',
    file: 'express_pack',
  },
  rpc_inject: {
    name: 'RPC 注入',
    description: 'RPC 注入模板代码',
    file: 'rpc_inject_js',
  },
  wat2wasm: {
    name: 'WAT to WASM',
    description: 'WebAssembly 文本格式转二进制',
    file: 'wat2wasm',
  },
  wasm2js: {
    name: 'WASM to JS',
    description: 'WebAssembly 转 JavaScript',
    file: 'wasm2js_demo',
  },
};

export const getCodeTemplate = defineTool({
  name: 'get_code_template',
  description:
    '获取代码模板：返回 v_jstools 中预置的常用 JS 逆向代码模板，包括 CryptoJS、JSEncrypt、Cheerio、Babel AST、Terser 等',
  aliases: ['template', 'code-template'],
  annotations: {
    title: 'Get Code Template',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    name: zod
      .enum([
        'babel_ast',
        'babel_pack',
        'cryptojs',
        'uglify_es',
        'request',
        'jsencrypt',
        'cheerio',
        'terser',
        'parse5',
        'jquery',
        'express_pack',
        'rpc_inject',
        'wat2wasm',
        'wasm2js',
      ])
      .describe('模板名称'),
  },
  handler: async (request, response, _context, _runtime) => {
    const templateName = request.params.name;
    const templateInfo = TEMPLATES[templateName];

    if (!templateInfo) {
      response.appendResponseLine(`❌ 未找到模板 "${templateName}"`);
      response.appendResponseLine('');
      response.appendResponseLine('可用模板：');
      for (const [key, info] of Object.entries(TEMPLATES)) {
        response.appendResponseLine(`  - ${key}: ${info.description}`);
      }
      return;
    }

    try {
      const templatePath = `/mnt/d/browserplugs/v_jstools/tools/model_codes/${templateInfo.file}.js`;
      const fs = await import('node:fs/promises');
      const code = await fs.readFile(templatePath, 'utf-8');

      response.appendResponseLine(`✅ 已获取模板：${templateInfo.name}`);
      response.appendResponseLine(`- ${templateInfo.description}`);
      response.appendResponseLine(
        `- 大小：${formatBytes(new TextEncoder().encode(code).length)}`,
      );
      response.appendResponseLine('');
      response.appendResponseLine('```javascript');
      response.appendResponseLine(code);
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine(
        `❌ 读取模板失败：${error instanceof Error ? error.message : String(error)}`,
      );
      response.appendResponseLine('');
      response.appendResponseLine(
        '提示：请确保 v_jstools 源码位于 /mnt/d/browserplugs/v_jstools/',
      );
    }
  },
});

export const listCodeTemplates = defineTool({
  name: 'list_code_templates',
  description:
    '列出所有可用的代码模板，包括 CryptoJS、JSEncrypt、Cheerio、Babel AST 等常用库',
  aliases: ['list-templates', 'templates'],
  annotations: {
    title: 'List Code Templates',
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
    response.appendResponseLine(
      `✅ 共 ${Object.keys(TEMPLATES).length} 个可用模板：`,
    );
    response.appendResponseLine('');
    for (const [key, info] of Object.entries(TEMPLATES)) {
      response.appendResponseLine(`- **${key}**: ${info.description}`);
    }
  },
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Byte';
  const k = 1024;
  const sizes = ['Byte', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2).replace(/\.00$/, '')} ${sizes[i]}`;
}
