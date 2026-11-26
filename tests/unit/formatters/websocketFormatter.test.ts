/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {Buffer} from 'node:buffer';
import {describe, it} from 'node:test';

import {decodeWsPayload} from '../../../src/formatters/websocketFormatter.js';
import {analyzeWebSocketFramesV2} from '../../../src/formatters/websocketFormatter.js';

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

describe('analyzeWebSocketFramesV2', () => {
  const frame = (
    opcode: number,
    payloadData: string,
    index: number,
  ) => ({
    requestId: `r${index}`,
    direction: 'received' as const,
    timestamp: 1700000000000 + index,
    opcode,
    payloadData,
  });

  it('keeps one binary message type in a single group despite changing payloads', () => {
    // Same shape, only the id byte differs — the old head4B key split these apart.
    const frames = Array.from({length: 5}, (_, i) =>
      frame(2, Buffer.from([0x0a, 0x08, i, 0x12, 0x02, 0x41, 0x42]).toString('base64'), i),
    );

    const summary = analyzeWebSocketFramesV2(frames, 1, 'wss://example.com');

    assert.equal(summary.groups.length, 1);
    assert.equal(summary.groups[0]!.count, 5);
  });

  it('separates text and binary frames of the same size category', () => {
    const frames = [
      frame(1, '{"type":"ping"}', 0),
      frame(1, '{"type":"ping"}', 1),
      frame(2, Buffer.from([0x0a, 0x02, 0x41, 0x42]).toString('base64'), 2),
    ];

    const summary = analyzeWebSocketFramesV2(frames, 1, 'wss://example.com');

    assert.equal(summary.groups.length, 2);
    assert.deepEqual(
      summary.groups.map(g => g.count),
      [2, 1],
    );
  });
});
