/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 归一化 hostname 用于域名过滤的存表与匹配（两侧都过一遍）。
 *
 * 与 `rewrite.ts::extractHost` 的区别：那个入参是完整 URL（URL → host），
 * 这个入参已经是裸 host（host → host）。调用点（handleConnect /
 * handleHttpRequest / handleWsUpgrade）拿到的都是裸 host，不要传 URL 进来。
 */
export function normalizeHost(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (!host) return '';

  // 剥 IPv6 方括号：[240c::1] → 240c::1 或 [240c::1]:8080 → 240c::1
  if (host.startsWith('[')) {
    const closeBracket = host.indexOf(']');
    if (closeBracket !== -1) {
      host = host.slice(1, closeBracket);
      return host.replace(/\.$/, '');
    }
  }
  // 去端口：仅当包含最多一个冒号时（避免砍掉裸 IPv6 如 240c::1 的尾段十六进制）
  const firstColon = host.indexOf(':');
  const lastColon = host.lastIndexOf(':');
  if (firstColon !== -1 && firstColon === lastColon) {
    const suffix = host.slice(lastColon + 1);
    if (suffix.length > 0 && /^\d+$/.test(suffix)) {
      host = host.slice(0, lastColon);
    }
  }
  return host.replace(/\.$/, '');
}
