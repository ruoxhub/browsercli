/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {MessagesResult} from '../shared/types.js';

// ─── 数据类型 ──────────────────────────────────────────

/** 注入脚本配置 */
export interface InjectConfigEntry {
  id: string;
  name: string;
  urlPattern: string;
  code: string;
  enabled: boolean;
}

/** 创建注入脚本返回数据 */
export interface CreateInjectScriptData {
  id: string;
  name: string;
  urlPattern: string;
  enabled: boolean;
}

/** 列出注入脚本条目 */
export interface ListInjectScriptEntry {
  id: string;
  name: string;
  urlPattern: string;
  enabled: boolean;
  codeSize: number;
}

/** 列出注入脚本返回数据 */
export interface ListInjectScriptsData {
  total: number;
  scripts: ListInjectScriptEntry[];
}

/** 更新注入脚本返回数据 */
export interface UpdateInjectScriptData {
  id: string;
  name: string;
  enabled: boolean;
}

/** 删除注入脚本返回数据 */
export interface DeleteInjectScriptData {
  id: string;
  name: string;
}

/** 匹配的注入脚本条目 */
export interface MatchedScriptEntry {
  id: string;
  name: string;
  urlPattern: string;
}

/** URL 匹配检查返回数据 */
export interface CheckUrlMatchesData {
  url: string;
  matchCount: number;
  matchedScripts: MatchedScriptEntry[];
}

// ─── 结果类型 ──────────────────────────────────────────

/**
 * Script Injector 函数统一返回结构。
 *
 * 成功时 success=true，message 包含操作描述；
 * 失败时 success=false，message 包含错误描述。
 * 所有业务数据统一放在 data 字段中。
 */
export interface ScriptInjectorResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat: string;
}

/** 创建注入脚本结果 */
export interface CreateInjectScriptResult extends ScriptInjectorResult<CreateInjectScriptData> {
  tooltype: 'create_inject_script';
}

/** 列出注入脚本结果 */
export interface ListInjectScriptsResult extends ScriptInjectorResult<ListInjectScriptsData> {
  tooltype: 'list_inject_scripts';
}

/** 更新注入脚本结果 */
export interface UpdateInjectScriptResult extends ScriptInjectorResult<UpdateInjectScriptData> {
  tooltype: 'update_inject_script';
}

/** 删除注入脚本结果 */
export interface DeleteInjectScriptResult extends ScriptInjectorResult<DeleteInjectScriptData> {
  tooltype: 'delete_inject_script';
}

/** URL 匹配检查结果 */
export interface CheckUrlMatchesResult extends ScriptInjectorResult<CheckUrlMatchesData> {
  tooltype: 'check_url_matches';
}

// ─── 重新导出 ──────────────────────────────────────────

/** 重新导出 Frame 类型，方便调用方导入 */
export type {Frame};
