/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {Response} from 'patchright';

import {logger} from '../../../utils/logger.js';
import {withTimeout} from '../../../utils/withTimeout.js';
import {
  CDP_BODY_TIMEOUT_MS,
  MAX_CAPTURED_BODY_BYTES,
} from '../../network/constants.js';
import {isTextualContentType} from '../../network/contentType.js';
import type {CapturedRequestInput} from '../types.js';

export type CdpBodyReader = (response: Response) => Promise<string | null>;

export interface CdpAdapterOptions {
  readBody?: CdpBodyReader;
  now?: () => number;
}

const safeJson = (value: Record<string, string> | undefined): string => {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
};

/**
 * 默认取体器：带超时与兜底捕获。
 * text() 在资源被回收 / 导航被打断时会 reject，此处按“无 body”降级，不外抛。
 */
export async function readCdpResponseBody(
  response: Response,
): Promise<string | null> {
  try {
    return await withTimeout(
      response.text(),
      CDP_BODY_TIMEOUT_MS,
      `Timed out reading CDP response body for ${response.url()}`,
    );
  } catch (error) {
    logger.warn('[CaptureEngine][cdp] 响应体读取失败，按无 body 摄入', error);
    return null;
  }
}

/**
 * CDP 链路字段映射（spec §5 / §5.1）。
 *
 * 三条不变量：
 * 1. timestamp 必须在任何 await 之前取（响应头到达时刻），否则会把取体耗时
 *    算进时间戳（spec §5 / r2.1）。
 * 2. 只有文本白名单 contentType 才取体；SSE 直接标 streaming 不读体。
 * 3. 本函数不抛错：请求对象已 dispose 时降级为空 headers / null body。
 *    落库失败由 CaptureEngine 统一隔离（spec §4 / R3）。
 */
export async function cdpResponseToInput(
  response: Response,
  opts: CdpAdapterOptions = {},
): Promise<CapturedRequestInput> {
  const readBody = opts.readBody ?? readCdpResponseBody;
  const now = opts.now ?? Date.now;
  const timestamp = now();

  const request = response.request();
  const statusCode = response.status();
  const contentType = response.headers()['content-type'] ?? null;
  const isStreaming = Boolean(contentType?.includes('text/event-stream'));
  // 重定向响应在 Playwright 中不提供 body，调用 text() 会抛错（见 spec §5.1 之外
  // 的降级说明）。3xx 本就不该取体，直接按无 body 摄入，避免 WARN 噪声。
  const isRedirect = statusCode >= 300 && statusCode < 400;

  let responseBody: string | null = null;
  let truncated = 0;
  if (
    !isStreaming &&
    !isRedirect &&
    contentType &&
    isTextualContentType(contentType)
  ) {
    const raw = await readBody(response);
    if (raw !== null) {
      // 截断是取体之后的事：白名单才是成本控制，1MiB 只是入库上限（spec §5.1）。
      truncated = raw.length > MAX_CAPTURED_BODY_BYTES ? 1 : 0;
      responseBody =
        truncated === 1 ? raw.slice(0, MAX_CAPTURED_BODY_BYTES) : raw;
    }
  }

  return {
    timestamp,
    method: request.method(),
    url: request.url(),
    source: 'cdp',
    requestHeaders: safeJson(tryGet(() => request.headers())),
    requestBody: tryGet(() => request.postData()) ?? null,
    statusCode,
    responseHeaders: safeJson(tryGet(() => response.headers())),
    responseBody,
    contentType,
    initiator: null,
    durationMs: 0,
    isStreaming: isStreaming ? 1 : 0,
    isWebSocket: 0,
    truncated,
  };
}

function tryGet<T>(accessor: () => T): T | undefined {
  try {
    return accessor();
  } catch (error) {
    logger.warn('[CaptureEngine][cdp] 请求对象不可读，按缺省值摄入', error);
    return undefined;
  }
}
