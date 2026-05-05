/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CreateInjectScriptResult,
  InjectConfigEntry,
} from './types.js';

/** 注入脚本配置存储 */
const injectConfigs = new Map<string, InjectConfigEntry>();
let nextId = 1;

function generateId(): string {
  return `inject_${nextId++}`;
}

/** 获取注入配置存储（供其他函数共享） */
export function getInjectConfigStore(): Map<string, InjectConfigEntry> {
  return injectConfigs;
}

/** 生成唯一 ID */
export function getNextId(): number {
  return nextId;
}

/** 设置 nextId（用于重置或同步） */
export function setNextId(value: number): void {
  nextId = value;
}

/**
 * 创建注入脚本配置（纯函数版本）。
 *
 * 添加一个 URL 匹配的脚本配置，不执行实际注入。
 * 搭配 injectScriptToFrame 使用可将配置注入到浏览器页面。
 *
 * @param name - 脚本名称
 * @param urlPattern - URL 匹配模式（支持 * 通配符）
 * @param code - 要注入的 JavaScript 代码
 * @param enabled - 是否启用，默认 true
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export function createInjectScript(
  name: string,
  urlPattern: string,
  code: string,
  enabled = true,
): CreateInjectScriptResult {
  const id = generateId();
  injectConfigs.set(id, {id, name, urlPattern, code, enabled});

  return {
    success: true,
    message: `注入脚本已创建: ${name}`,
    tooltype: 'create_inject_script',
    logFormat: 'json',
    data: {id, name, urlPattern, enabled},
  };
}