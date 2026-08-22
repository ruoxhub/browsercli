/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {NetworkModule} from '../../../../src/modules/network/NetworkModule.js';
import type {NetworkServices} from '../../../../src/modules/network/NetworkTypes.js';

function frame(direction: 'sent' | 'received') {
  return {
    direction,
    timestamp: Date.now(),
    opcode: 1,
    payloadData: '{}',
  };
}

function services(): NetworkServices {
  return {
    getWebSocketConnectionById: () => ({
      connection: {url: 'wss://x', status: 'open'},
      frames: [frame('sent'), frame('received'), frame('sent')],
    }),
  } as unknown as NetworkServices;
}

describe('getWebSocketMessages direction both', () => {
  const networkModule = new NetworkModule();

  it('returns all frames when direction is both', async () => {
    const result = await networkModule.getWebSocketMessages(services(), {
      wsid: 1,
      direction: 'both',
      pageSize: 10,
    });
    assert.equal(result.success, true);
    assert.equal(result.data.pagination?.total, 3);
  });

  it('filters to sent when direction is sent', async () => {
    const result = await networkModule.getWebSocketMessages(services(), {
      wsid: 1,
      direction: 'sent',
      pageSize: 10,
    });
    assert.equal(result.data.pagination?.total, 2);
  });
});
