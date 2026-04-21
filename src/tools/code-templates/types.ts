/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

/**
 * 代码模板纯函数统一返回结构。
 *
 * 成功时 success=true，message 包含操作确认；
 * 失败时 success=false，message 包含错误描述。
 */
export interface CodeTemplateResult {
  success: boolean;
  message: string;
  /** 工具类型标识 */
  tooltype: string;
  /** 使用的日志格式 */
  logFormat?: string;
}

/**
 * 获取模板结果 — 纯 Node.js 函数返回，不依赖 Puppeteer。
 */
export interface GetCodeTemplateResult extends CodeTemplateResult {
  /** 模板名称（英文 key） */
  name: string;
  /** 模板中文描述 */
  description: string;
  /** 模板代码内容 */
  code: string;
  /** 模板文件大小（字节） */
  sizeBytes: number;
}

/**
 * 列表项 — 单个模板的元信息。
 */
export interface CodeTemplateInfo {
  /** 模板 key */
  key: string;
  /** 模板中文描述 */
  description: string;
  /** 对应文件名（不含路径和扩展名） */
  file: string;
}

/**
 * 注入模板结果 — 依赖 Puppeteer Frame。
 */
export interface InjectCodeTemplateResult extends CodeTemplateResult {
  /** 模板名称（英文 key） */
  name: string;
}

/** 代码模板名称枚举 */
export type CodeTemplateName =
  | 'babel_ast'
  | 'babel_pack'
  | 'cryptojs'
  | 'uglify_es'
  | 'request'
  | 'jsencrypt'
  | 'cheerio'
  | 'terser'
  | 'parse5'
  | 'jquery'
  | 'express_pack'
  | 'rpc_inject'
  | 'wat2wasm'
  | 'wasm2js';

/** 重新导出 Frame 类型，方便调用方导入 */
export type {Frame};