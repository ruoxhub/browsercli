/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {CapturedRequestRow} from '../../session/types.js';

import type {PurifiedRequest} from './types.js';

const STATIC_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'ico',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'css',
  'map',
  'webp',
  'avif',
  'mp4',
  'mp3',
  'webm',
  'ogg',
  'wav',
  'bmp',
  'tiff',
]);

// 追踪/分析域名的聚焦集合，用于过滤「噪声请求」（分析埋点、监控、营销 SDK 等）。
//
// 刻意不复用 `PatternDetector.BLACKLIST_DOMAINS`：两者语义不同。
// `BLACKLIST_DOMAINS` 混入了 CDN 域名（cdn.jsdelivr.net / unpkg.com /
// cdnjs.cloudflare.com）以及 facebook.com/tr、googlesyndication.com；
// 若机械复用，会让 TrafficPurifier 把逆向分析最需要保留的 JS bundle 请求
// 也一并过滤掉，属于正确性回退。因此此处只保留追踪/分析语义的域名列表。
//
// 已知漂移：本表额外包含 `segment.io`（BLACKLIST_DOMAINS 中无此条目）。
// 未来统一候选（P3）：提取共享的「噪声域名」单一来源，消除双表漂移。
const TRACKING_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'sentry.io',
  'clarity.ms',
  'hotjar.com',
  'segment.com',
  'segment.io',
  'mixpanel.com',
  'amplitude.com',
  'bugsnag.com',
];

const NOISY_HEADER_PATTERNS = [
  /^sec-ch-ua/i,
  /^sec-fetch-/i,
  /^accept-encoding$/i,
  /^accept-language$/i,
  /^connection$/i,
  /^host$/i,
];

function isStaticAsset(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr, 'http://localhost');
    const pathname = parsed.pathname;
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    if (match && STATIC_EXTENSIONS.has(match[1].toLowerCase())) {
      return true;
    }
  } catch {
    // If URL parsing fails, test raw string ending
    const match = urlStr.split('?')[0].match(/\.([a-z0-9]+)$/i);
    if (match && STATIC_EXTENSIONS.has(match[1].toLowerCase())) {
      return true;
    }
  }
  return false;
}

function isTrackingDomain(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr, 'http://localhost');
    const hostname = parsed.hostname.toLowerCase();
    return TRACKING_DOMAINS.some(
      domain => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

function isNoisyHeader(name: string): boolean {
  return NOISY_HEADER_PATTERNS.some(pattern => pattern.test(name));
}

function isKeyHeader(name: string): boolean {
  const lower = name.toLowerCase();
  if (
    lower === 'authorization' ||
    lower === 'cookie' ||
    lower === 'content-type' ||
    lower === 'user-agent' ||
    lower === 'referer' ||
    lower === 'referrer'
  ) {
    return true;
  }
  if (lower.startsWith('x-')) {
    return true;
  }
  if (
    lower.includes('token') ||
    lower.includes('auth') ||
    lower.includes('sign') ||
    lower.includes('key') ||
    lower.includes('session') ||
    lower.includes('secret') ||
    lower.includes('jwt') ||
    lower.includes('csrf') ||
    lower.includes('xsrf')
  ) {
    return true;
  }
  return false;
}

function extractKeyHeaders(rawHeaders: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!rawHeaders) return result;

  let parsed: Record<string, unknown> = {};
  try {
    parsed =
      typeof rawHeaders === 'string' ? JSON.parse(rawHeaders) : rawHeaders;
  } catch {
    return result;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return result;
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (isNoisyHeader(key)) {
      continue;
    }
    if (isKeyHeader(key) && value !== undefined && value !== null) {
      result[key] = String(value);
    }
  }

  return result;
}

function isBinaryContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  if (
    lower.startsWith('text/') ||
    lower.includes('json') ||
    lower.includes('xml') ||
    lower.includes('javascript') ||
    lower.includes('x-www-form-urlencoded') ||
    lower.includes('graphql')
  ) {
    return false;
  }
  if (
    lower.startsWith('image/') ||
    lower.startsWith('audio/') ||
    lower.startsWith('video/') ||
    lower.startsWith('font/') ||
    lower.includes('octet-stream') ||
    lower.includes('wasm') ||
    lower.includes('pdf') ||
    lower.includes('zip') ||
    lower.includes('protobuf') ||
    lower.includes('binary')
  ) {
    return true;
  }
  return false;
}

function formatPreview(body: string | null, maxLen = 1000): string | null {
  if (!body) return null;
  if (body.length <= maxLen) return body;
  return `${body.slice(0, maxLen)}...`;
}

function formatResponsePreview(
  body: string | null,
  contentType: string | null,
  maxLen = 1000,
): string | null {
  if (body && body.length > 0) {
    return formatPreview(body, maxLen);
  }
  if (isBinaryContentType(contentType)) {
    return '[Binary Data]';
  }
  return null;
}

export interface TrafficPurifierOptions {
  maxRequests?: number;
}

export class TrafficPurifier {
  purify(
    requests: CapturedRequestRow[],
    options: TrafficPurifierOptions = {},
  ): PurifiedRequest[] {
    if (!requests || requests.length === 0) {
      return [];
    }

    const filtered = requests.filter(req => {
      if (!req.url) return false;
      if (isStaticAsset(req.url)) return false;
      if (isTrackingDomain(req.url)) return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => a.sequence - b.sequence);
    const max = options.maxRequests ?? 100;
    const capped = sorted.slice(0, max);

    return capped.map(req => ({
      sequence: req.sequence,
      method: req.method,
      url: req.url,
      source: req.source,
      statusCode: req.statusCode,
      durationMs: req.durationMs,
      contentType: req.contentType,
      keyHeaders: extractKeyHeaders(req.requestHeaders),
      bodyPreview: formatPreview(req.requestBody),
      responsePreview: formatResponsePreview(req.responseBody, req.contentType),
      isStreaming: req.isStreaming,
      isWebSocket: req.isWebSocket,
    }));
  }
}
