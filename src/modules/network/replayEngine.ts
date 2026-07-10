/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {APIRequestContext, APIResponse} from '../../third_party/index.js';
import type {
  BuiltReplayRequest,
  GetNetworkRequestData,
  ReplayOverride,
  ReplayResponse,
} from './NetworkTypes.js';

/** 由 APIRequestContext 管理的 hop-by-hop / transport 头，重放时剥离。 */
export const STRIPPED_HEADERS = [
  'host',
  'content-length',
  'connection',
  'accept-encoding',
  'content-encoding',
  'transfer-encoding',
  'keep-alive',
] as const;

const STRIPPED_HEADERS_LOWER = new Set<string>(STRIPPED_HEADERS);

/**
 * 剥离由 APIRequestContext 管理的传输层头（大小写不敏感）。
 * 签名相关头（sign/signature/x-sign/token/auth/nonce/timestamp 等）原样保留。
 */
export function stripManagedHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!STRIPPED_HEADERS_LOWER.has(key.toLowerCase())) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 根据原始请求和可选覆盖构建重放请求。
 *
 * - method: override.method?.toUpperCase() ?? original.method
 * - url: override.url ?? original.url
 * - headers: 默认合并（override 大小写不敏感地覆盖同名键，保留 override 大小写）；
 *            replaceHeaders=true 时整体替换。最终都过 stripManagedHeaders。
 * - body: override.body !== undefined ? (override.body ?? undefined) : original.postData
 *         （null 显式清空，省略保留原始）
 */
export function buildReplayRequest(
  original: GetNetworkRequestData,
  override?: ReplayOverride,
): BuiltReplayRequest {
  const method = override?.method?.toUpperCase() ?? original.method;
  const url = override?.url ?? original.url;

  let headers: Record<string, string>;
  if (override?.replaceHeaders === true) {
    headers = {...(override.headers ?? {})};
  } else {
    headers = mergeHeaders(original.requestHeaders, override?.headers);
  }
  headers = stripManagedHeaders(headers);

  const body =
    override?.body !== undefined
      ? (override.body ?? undefined)
      : original.postData;

  return {method, url, headers, body};
}

function mergeHeaders(
  original: Record<string, string>,
  override?: Record<string, string>,
): Record<string, string> {
  if (!override) {
    return {...original};
  }
  const result: Record<string, string> = {...original};
  const originalKeysLower = new Map(
    Object.keys(original).map(k => [k.toLowerCase(), k]),
  );
  for (const [overrideKey, overrideValue] of Object.entries(override)) {
    const lower = overrideKey.toLowerCase();
    const existingKey = originalKeysLower.get(lower);
    if (existingKey !== undefined && existingKey !== overrideKey) {
      delete result[existingKey];
    }
    result[overrideKey] = overrideValue;
  }
  return result;
}

/** 构建一个全零的 ReplayResponse，用于失败 variant 的占位。 */
export function emptyReplayResponse(url: string): ReplayResponse {
  return {
    status: 0,
    statusText: '',
    headers: {},
    body: '',
    bodyTruncated: false,
    timingMs: 0,
    replayedUrl: url,
  };
}

/**
 * 通过 APIRequestContext 发起重放请求，返回归一化响应。
 *
 * - 复用浏览器 context 的 cookie/storage/UA，绕过 CORS 和页面 JS 拦截器。
 * - 网络错误抛出（由调用方捕获并附加到 BatchVariantResult.error 或单重放错误路径）。
 * - 响应体读取失败时回退为空字符串。
 */
export async function executeReplay(
  apiCtx: APIRequestContext,
  built: BuiltReplayRequest,
  maxBodyLength: number,
): Promise<ReplayResponse> {
  const started = Date.now();
  const resp: APIResponse = await apiCtx.fetch(built.url, {
    method: built.method,
    headers: built.headers,
    data: built.body,
  });

  const status = resp.status();
  const statusText = (() => {
    try {
      return resp.statusText?.() ?? '';
    } catch {
      return '';
    }
  })();
  const headers = resp.headers();

  let body = '';
  let bodyTruncated = false;
  try {
    const fullBody = await resp.text();
    if (fullBody.length > maxBodyLength) {
      body = fullBody.slice(0, maxBodyLength) + '\n... [truncated]';
      bodyTruncated = true;
    } else {
      body = fullBody;
    }
  } catch {
    // body 读取失败，回退为空
  }

  return {
    status,
    statusText,
    headers,
    body,
    bodyTruncated,
    timingMs: Date.now() - started,
    replayedUrl: built.url,
  };
}

interface FormatCurlOptions {
  includeCookies?: boolean;
  cookies?: Array<{name: string; value: string}>;
}

/**
 * 将构建好的请求格式化为单行 sh 风格 curl 命令。
 *
 * - GET 省略 -X（curl 默认）。
 * - 单引号转义：' → '\''。
 * - body 非空时附加 --data。
 * - includeCookies=true 且 cookies 非空时附加 Cookie 头。
 * - 不加 --compressed/--insecure/--silent，保持最小输出。
 */
export function formatCurl(
  built: BuiltReplayRequest,
  opts: FormatCurlOptions,
): string {
  const parts: string[] = ['curl'];

  if (built.method.toUpperCase() !== 'GET') {
    parts.push(`-X ${built.method.toUpperCase()}`);
  }

  parts.push(quote(built.url));

  for (const [key, value] of Object.entries(built.headers)) {
    parts.push(`-H ${quote(`${key}: ${value}`)}`);
  }

  if (opts.includeCookies && opts.cookies && opts.cookies.length > 0) {
    const cookieStr = opts.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    parts.push(`-H ${quote(`Cookie: ${cookieStr}`)}`);
  }

  if (built.body) {
    parts.push(`--data ${quote(built.body)}`);
  }

  return parts.join(' ');
}

function quote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
