/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {isUtf8} from 'node:buffer';

import type {HTTPRequest, HTTPResponse} from '../third_party/index.js';

const BODY_CONTEXT_SIZE_LIMIT = 10000;
const BODY_READ_TIMEOUT_MS = 3000;
const URL_DISPLAY_MAX = 80;

function truncateUrl(url: string): string {
  if (url.length <= URL_DISPLAY_MAX) return url;
  return url.substring(0, URL_DISPLAY_MAX) + '…';
}

export function getShortDescriptionForRequest(
  request: HTTPRequest,
  id: number,
  selectedInDevToolsUI = false,
): string {
  return `reqid=${id} ${request.method()} ${truncateUrl(request.url())} ${getStatusFromRequest(request)}${selectedInDevToolsUI ? ` [selected in the DevTools Network panel]` : ''}`;
}

export function getStatusFromRequest(request: HTTPRequest): string {
  // Playwright: request.response() is async, but we use it synchronously here
  // for the short description. We check failure first.
  const failure = request.failure();
  if (failure) {
    return `[failed - ${failure.errorText}]`;
  }
  return '[pending]';
}

/**
 * Async version of getStatusFromRequest that can check response status.
 * Use this when you need the actual HTTP status code.
 */
export async function getStatusFromRequestAsync(
  request: HTTPRequest,
): Promise<string> {
  const httpResponse = await request.response();
  const failure = request.failure();
  if (httpResponse) {
    const responseStatus = httpResponse.status();
    return responseStatus >= 200 && responseStatus <= 299
      ? `[success - ${responseStatus}]`
      : `[failed - ${responseStatus}]`;
  } else if (failure) {
    return `[failed - ${failure.errorText}]`;
  }
  return '[pending]';
}

export async function getFormattedResponseBody(
  httpResponse: HTTPResponse,
  sizeLimit = BODY_CONTEXT_SIZE_LIMIT,
  timeoutMs = BODY_READ_TIMEOUT_MS,
): Promise<string | undefined> {
  try {
    const responseBuffer = await Promise.race([
      httpResponse.body(),
      new Promise<Buffer>((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);

    if (isUtf8(responseBuffer)) {
      const responseAsTest = responseBuffer.toString('utf-8');

      if (responseAsTest.length === 0) {
        return `<empty response>`;
      }

      return `${getSizeLimitedString(responseAsTest, sizeLimit)}`;
    }

    return `<binary data>`;
  } catch (error) {
    if (error instanceof Error && error.message === 'timeout') {
      return `<timed out while reading response body>`;
    }
    return `<not available anymore>`;
  }
}

function getSizeLimitedString(text: string, sizeLimit: number) {
  if (text.length > sizeLimit) {
    return `${text.substring(0, sizeLimit) + '... <truncated>'}`;
  }

  return `${text}`;
}
