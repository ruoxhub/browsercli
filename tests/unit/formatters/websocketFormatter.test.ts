/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {Buffer} from 'node:buffer';
import {describe, it} from 'node:test';

import {decodeWsPayload} from '../../../src/formatters/websocketFormatter.js';

function protobufEmbeddedJson(json: string): string {
  const jsonBytes = new TextEncoder().encode(json);
  const bytes = new Uint8Array([0x0a, jsonBytes.length, ...jsonBytes]);
  return Buffer.from(bytes).toString('base64');
}

describe('decodeWsPayload', () => {
  it('extracts embedded JSON from a protobuf binary frame', () => {
    const payload = protobufEmbeddedJson('{"a":1}');
    const result = decodeWsPayload(payload, 2, 'auto');
    assert.equal(result.decodeType, 'protobuf-embedded-json');
    assert.deepEqual(result.decodedJson, {a: 1});
  });

  it('parses a plain text JSON frame', () => {
    const result = decodeWsPayload('{"ping":true}', 1, 'auto');
    assert.equal(result.decodeType, 'json');
    assert.deepEqual(result.decodedJson, {ping: true});
  });

  it('labels non-json text as text', () => {
    const result = decodeWsPayload('hello', 1, 'auto');
    assert.equal(result.decodeType, 'text');
    assert.equal(result.decodedJson, undefined);
  });

  it('returns raw without decoding when mode is raw', () => {
    const result = decodeWsPayload('anything', 2, 'raw');
    assert.equal(result.decodeType, 'raw');
  });
});
