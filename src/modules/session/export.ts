/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {readFileSync} from 'node:fs';
import {STATUS_CODES} from 'node:http';
import {join} from 'node:path';

import {resolvePackageRoot} from '../../utils/projectPaths.js';

import type {
  CaptureSource,
  CapturedRequestRow,
  RequestFilter,
} from './types.js';

/** 导出格式白名单，路由/工具共用，避免多处硬编码漂移。 */
export const EXPORT_FORMATS = ['har', 'json', 'curl'] as const;

export type SessionExportFormat = (typeof EXPORT_FORMATS)[number];

export interface SessionExportOptions {
  includeResponseBody?: boolean;
  /**
   * 仅对请求/响应标头脱敏（Authorization/Cookie/Token/Secret 等），
   * 不扫描请求体、响应体与 URL 查询串。调用方 UI 文案须与这一范围一致。
   */
  desensitize?: boolean;
}

/** 组装 RequestFilter：空数组/空串一律视为不过滤。工具与 HTTP 路由共用。 */
export function buildRequestFilter(input: {
  sources?: CaptureSource[];
  urlFilter?: string;
  filter?: string;
  ids?: string[];
}): RequestFilter {
  return {
    ...(input.sources && input.sources.length > 0
      ? {sources: input.sources}
      : {}),
    ...(input.urlFilter ? {urlFilter: input.urlFilter} : {}),
    ...(input.filter ? {filter: input.filter} : {}),
    ...(input.ids && input.ids.length > 0 ? {ids: input.ids} : {}),
  };
}

/** 仅脱敏敏感标头（Authorization/Cookie/Token/Secret 等），不扫描请求/响应正文。 */
const SENSITIVE_HEADER_REGEX =
  /^(authorization|proxy-authorization|cookie|set-cookie|.*token.*|.*secret.*|.*api[-_]?key.*)$/i;

/** 产品版本从 package.json 读取，避免 HAR creator.version 随发版失同步。 */
const PACKAGE_VERSION = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(
        join(resolvePackageRoot(import.meta.url), 'package.json'),
        'utf-8',
      ),
    ) as {version?: string};
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADER_REGEX.test(name.trim());
}

export function parseJsonHeaders(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        result[k] = typeof v === 'string' ? v : String(v);
      }
      return result;
    }
    return {};
  } catch {
    return {};
  }
}

export function desensitizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    result[k] = isSensitiveHeader(k) ? '[REDACTED]' : v;
  }
  return result;
}

function parseQueryString(
  urlStr: string,
): Array<{name: string; value: string}> {
  try {
    const parsed = new URL(urlStr);
    const result: Array<{name: string; value: string}> = [];
    parsed.searchParams.forEach((value, name) => {
      result.push({name, value});
    });
    return result;
  } catch {
    return [];
  }
}

