/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {CapturedRequestRow, HookRecordRow} from '../../session/types.js';

import type {SceneHint} from './types.js';

interface SceneCollector {
  scene: SceneHint['scene'];
  confidence: 'high' | 'medium' | 'low';
  evidenceSet: Set<string>;
  matchedUrls: Set<string>;
}

const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const HEX_HASH_PATTERN = /^[a-fA-F0-9]{32,128}$/;

function parseHeaders(
  headersJson: string | null | undefined,
): Record<string, string> {
  if (!headersJson) return {};
  try {
    const parsed = JSON.parse(headersJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const lower: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        lower[k.toLowerCase()] = String(v);
      }
      return lower;
    }
  } catch {
    // Ignore invalid JSON header strings
  }
  return {};
}

function getSearchParams(urlStr: string): URLSearchParams | null {
  try {
    const url = new URL(urlStr);
    return url.searchParams;
  } catch {
    try {
      const url = new URL(urlStr, 'https://example.local');
      return url.searchParams;
    } catch {
      return null;
    }
  }
}

function mergeConfidence(
  current: 'high' | 'medium' | 'low',
  incoming: 'high' | 'medium' | 'low',
): 'high' | 'medium' | 'low' {
  const rank: Record<'high' | 'medium' | 'low', number> = {
    high: 3,
    medium: 2,
    low: 1,
  };
  return rank[incoming] > rank[current] ? incoming : current;
}

export class SceneDetector {
  /**
   * Performs single-pass O(N) detection over captured requests and hook records.
   */
  detect(
    requests: CapturedRequestRow[],
    hooks: HookRecordRow[] = [],
  ): SceneHint[] {
    const collectors = new Map<SceneHint['scene'], SceneCollector>();

    const recordScene = (
      scene: SceneHint['scene'],
      confidence: 'high' | 'medium' | 'low',
      evidence: string,
      url?: string,
    ) => {
      let col = collectors.get(scene);
      if (!col) {
        col = {
          scene,
          confidence,
          evidenceSet: new Set(),
          matchedUrls: new Set(),
        };
        collectors.set(scene, col);
      } else {
        col.confidence = mergeConfidence(col.confidence, confidence);
      }
      col.evidenceSet.add(evidence);
      if (url) {
        col.matchedUrls.add(url);
      }
    };

    // Single pass over requests
    for (const req of requests) {
      const headers = parseHeaders(req.requestHeaders);
      const searchParams = getSearchParams(req.url);
      const urlLower = req.url.toLowerCase();
      const body = req.requestBody ?? '';

      // 1. auth-token detection
      this.detectAuthToken(req, headers, searchParams, body, recordScene);

      // 2. signature-hash detection
      this.detectSignatureHash(req, headers, searchParams, body, recordScene);

      // 3. crypto-cipher from request payload
      this.detectCryptoRequest(req, body, recordScene);

      // 4. ai-sse detection
      this.detectAiSse(req, urlLower, recordScene);

      // 5. login-flow detection
      this.detectLoginFlow(req, urlLower, body, recordScene);
    }

    // Single pass over hooks
    for (const hook of hooks) {
      this.detectCryptoHook(hook, recordScene);
    }

    const results: SceneHint[] = [];
    for (const col of collectors.values()) {
      results.push({
        scene: col.scene,
        confidence: col.confidence,
        evidence: Array.from(col.evidenceSet).join('; '),
        matchedUrls: Array.from(col.matchedUrls),
      });
    }

    return results;
  }

