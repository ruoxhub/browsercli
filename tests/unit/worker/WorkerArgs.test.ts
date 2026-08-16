/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  parseWorkerArgs,
  toWorkerOptions,
} from '../../../src/worker/WorkerArgs.js';

describe('WorkerArgs', () => {
  it('parses supported worker flags into GlobalConfig', () => {
    const config = parseWorkerArgs([
      '--rpcHost',
      'ws://127.0.0.1:5612',
      '--group',
      'reverse',
      '--browserUrl',
      'http://127.0.0.1:9222',
      '--wsEndpoint',
      'ws://browser',
      '--headless',
      '--executablePath',
      'C:/Chrome/chrome.exe',
    ]);

    assert.deepStrictEqual(config, {
      browserUrl: 'http://127.0.0.1:9222',
      executablePath: 'C:/Chrome/chrome.exe',
      group: 'reverse',
      headless: true,
      rpcHost: 'ws://127.0.0.1:5612',
      wsEndpoint: 'ws://browser',
    });
  });

  it('ignores unknown and missing-value flags without consuming next flags', () => {
    const config = parseWorkerArgs([
      '--browserUrl',
      '--headless',
      '--unknown',
      'value',
      '--group',
      'reverse',
    ]);

    assert.deepStrictEqual(config, {
      group: 'reverse',
      headless: true,
    });
  });

  it('maps resolved config into WorkerStartOptions', () => {
    const options = toWorkerOptions({
      browserUrl: 'http://127.0.0.1:9222',
      executablePath: undefined,
      group: 'reverse',
      headless: false,
      rpcHost: 'ws://127.0.0.1:5612',
      wsEndpoint: undefined,
    });

    assert.deepStrictEqual(options, {
      browserUrl: 'http://127.0.0.1:9222',
      executablePath: undefined,
      group: 'reverse',
      headless: false,
      rpcHost: 'ws://127.0.0.1:5612',
      wsEndpoint: undefined,
    });
  });
});