/** HTTP 头名大小写不敏感：捕获侧不保证统一小写，查值前统一降级比较。 */
function headerValue(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/**
 * `Cookie` 请求头是 `name=value; name2=value2`，每段都是 cookie；
 * `Set-Cookie` 是 `name=value; Path=/; HttpOnly`，只有首段是 cookie，
 * 其余是属性。isSetCookie 区分两者，避免把 Path/HttpOnly 当成 cookie。
 */
function parseCookiesToHar(
  cookieStr: string | undefined,
  isSetCookie: boolean,
  desensitize?: boolean,
): Array<{name: string; value: string}> {
  if (!cookieStr) return [];
  const segments = isSetCookie
    ? [cookieStr.split(';', 1)[0] ?? '']
    : cookieStr.split(';');
  return segments
    .map(c => c.trim())
    .filter(Boolean)
    .map(pair => {
      const eqIdx = pair.indexOf('=');
      const name = eqIdx === -1 ? pair : pair.slice(0, eqIdx).trim();
      const value = eqIdx === -1 ? '' : pair.slice(eqIdx + 1).trim();
      return {
        name,
        value: desensitize ? '[REDACTED]' : value,
      };
    });
}

function headersToHar(
  headers: Record<string, string>,
): Array<{name: string; value: string}> {
  return Object.entries(headers).map(([name, value]) => ({name, value}));
}

export function buildHarEntry(
  r: CapturedRequestRow,
  options: SessionExportOptions = {},
): Record<string, unknown> {
  const rawReqHeaders = parseJsonHeaders(r.requestHeaders);
  const rawRespHeaders = parseJsonHeaders(r.responseHeaders);

  const reqCookies = parseCookiesToHar(
    headerValue(rawReqHeaders, 'cookie'),
    false,
    options.desensitize,
  );
  const respCookies = parseCookiesToHar(
    headerValue(rawRespHeaders, 'set-cookie'),
    true,
    options.desensitize,
  );

  const reqHeaders = options.desensitize
    ? desensitizeHeaders(rawReqHeaders)
    : rawReqHeaders;
  const respHeaders = options.desensitize
    ? desensitizeHeaders(rawRespHeaders)
    : rawRespHeaders;

  const includeBody = options.includeResponseBody !== false;
  // 二进制响应体不写入 HAR text（存的是截断后的原始文本或空串，不是可解析文本）。
  const isBinary = r.contentType
    ? /^(image|font|audio|video)\//i.test(r.contentType) ||
      [
        'application/octet-stream',
        'application/pdf',
        'application/zip',
      ].includes(r.contentType.toLowerCase())
    : false;

  const responseBodyText =
    includeBody && r.responseBody !== null && !isBinary ? r.responseBody : '';

  const entry: Record<string, unknown> = {
    startedDateTime: new Date(r.timestamp).toISOString(),
    time: Math.max(0, r.durationMs || 0),
    request: {
      method: r.method,
      url: r.url,
      httpVersion: 'HTTP/1.1',
      headers: headersToHar(reqHeaders),
      queryString: parseQueryString(r.url),
      cookies: reqCookies,
      headersSize: -1,
      bodySize: r.requestBody ? Buffer.byteLength(r.requestBody, 'utf-8') : 0,
      ...(r.requestBody !== null &&
        r.method.toUpperCase() !== 'GET' &&
        r.method.toUpperCase() !== 'HEAD' && {
          postData: {
            mimeType: r.contentType || 'application/octet-stream',
            text: r.requestBody,
          },
        }),
    },
    response: {
      status: r.statusCode || 0,
      statusText: STATUS_CODES[r.statusCode] || '',
      httpVersion: 'HTTP/1.1',
      headers: headersToHar(respHeaders),
      cookies: respCookies,
      content: {
        size: r.responseBody ? Buffer.byteLength(r.responseBody, 'utf-8') : 0,
        mimeType: r.contentType || 'application/octet-stream',
        ...(includeBody && r.responseBody !== null && !isBinary
          ? {text: responseBodyText}
          : {}),
      },
      redirectURL: headerValue(rawRespHeaders, 'location') || '',
      headersSize: -1,
      bodySize: r.responseBody ? Buffer.byteLength(r.responseBody, 'utf-8') : 0,
    },
    cache: {},
    timings: {
      send: 0,
      wait: Math.max(0, r.durationMs || 0),
      receive: 0,
    },
    _source: r.source,
    ...(r.initiator ? {_initiator: r.initiator} : {}),
  };

  return entry;
}

export function buildHar(
  records: CapturedRequestRow[],
  options: SessionExportOptions = {},
): Record<string, unknown> {
  const entries = records.map(r => buildHarEntry(r, options));
  return {
    log: {
      version: '1.2',
      creator: {
        name: 'JSReverser',
        version: PACKAGE_VERSION,
      },
      entries,
    },
  };
}

export function buildJson(
  records: CapturedRequestRow[],
  options: SessionExportOptions = {},
): Record<string, unknown> {
  const includeBody = options.includeResponseBody !== false;
  const requests = records.map(r => {
    let reqHeaders = parseJsonHeaders(r.requestHeaders);
    let respHeaders = parseJsonHeaders(r.responseHeaders);

    if (options.desensitize) {
      reqHeaders = desensitizeHeaders(reqHeaders);
      respHeaders = desensitizeHeaders(respHeaders);
    }

    return {
      id: r.id,
      sequence: r.sequence,
      timestamp: r.timestamp,
      time: new Date(r.timestamp).toISOString(),
      source: r.source,
      method: r.method,
      url: r.url,
      statusCode: r.statusCode,
      durationMs: r.durationMs,
      contentType: r.contentType,
      initiator: r.initiator,
      requestHeaders: reqHeaders,
      requestBody: r.requestBody,
      responseHeaders: respHeaders,
      responseBody: includeBody ? r.responseBody : null,
    };
  });

  return {
    version: '1.0',
    creator: 'JSReverser',
    exportedAt: new Date().toISOString(),
    total: records.length,
    requests,
  };
}

export function formatCurlCommand(
  r: CapturedRequestRow,
  options: SessionExportOptions = {},
): string {
  let cmd = `curl -X ${r.method.toUpperCase()} '${r.url.replace(/'/g, "'\\''")}'`;
  let headers = parseJsonHeaders(r.requestHeaders);
  if (options.desensitize) {
    headers = desensitizeHeaders(headers);
  }

  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'host') continue;
    cmd += ` \\\n  -H '${k}: ${v.replace(/'/g, "'\\''")}'`;
  }

  if (
    r.requestBody !== null &&
    r.method.toUpperCase() !== 'GET' &&
    r.method.toUpperCase() !== 'HEAD'
  ) {
    cmd += ` \\\n  --data-raw '${r.requestBody.replace(/'/g, "'\\''")}'`;
  }

  return cmd;
}

