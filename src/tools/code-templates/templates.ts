/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CodeTemplateName, CodeTemplateInfo} from './types.js';

/** 模板元数据注册表 */
export const CODE_TEMPLATES: Record<
  CodeTemplateName,
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

/** 模板文件根目录 */
export const TEMPLATES_DIR = '/mnt/d/browserplugs/v_jstools/tools/model_codes';

/** 格式化字节数 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Byte';
  const k = 1024;
  const sizes = ['Byte', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2).replace(/\.00$/, '')} ${sizes[i]}`;
}

/** 获取所有模板列表（纯数据，无 IO） */
export function listTemplateInfos(): CodeTemplateInfo[] {
  return Object.entries(CODE_TEMPLATES).map(([key, info]) => ({
    key: key as CodeTemplateName,
    description: info.description,
    file: info.file,
  }));
}