  private detectAuthToken(
    req: CapturedRequestRow,
    headers: Record<string, string>,
    searchParams: URLSearchParams | null,
    body: string,
    record: (
      scene: SceneHint['scene'],
      confidence: 'high' | 'medium' | 'low',
      evidence: string,
      url?: string,
    ) => void,
  ): void {
    const authHeader = headers['authorization'];
    if (authHeader) {
      if (/^bearer\s+/i.test(authHeader)) {
        const token = authHeader.replace(/^bearer\s+/i, '').trim();
        const isJwt = JWT_PATTERN.test(token) || token.startsWith('ey');
        record(
          'auth-token',
          'high',
          `Found Bearer ${isJwt ? 'JWT ' : ''}Authorization header`,
          req.url,
        );
        return;
      }
      if (JWT_PATTERN.test(authHeader) || authHeader.startsWith('ey')) {
        record('auth-token', 'high', 'Found JWT Authorization header', req.url);
        return;
      }
      record(
        'auth-token',
        'medium',
        'Found Authorization header with custom token',
        req.url,
      );
      return;
    }

    for (const [headerKey, headerVal] of Object.entries(headers)) {
      if (/^(x-)?(auth|access|user)?[-_]?token$/i.test(headerKey)) {
        const isJwt = JWT_PATTERN.test(headerVal) || headerVal.startsWith('ey');
        record(
          'auth-token',
          isJwt ? 'high' : 'medium',
          `Found ${headerKey} header token`,
          req.url,
        );
        return;
      }
    }

    if (searchParams) {
      const tokenKeys = [
        'access_token',
        'token',
        'jwt',
        'auth_token',
        'accessToken',
        'authToken',
        'id_token',
      ];
      for (const key of tokenKeys) {
        const val = searchParams.get(key);
        if (val) {
          const isJwt = JWT_PATTERN.test(val) || val.startsWith('ey');
          record(
            'auth-token',
            isJwt ? 'high' : 'medium',
            `Found ${key} parameter in URL`,
            req.url,
          );
          return;
        }
      }
    }

    if (
      body &&
      (body.includes('access_token') ||
        body.includes('accessToken') ||
        body.includes('authToken') ||
        body.includes('jwt'))
    ) {
      const isJwt = JWT_PATTERN.test(body) || body.includes('eyJ');
      record(
        'auth-token',
        isJwt ? 'high' : 'medium',
        'Found token structure in request body',
        req.url,
      );
    }
  }

  private detectSignatureHash(
    req: CapturedRequestRow,
    headers: Record<string, string>,
    searchParams: URLSearchParams | null,
    body: string,
    record: (
      scene: SceneHint['scene'],
      confidence: 'high' | 'medium' | 'low',
      evidence: string,
      url?: string,
    ) => void,
  ): void {
    const sigKeywords = [
      'sign',
      'signature',
      'sig',
      'hmac',
      'nonce',
      'timestamp',
      '_ts',
      'app_key',
      'api_key',
    ];
    const matchedParams: string[] = [];
    let hasHexSignature = false;

    if (searchParams) {
      for (const key of sigKeywords) {
        if (searchParams.has(key)) {
          matchedParams.push(key);
          const val = searchParams.get(key) || '';
          if (
            (key.includes('sig') || key.includes('sign') || key === 'hmac') &&
            HEX_HASH_PATTERN.test(val)
          ) {
            hasHexSignature = true;
          }
        }
      }
    }

    for (const headerKey of Object.keys(headers)) {
      if (
        headerKey.includes('sign') ||
        headerKey.includes('signature') ||
        headerKey.includes('sig') ||
        headerKey.includes('hmac') ||
        headerKey.includes('nonce') ||
        headerKey.includes('timestamp')
      ) {
        matchedParams.push(headerKey);
        const val = headers[headerKey] || '';
        if (HEX_HASH_PATTERN.test(val)) {
          hasHexSignature = true;
        }
      }
    }

    if (body) {
      if (
        body.includes('sign') ||
        body.includes('signature') ||
        body.includes('hmac')
      ) {
        matchedParams.push('body.sign');
      }
    }

    if (matchedParams.length > 0) {
      const isHighConfidence =
        hasHexSignature ||
        matchedParams.length >= 2 ||
        matchedParams.some(p => p.includes('hmac'));

      record(
        'signature-hash',
        isHighConfidence ? 'high' : 'medium',
        `Detected signature / hash parameters: [${matchedParams.join(', ')}]`,
        req.url,
      );
    }
  }

