/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Combo URL 解析器（CDN 合并请求）
 *
 * 很多 CDN（g.alicdn.com、s.taobao.com、z-cdn.baidu.com 等）使用 `??` 语法
 * 将多个资源合并请求：
 *
 *   https://g.alicdn.com/??lib/libA/1.0.0/a.js,lib/libB/2.0.0/b.js,lib/libC/3.0.0/c.js
 *                          ▲ 分隔  ▲ 子文件1            ▲ 子文件2         ▲ 子文件3
 *
 * collector 默认按 URL 粒度去重/采集，会把整条 combo URL 当 1 条记录，
 * search_in_scripts 虽然能命中 content，但用户拿不到 "原来是哪个子库" 的线索。
 *
 * 本模块提供纯函数，从 URL 里抽出：
 *   - isComboUrl(url)             : 是否 combo
 *   - parseComboUrl(url)          : 拆出每个子 URL
 *   - findMatchingSubFile(url, p) : 基于 URL pattern 反查命中子库（启发式）
 */

/**
 * 识别是否 combo URL
 * 规则：path 段里出现 `??`，两侧都有合法路径字符
 */
export function isComboUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname.includes('??') || u.search.includes('??');
  } catch {
    return /\/\?\?[A-Za-z0-9]/.test(url);
  }
}

export interface ComboUrlInfo {
  /** 原始 combo URL */
  raw: string;
  /** CDN host，如 g.alicdn.com */
  host: string;
  /** ??前的路径前缀，可能为空 */
  prefix: string;
  /** 拆分出来的每个子文件路径（不带 host） */
  subPaths: string[];
  /** 拼合成完整 URL 的子文件列表 */
  subUrls: string[];
}

/**
 * 解析 combo URL。
 * 非 combo URL 返回 undefined。
 *
 * 例：
 *   https://g.alicdn.com/??lib/a.js,lib/b.js
 *     → {host:'g.alicdn.com', prefix:'', subPaths:['lib/a.js','lib/b.js']}
 *
 *   https://g.alicdn.com/common/???v=1&??a.js,b.js  ← 极罕见，保守处理
 */
export function parseComboUrl(url: string): ComboUrlInfo | undefined {
  if (!isComboUrl(url)) {
    return undefined;
  }

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }

  const path = u.pathname;
  const idx = path.indexOf('??');
  if (idx === -1) {
    return undefined;
  }

  const prefix = path.slice(0, idx).replace(/^\//, '').replace(/\/$/, '');
  const afterMarker = path.slice(idx + 2);
  // combo 子文件之间用逗号分隔；忽略空段
  const subPaths = afterMarker
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (subPaths.length === 0) {
    return undefined;
  }

  const subUrls = subPaths.map(sub => {
    // 子路径如 "lib/a.js"，拼成 https://host/prefix/lib/a.js
    const joinedPath = [prefix, sub].filter(Boolean).join('/');
    return `${u.protocol}//${u.host}/${joinedPath}`;
  });

  return {
    raw: url,
    host: u.host,
    prefix,
    subPaths,
    subUrls,
  };
}

/**
 * 在 combo URL 的子文件列表中，用 pattern 做子串/正则反查。
 * 用于 search_in_scripts 命中 combo 后回填 "最可能的子库"。
 *
 * 匹配优先级：
 *   1) 子路径完全等于 pattern
 *   2) 子路径包含 pattern（大小写不敏感）
 *   3) 把 pattern 当 regex 尝试匹配子路径
 */
export function findMatchingSubFile(
  url: string,
  pattern: string,
): string[] {
  const info = parseComboUrl(url);
  if (!info) return [];

  const exactHits: string[] = [];
  const includeHits: string[] = [];
  const regexHits: string[] = [];
  const lowerPattern = pattern.toLowerCase();

  let regex: RegExp | undefined;
  try {
    regex = new RegExp(pattern, 'i');
  } catch {
    regex = undefined;
  }

  for (const sub of info.subPaths) {
    if (sub === pattern) {
      exactHits.push(sub);
      continue;
    }
    if (sub.toLowerCase().includes(lowerPattern)) {
      includeHits.push(sub);
      continue;
    }
    if (regex && regex.test(sub)) {
      regexHits.push(sub);
    }
  }

  return [...exactHits, ...includeHits, ...regexHits];
}
