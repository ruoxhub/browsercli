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
