/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  isTextualContentType,
  TEXTUAL_CONTENT_TYPES,
} from '../../../../src/modules/network/contentType.js';

describe('isTextualContentType', () => {
  it('accepts the documented whitelist tokens', () => {
    assert.strictEqual(isTextualContentType('application/json'), true);
    assert.strictEqual(isTextualContentType('text/html; charset=utf-8'), true);
    assert.strictEqual(isTextualContentType('application/javascript'), true);
    assert.strictEqual(isTextualContentType('text/event-stream'), true);
  });

  it('rejects binary payloads a blacklist would miss', () => {
    assert.strictEqual(isTextualContentType('application/wasm'), false);
    assert.strictEqual(isTextualContentType('application/x-font-woff'), false);
    assert.strictEqual(isTextualContentType('application/x-protobuf'), false);
    assert.strictEqual(isTextualContentType('application/octet-stream'), false);
    assert.strictEqual(isTextualContentType('image/png'), false);
    assert.strictEqual(isTextualContentType(''), false);
  });

  it('keeps the whitelist tokens unchanged from NetworkModule', () => {
    assert.deepStrictEqual(TEXTUAL_CONTENT_TYPES, [
      'json',
      'text',
      'javascript',
    ]);
  });
});
