/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ListInjectScriptsResult} from './types.js';
import {getInjectConfigStore} from './createInjectScript.js';

/**
 * 列出所有已配置的注入脚本（纯函数版本）。
 *
 * 返回所有脚本配置，包括 URL 匹配规则、启用状态和代码大小。
 *
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export function listInjectScripts(): ListInjectScriptsResult {
  const injectConfigs = getInjectConfigStore();

  if (injectConfigs.size === 0) {
    return {
      success: true,
      message: '暂无注入脚本配置',
      tooltype: 'list_inject_scripts',
      logFormat: 'json',
      data: {total: 0, scripts: []},
    };
  }

  const scripts = Array.from(injectConfigs.values()).map((config) => ({
    id: config.id,
    name: config.name,
    urlPattern: config.urlPattern,
    enabled: config.enabled,
    codeSize: new TextEncoder().encode(config.code).length,
  }));

  return {
    success: true,
    message: `共 ${injectConfigs.size} 个注入脚本配置`,
    tooltype: 'list_inject_scripts',
    logFormat: 'json',
    data: {total: injectConfigs.size, scripts},
  };
}