  private detectCryptoRequest(
    req: CapturedRequestRow,
    body: string,
    record: (
      scene: SceneHint['scene'],
      confidence: 'high' | 'medium' | 'low',
      evidence: string,
      url?: string,
    ) => void,
  ): void {
    if (
      body &&
      (body.includes('ciphertext') ||
        body.includes('encryptedData') ||
        body.includes('"cipher"') ||
        body.includes('"iv"'))
    ) {
      record(
        'crypto-cipher',
        'medium',
        'Detected encrypted payload attributes in request body',
        req.url,
      );
    }
  }

  private detectAiSse(
    req: CapturedRequestRow,
    urlLower: string,
    record: (
      scene: SceneHint['scene'],
      confidence: 'high' | 'medium' | 'low',
      evidence: string,
      url?: string,
    ) => void,
  ): void {
    const isSseContentType =
      req.contentType?.toLowerCase().includes('text/event-stream') || false;
    const isChunked =
      req.contentType?.toLowerCase().includes('chunked') || false;
    const isStreaming = req.isStreaming === 1;

    if (isStreaming || isSseContentType) {
      record(
        'ai-sse',
        'high',
        `Detected streaming response (${isStreaming ? 'isStreaming=1' : 'text/event-stream'})`,
        req.url,
      );
      return;
    }

    if (
      isChunked ||
      urlLower.includes('completions') ||
      urlLower.includes('chat') ||
      urlLower.includes('sse') ||
      urlLower.includes('stream')
    ) {
      record(
        'ai-sse',
        'medium',
        'Detected AI/streaming URL keywords or chunked transfer',
        req.url,
      );
    }
  }

  private detectLoginFlow(
    req: CapturedRequestRow,
    urlLower: string,
    body: string,
    record: (
      scene: SceneHint['scene'],
      confidence: 'high' | 'medium' | 'low',
      evidence: string,
      url?: string,
    ) => void,
  ): void {
    const loginKeywords = [
      'login',
      'signin',
      'captcha',
      'sms',
      'verify',
      'auth/login',
      'oauth/authorize',
      'passport',
    ];

    const matchedKeyword = loginKeywords.find(
      kw => urlLower.includes(kw) || body.toLowerCase().includes(kw),
    );

    if (matchedKeyword) {
      const isPostOrPut =
        req.method.toUpperCase() === 'POST' ||
        req.method.toUpperCase() === 'PUT';
      const isDirectLoginOrVerify =
        urlLower.includes('login') ||
        urlLower.includes('signin') ||
        urlLower.includes('verify') ||
        urlLower.includes('auth');

      const isHigh = isPostOrPut && isDirectLoginOrVerify;
      record(
        'login-flow',
        isHigh ? 'high' : 'medium',
        `Detected login/auth endpoint (${req.method} matching "${matchedKeyword}")`,
        req.url,
      );
    }
  }

  private detectCryptoHook(
    hook: HookRecordRow,
    record: (
      scene: SceneHint['scene'],
      confidence: 'high' | 'medium' | 'low',
      evidence: string,
      url?: string,
    ) => void,
  ): void {
    const isCryptoHookType =
      hook.hookType === 'crypto' || hook.hookType === 'crypto_lib';
    const funcLower = hook.functionName.toLowerCase();
    const isCryptoFunc =
      funcLower.includes('subtle.') ||
      funcLower.includes('cryptojs') ||
      funcLower.includes('sm2') ||
      funcLower.includes('sm3') ||
      funcLower.includes('sm4') ||
      funcLower.includes('jsencrypt') ||
      funcLower.includes('aes') ||
      funcLower.includes('rsa') ||
      funcLower.includes('des') ||
      funcLower.includes('encrypt') ||
      funcLower.includes('decrypt');

    if (isCryptoHookType || isCryptoFunc) {
      record(
        'crypto-cipher',
        'high',
        `Detected crypto hook execution: ${hook.functionName} (${hook.hookType})`,
      );
    }
  }
}
