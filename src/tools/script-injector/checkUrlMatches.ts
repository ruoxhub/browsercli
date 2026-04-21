/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CheckUrlMatchesResult} from './types.js';
import {getInjectConfigStore} from './createInjectScript.js';

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

/**
 * 检查 URL 匹配（纯函数版本）。
 *
 * 测试给定 URL 会触发哪些已配置的注入脚本。
 *
 * @param url - 要测试的 URL
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export function checkUrlMatches(url: string): CheckUrlMatchesResult {
  const injectConfigs = getInjectConfigStore();
  const matchedScripts: Array<{id: string; name: string; urlPattern: string}> = [];

  for (const config of injectConfigs.values()) {
    if (config.enabled && matchesUrlPattern(config.urlPattern, url)) {
      matchedScripts.push({
        id: config.id,
        name: config.name,
        urlPattern: config.urlPattern,
      });
    }
  }

  if (matchedScripts.length === 0) {
    return {
      success: true,
      message: `URL "${url}" 没有匹配的注入脚本`,
      tooltype: 'check_url_matches',
      logFormat: 'json',
      data: {url, matchCount: 0, matchedScripts: []},
    };
  }

  return {
    success: true,
    message: `URL "${url}" 匹配到 ${matchedScripts.length} 个注入脚本`,
    tooltype: 'check_url_matches',
    logFormat: 'json',
    data: {url, matchCount: matchedScripts.length, matchedScripts},
  };
}
