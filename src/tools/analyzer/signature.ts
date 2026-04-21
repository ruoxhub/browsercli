/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {SignatureChainHints} from './types.js';

const SIGNATURE_PARAM_REGEX =
  /\b(sign(?:ature)?|token|auth|nonce|timestamp|x-sign)\b/gi;
const FUNCTION_NAME_REGEX =
  /(function\s+([A-Za-z_$][\w$]*)\s*\(|const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(|([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?function)/g;
const REQUEST_SINK_REGEX =
  /\b(fetch|XMLHttpRequest|sendBeacon|axios\.(?:get|post|request)|\$.ajax)\b/g;

export function extractSignatureChainHints(code: string): SignatureChainHints {
  const params = new Set<string>();
  for (const match of code.matchAll(SIGNATURE_PARAM_REGEX)) {
    if (match[1]) {
      params.add(match[1].toLowerCase());
    }
  }

  const functions = new Set<string>();
  for (const match of code.matchAll(FUNCTION_NAME_REGEX)) {
    const name = match[2] || match[3] || match[4];
    if (
      name &&
      /(sign|token|encrypt|hash|auth|nonce|hmac|md5|sha)/i.test(name)
    ) {
      functions.add(name);
    }
  }

  const sinks = new Set<string>();
  for (const match of code.matchAll(REQUEST_SINK_REGEX)) {
    if (match[1]) {
      sinks.add(match[1]);
    }
  }

  return {
    signatureParams: Array.from(params).slice(0, 20),
    candidateFunctions: Array.from(functions).slice(0, 20),
    requestSinks: Array.from(sinks).slice(0, 20),
  };
}