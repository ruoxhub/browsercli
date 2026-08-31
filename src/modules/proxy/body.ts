/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * 从 MitmProxyServer.ts 抽出的 body 编解码与传输头 helper，
 * 供引擎转发与规则引擎（rewrite.ts）共用，避免重复实现。
 */
import {brotliDecompressSync, gunzipSync, inflateSync} from 'node:zlib';

import {MAX_CAPTURED_BODY_BYTES} from '../network/constants.js';

/** 引擎单 body 上限（1 MiB），与 Session 侧同值同源。 */
export const MAX_BODY_SIZE = MAX_CAPTURED_BODY_BYTES;

/** 命中即视为二进制、不转 utf-8 的 content-type 前缀。 */
export const BINARY_CONTENT_TYPES = [
  'image/',
  'font/',
  'audio/',
  'video/',
  'application/octet-stream',
  'application/pdf',
  'application/zip',
];
/** 静态资源扩展名（用于 isStatic 标记）。 */
export const STATIC_EXTENSIONS =
  /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|map)$/i;

/** 改 body 后需剥离的 hop-by-hop / 传输层头。 */
const HOP_BY_HOP_HEADERS = new Set([
  'proxy-connection',
  'connection',
  'keep-alive',
  'content-length',
  'transfer-encoding',
]);

export function headerToString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(',') : value || '';
}

export function decodeCapturedBody(
  body: Buffer,
  contentEncoding: string | string[] | undefined,
): Buffer {
  const encodings = headerToString(contentEncoding)
    .toLowerCase()
    .split(',')
    .map(e => e.trim())
    .filter(Boolean);

  return encodings.reduceRight((decoded, encoding) => {
    if (encoding === 'br') return brotliDecompressSync(decoded);
    if (encoding === 'gzip' || encoding === 'x-gzip')
      return gunzipSync(decoded);
    if (encoding === 'deflate') return inflateSync(decoded);
    return decoded;
  }, body);
}

export function bodyToUtf8(
  body: Buffer,
  contentEncoding: string | string[] | undefined,
): string {
  try {
    return decodeCapturedBody(body, contentEncoding)
      .toString('utf-8')
      .substring(0, MAX_BODY_SIZE);
  } catch {
    return body.toString('utf-8').substring(0, MAX_BODY_SIZE);
  }
}

export function isBinaryContentType(contentType: string | null): boolean {
  return contentType
    ? BINARY_CONTENT_TYPES.some(t => contentType.startsWith(t))
    : false;
}

/**
 * 改 body 后修正传输头：剥离 hop-by-hop 头，按需剥 content-encoding，
 * 并重写 content-length 为新 body 长度。
 *
 * 请求侧不剥 content-encoding（请求体通常不压缩）；响应侧 body 已被解码后再
 * 改写，故需剥 content-encoding 改发 identity。
 */
export function fixHeadersAfterBodyRewrite(
  headers: Record<string, string>,
  newBodyLength: number,
  opts: {stripContentEncoding: boolean},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (opts.stripContentEncoding && lower === 'content-encoding') continue;
    out[key] = value;
  }
  out['content-length'] = String(newBodyLength);
  return out;
}
