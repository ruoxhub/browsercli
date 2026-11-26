/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * URLPattern 校验器（参考 chrome-devtools-mcp/src/utils/url.ts）。
 *
 * 确保 `--blockedUrlPattern` / `--allowedUrlPattern` 中的每条规则都可被 Chrome 在
 * 重定向与子资源请求中强制执行：
 * - 拒绝主机名中的部分 IPv4 通配符（如 `127.0.0.*`、`*.0.0.1`）
 * - 拒绝正则分组（如 `(foo|bar)`）
 * - 拒绝命名分组（`:name`，如 `*://127.0.0.1::port/path`）
 */

function hasNamedGroup(component: string): boolean {
  return component.replaceAll('\\\\', '').replaceAll('\\:', '').includes(':');
}

function hasPartialIpv4Hostname(pattern: string): boolean {
  const authority = /:\/\/([^/?#]+)/.exec(pattern)?.[1] ?? '';
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostPort.startsWith('[')) {
    return false;
  }
  const hostname = hostPort.replace(/:.*$/, '');
  if (!hostname.includes('*')) {
    return false;
  }
  const stripped = hostname.replaceAll(/[{}*\\]/g, '').replace(/\.+$/, '');
  const lastLabel = stripped.split('.').at(-1) ?? '';
  return /^(?:\d+|0[xX][0-9a-fA-F]*)$/.test(lastLabel);
}

interface ParsedUrlPattern {
  hasRegExpGroups?: boolean;
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
}

type UrlPatternConstructor = new (input: string) => ParsedUrlPattern;

export function validateUrlPatterns(
  patterns: string[],
  flagName: string,
): void {
  const URLPatternCtor = (
    globalThis as unknown as {URLPattern?: UrlPatternConstructor}
  ).URLPattern;

  for (const raw of patterns) {
    if (hasPartialIpv4Hostname(raw)) {
      throw new Error(
        `Invalid ${flagName} "${raw}": a partial IPv4 wildcard is not enforced on redirects or subresources. Use an exact IPv4 address or a "*" wildcard instead.`,
      );
    }
    if (typeof URLPatternCtor !== 'function') {
      continue;
    }
    let parsed: ParsedUrlPattern;
    try {
      parsed = new URLPatternCtor(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid ${flagName} "${raw}": ${message}`, {
        cause: error,
      });
    }
    if (parsed.hasRegExpGroups) {
      throw new Error(
        `Invalid ${flagName} "${raw}": a regexp group is not enforced on redirects or subresources. Use an exact value or a "*" wildcard instead.`,
      );
    }
    const components = [
      parsed.protocol,
      parsed.username,
      parsed.password,
      parsed.hostname,
      parsed.port,
      parsed.pathname,
      parsed.search,
      parsed.hash,
    ];
    if (components.some(hasNamedGroup)) {
      throw new Error(
        `Invalid ${flagName} "${raw}": a ":name" named group is not enforced on redirects or subresources. Use an exact value or a "*" wildcard instead.`,
      );
    }
  }
}
