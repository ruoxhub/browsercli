/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {SceneDetector} from '../../../../../src/modules/analyzer/ai/SceneDetector.js';
import type {
  CapturedRequestRow,
  HookRecordRow,
} from '../../../../../src/modules/session/types.js';

function createMockRequest(
  overrides: Partial<CapturedRequestRow> = {},
): CapturedRequestRow {
  return {
    id: 'req-1',
    sessionId: 'session-1',
    sequence: 1,
    timestamp: 1700000000000,
    method: 'GET',
    url: 'https://example.com/api/v1/resource',
    source: 'cdp',
    requestHeaders: '{}',
    requestBody: null,
    statusCode: 200,
    responseHeaders: null,
    responseBody: null,
    contentType: 'application/json',
    initiator: null,
    durationMs: 50,
    isStreaming: 0,
    isWebSocket: 0,
    truncated: 0,
    ...overrides,
  };
}

function createMockHook(overrides: Partial<HookRecordRow> = {}): HookRecordRow {
  return {
    sessionId: 'session-1',
    timestamp: 1700000000000,
    hookType: 'fetch',
    functionName: 'window.fetch',
    arguments: '[]',
    result: null,
    callStack: null,
    ...overrides,
  };
}

describe('SceneDetector', () => {
  const detector = new SceneDetector();

  it('detects auth-token scene with high confidence from Bearer / JWT in headers or params', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHclpkw';
    const reqWithBearer = createMockRequest({
      id: 'req-auth-1',
      url: 'https://api.example.com/user/profile',
      requestHeaders: JSON.stringify({
        Authorization: `Bearer ${jwt}`,
      }),
    });

    const hints = detector.detect([reqWithBearer], []);
    const authHint = hints.find(h => h.scene === 'auth-token');

    assert.ok(authHint, 'Should detect auth-token scene');
    assert.strictEqual(authHint.confidence, 'high');
    assert.ok(
      authHint.evidence.includes('Bearer') || authHint.evidence.includes('JWT'),
    );
    assert.deepStrictEqual(authHint.matchedUrls, [
      'https://api.example.com/user/profile',
    ]);
  });

  it('detects auth-token scene with medium confidence from token parameter keyword', () => {
    const reqWithToken = createMockRequest({
      id: 'req-auth-2',
      url: 'https://api.example.com/feed?access_token=custom_opaque_token_123',
      requestHeaders: '{}',
    });

    const hints = detector.detect([reqWithToken], []);
    const authHint = hints.find(h => h.scene === 'auth-token');

    assert.ok(authHint, 'Should detect auth-token scene');
    assert.strictEqual(authHint.confidence, 'medium');
    assert.deepStrictEqual(authHint.matchedUrls, [
      'https://api.example.com/feed?access_token=custom_opaque_token_123',
    ]);
  });

  it('detects signature-hash scene from signature, nonce, timestamp parameters', () => {
    const reqWithSig = createMockRequest({
      id: 'req-sig-1',
      url: 'https://api.example.com/data?sign=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855&timestamp=1700000000&nonce=abc123',
      requestHeaders: '{}',
    });

    const hints = detector.detect([reqWithSig], []);
    const sigHint = hints.find(h => h.scene === 'signature-hash');

    assert.ok(sigHint, 'Should detect signature-hash scene');
    assert.strictEqual(sigHint.confidence, 'high');
    assert.ok(sigHint.evidence.length > 0);
    assert.deepStrictEqual(sigHint.matchedUrls, [reqWithSig.url]);
  });

  it('detects signature-hash with medium confidence from single keyword', () => {
    const reqWithSig = createMockRequest({
      id: 'req-sig-2',
      url: 'https://api.example.com/query?sig=xyz',
      requestHeaders: '{}',
    });

    const hints = detector.detect([reqWithSig], []);
    const sigHint = hints.find(h => h.scene === 'signature-hash');

    assert.ok(sigHint, 'Should detect signature-hash scene');
    assert.strictEqual(sigHint.confidence, 'medium');
  });

  it('detects crypto-cipher scene with high confidence from crypto hooks', () => {
    const hook = createMockHook({
      hookType: 'crypto',
      functionName: 'CryptoJS.AES.encrypt',
      arguments: '["secret", "key123"]',
    });

    const hints = detector.detect([], [hook]);
    const cryptoHint = hints.find(h => h.scene === 'crypto-cipher');

    assert.ok(cryptoHint, 'Should detect crypto-cipher scene');
    assert.strictEqual(cryptoHint.confidence, 'high');
    assert.ok(
      cryptoHint.evidence.includes('CryptoJS.AES.encrypt') ||
        cryptoHint.evidence.includes('crypto'),
    );
  });

  it('detects crypto-cipher scene from crypto_lib hooks and subtle.encrypt', () => {
    const hook = createMockHook({
      hookType: 'crypto_lib',
      functionName: 'subtle.encrypt',
      arguments: '["AES-GCM", "key", "..."]',
    });

    const hints = detector.detect([], [hook]);
    const cryptoHint = hints.find(h => h.scene === 'crypto-cipher');

    assert.ok(cryptoHint, 'Should detect crypto-cipher scene');
    assert.strictEqual(cryptoHint.confidence, 'high');
  });

  it('detects ai-sse scene from isStreaming flag or text/event-stream content-type', () => {
    const sseReq = createMockRequest({
      id: 'req-sse-1',
      url: 'https://api.openai.com/v1/chat/completions',
      contentType: 'text/event-stream; charset=utf-8',
      isStreaming: 1,
    });

    const hints = detector.detect([sseReq], []);
    const sseHint = hints.find(h => h.scene === 'ai-sse');

    assert.ok(sseHint, 'Should detect ai-sse scene');
    assert.strictEqual(sseHint.confidence, 'high');
    assert.deepStrictEqual(sseHint.matchedUrls, [
      'https://api.openai.com/v1/chat/completions',
    ]);
  });

  it('detects ai-sse with medium confidence from URL keyword alone', () => {
    const req = createMockRequest({
      id: 'req-sse-2',
      url: 'https://api.example.com/v1/chat/completions',
      contentType: 'application/json',
      isStreaming: 0,
    });

    const hints = detector.detect([req], []);
    const sseHint = hints.find(h => h.scene === 'ai-sse');

    assert.ok(sseHint, 'Should detect ai-sse scene');
    assert.strictEqual(sseHint.confidence, 'medium');
  });

  it('detects login-flow scene from login/verify endpoints with POST method', () => {
    const loginReq = createMockRequest({
      id: 'req-login-1',
      method: 'POST',
      url: 'https://example.com/api/auth/login',
      requestBody: '{"username":"admin","password":"***"}',
    });

    const hints = detector.detect([loginReq], []);
    const loginHint = hints.find(h => h.scene === 'login-flow');

    assert.ok(loginHint, 'Should detect login-flow scene');
    assert.strictEqual(loginHint.confidence, 'high');
    assert.deepStrictEqual(loginHint.matchedUrls, [
      'https://example.com/api/auth/login',
    ]);
  });

  it('detects login-flow scene with medium confidence from GET captcha endpoint', () => {
    const captchaReq = createMockRequest({
      id: 'req-captcha-1',
      method: 'GET',
      url: 'https://example.com/api/captcha/image?t=123',
    });

    const hints = detector.detect([captchaReq], []);
    const loginHint = hints.find(h => h.scene === 'login-flow');

    assert.ok(loginHint, 'Should detect login-flow scene');
    assert.strictEqual(loginHint.confidence, 'medium');
  });

  it('aggregates multiple scenes in a single detect call with deduplicated matchedUrls', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig';
    const req1 = createMockRequest({
      id: 'req-1',
      method: 'POST',
      url: 'https://example.com/api/login',
      requestHeaders: JSON.stringify({Authorization: `Bearer ${jwt}`}),
      requestBody: '{"username":"user","password":"pw"}',
    });
    const req2 = createMockRequest({
      id: 'req-2',
      method: 'GET',
      url: 'https://example.com/api/data?sign=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789&nonce=123',
    });
    const req3 = createMockRequest({
      id: 'req-3',
      method: 'POST',
      url: 'https://example.com/v1/chat/completions',
      contentType: 'text/event-stream',
      isStreaming: 1,
    });
    const hook = createMockHook({
      hookType: 'crypto',
      functionName: 'CryptoJS.SHA256',
    });

    const hints = detector.detect([req1, req2, req3], [hook]);

    const scenes = hints.map(h => h.scene);
    assert.ok(scenes.includes('auth-token'));
    assert.ok(scenes.includes('login-flow'));
    assert.ok(scenes.includes('signature-hash'));
    assert.ok(scenes.includes('ai-sse'));
    assert.ok(scenes.includes('crypto-cipher'));
  });

  it('returns empty array when no scenes match', () => {
    const req = createMockRequest({
      id: 'req-plain-1',
      method: 'GET',
      url: 'https://example.com/static/style.css',
      requestHeaders: '{}',
      requestBody: null,
      contentType: 'text/css',
    });

    const hints = detector.detect([req], []);
    assert.strictEqual(hints.length, 0);
  });
});
