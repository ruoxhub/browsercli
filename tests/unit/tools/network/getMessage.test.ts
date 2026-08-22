/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {Buffer} from 'node:buffer';
import {describe, it} from 'node:test';

import {NetworkModule} from '../../../../src/modules/network/NetworkModule.js';
import type {NetworkServices} from '../../../../src/modules/network/NetworkTypes.js';

function binaryFrame(payload: string) {
  return {
    direction: 'received',
    timestamp: Date.now(),
    opcode: 2,
    payloadData: payload,
  };
}

describe('getWebSocketMessage decoding', () => {
  const networkModule = new NetworkModule();

  function servicesWith(frame: unknown): NetworkServices {
    return {
      getWebSocketConnectionById: () => ({
        connection: {url: 'wss://x', status: 'open'},
        frames: [frame],
      }),
    } as unknown as NetworkServices;
  }

  it('includes decodeType and decodedJson when decode is auto', () => {
    const json = '{"op":"login"}';
    const jsonBytes = new TextEncoder().encode(json);
    const bytes = new Uint8Array([0x0a, jsonBytes.length, ...jsonBytes]);
    const payload = Buffer.from(bytes).toString('base64');
    const result = networkModule.getWebSocketMessage(
      servicesWith(binaryFrame(payload)),
      {wsid: 1, frameIndex: 0, decode: 'auto'},
    );
    assert.equal(result.success, true);
    assert.equal(result.data.frame?.decodeType, 'protobuf-embedded-json');
    assert.deepEqual(result.data.frame?.decodedJson, {op: 'login'});
  });
});
