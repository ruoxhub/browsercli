/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {SignatureChainHints} from './types.js';

const MAX_HINTS = 20;

const SIGNATURE_PARAM_REGEX =
  /\b(sign(?:ature)?|token|auth|nonce|timestamp|x-sign)\b/gi;
const FUNCTION_NAME_REGEX =
  /(function\s+([A-Za-z_$][\w$]*)\s*\(|const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(|([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?function)/g;
const REQUEST_SINK_REGEX =
  /\b(fetch|XMLHttpRequest|sendBeacon|axios\.(?:get|post|request)|\$.ajax)\b/g;
const SIGNING_KEYWORD_REGEX = /(sign|token|encrypt|hash|auth|nonce|hmac|md5|sha)/i;

function collectUniqueMatches(
  source: string,
  regex: RegExp,
  pickGroup: (match: RegExpExecArray) => string | undefined,
  normalizer: (value: string) => string = value => value,
): string[] {
  const values = new Set<string>();
  for (const match of source.matchAll(regex)) {
    const raw = pickGroup(match);
    if (raw) {
      values.add(normalizer(raw));
    }
  }
  return Array.from(values).slice(0, MAX_HINTS);
}

function pickFunctionName(match: RegExpExecArray): string | undefined {
  return match[2] || match[3] || match[4];
}

export function extractSignatureChainHints(code: string): SignatureChainHints {
  return {
    signatureParams: collectUniqueMatches(
      code,
      SIGNATURE_PARAM_REGEX,
      match => match[1],
      value => value.toLowerCase(),
    ),
    candidateFunctions: collectUniqueMatches(
      code,
      FUNCTION_NAME_REGEX,
      match => {
        const name = pickFunctionName(match);
        if (name && SIGNING_KEYWORD_REGEX.test(name)) {
          return name;
        }
        return undefined;
      },
    ),
    requestSinks: collectUniqueMatches(code, REQUEST_SINK_REGEX, match => match[1]),
  };
}