export function buildCurlScript(
  records: CapturedRequestRow[],
  options: SessionExportOptions = {},
): string {
  const lines: string[] = [
    '#!/usr/bin/env bash',
    '# ==============================================================================',
    '# Traffic Capture cURL Replay Script',
    `# Exported: ${new Date().toISOString()}`,
    `# Total Requests: ${records.length}`,
    '# ==============================================================================',
    '',
  ];

  records.forEach((r, idx) => {
    const statusDesc = r.statusCode ? `(HTTP ${r.statusCode})` : '';
    lines.push(
      `# [${idx + 1}/${records.length}] ${r.method} ${r.url} ${statusDesc}`,
    );
    lines.push(formatCurlCommand(r, options));
    lines.push('');
  });

  return lines.join('\n');
}

export function exportTraffic(
  requests: CapturedRequestRow[],
  format: SessionExportFormat,
  options: SessionExportOptions = {},
): {content: string; filename: string; mimeType: string; count: number} {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

  if (format === 'har') {
    const har = buildHar(requests, options);
    return {
      content: JSON.stringify(har, null, 2),
      filename: `traffic-${dateStr}.har`,
      mimeType: 'application/json; charset=utf-8',
      count: requests.length,
    };
  }

  if (format === 'json') {
    const json = buildJson(requests, options);
    return {
      content: JSON.stringify(json, null, 2),
      filename: `traffic-${dateStr}.json`,
      mimeType: 'application/json; charset=utf-8',
      count: requests.length,
    };
  }

  if (format === 'curl') {
    const curlScript = buildCurlScript(requests, options);
    return {
      content: curlScript,
      filename: `traffic-${dateStr}.sh`,
      mimeType: 'application/x-sh; charset=utf-8',
      count: requests.length,
    };
  }

  // 类型上不可达；保留以便新增格式时在此处显式失败，而非静默返回 undefined。
  throw new Error(`Unsupported export format: ${String(format)}`);
}
