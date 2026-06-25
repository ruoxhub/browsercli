/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {MessagesResult} from '../shared/types.js';

/**
 * 代码模板纯函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface CodeTemplateResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat?: string;
}

/** getCodeTemplate 返回数据 */
export interface GetCodeTemplateData {
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
 * 获取模板结果 — 纯 Node.js 函数返回，不依赖 Puppeteer。
 */
export interface GetCodeTemplateResult extends CodeTemplateResult<GetCodeTemplateData> {
  tooltype: 'get_code_template';
}

/** injectCodeTemplate 返回数据 */
export interface InjectCodeTemplateData {
  /** 模板名称（英文 key） */
  name: string;
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
export interface InjectCodeTemplateResult extends CodeTemplateResult<InjectCodeTemplateData> {
  tooltype: 'inject_code_template';
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