/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SceneHint {
  scene:
    | 'auth-token'
    | 'signature-hash'
    | 'crypto-cipher'
    | 'ai-sse'
    | 'login-flow';
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
  matchedUrls?: string[];
}

export interface PurifiedRequest {
  sequence: number;
  method: string;
  url: string;
  source: 'cdp' | 'proxy';
  statusCode: number;
  durationMs: number;
  contentType: string | null;
  keyHeaders: Record<string, string>;
  bodyPreview: string | null;
  responsePreview: string | null;
  isStreaming: number;
  isWebSocket: number;
}

export interface CryptoSnippet {
  functionName: string;
  hookType: string;
  file: string;
  line?: number;
  column?: number;
  sourceSnippet: string;
  argsPreview?: string;
  resultPreview?: string;
}
