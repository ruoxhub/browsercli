/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {getInjectConfigStore} from './createInjectScript.js';
import type {UpdateInjectScriptResult} from './types.js';

/**
 * 更新注入脚本配置（纯函数版本）。
 *
 * 修改已有脚本的名称、URL 匹配模式、代码或启用状态。
 *
 * @param id - 脚本 ID
 * @param options - 可选更新字段
 * @param options.name - 新名称
 * @param options.urlPattern - 新 URL 匹配模式
 * @param options.code - 新代码
 * @param options.enabled - 新的启用状态
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export function updateInjectScript(
  id: string,
  options?: {
    name?: string;
    urlPattern?: string;
    code?: string;
    enabled?: boolean;
  },
): UpdateInjectScriptResult {
  const injectConfigs = getInjectConfigStore();
  const config = injectConfigs.get(id);

  if (!config) {
    return {
      success: false,
      message: `未找到 ID 为 "${id}" 的注入脚本`,
      tooltype: 'update_inject_script',
      logFormat: 'json',
    };
  }

  if (options?.name !== undefined) config.name = options.name;
  if (options?.urlPattern !== undefined) config.urlPattern = options.urlPattern;
  if (options?.code !== undefined) config.code = options.code;
  if (options?.enabled !== undefined) config.enabled = options.enabled;

  return {
    success: true,
    message: `注入脚本 "${config.name}" 已更新`,
    tooltype: 'update_inject_script',
    logFormat: 'json',
    data: {id, name: config.name, enabled: config.enabled},
  };
}
