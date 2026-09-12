/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {PageController} from '../../../src/modules/collector/PageController.js';
import type {CapturedRequestInput} from '../../../src/modules/session/types.js';
import {RuntimeServices} from '../../../src/runtime/RuntimeServices.js';

describe('RuntimeServices', () => {
  it('returns stable analyzer instances', () => {
    const services = new RuntimeServices({} as PageController);

    assert.strictEqual(services.getWasmAnalyzer(), services.getWasmAnalyzer());
  });

  it('does not create wasm collector until requested', () => {
    const services = new RuntimeServices({} as PageController);

    assert.doesNotThrow(() => new RuntimeServices({} as PageController));
    assert.strictEqual(services.getWasmAnalyzer(), services.getWasmAnalyzer());
  });

  it('creates SourceMapService lazily and reuses it', () => {
    const services = new RuntimeServices({} as PageController);
    const first = services.getSourceMapService();
    assert.equal(services.getSourceMapService(), first);
  });

  it('creates the capture engine lazily and reuses it', () => {
    const services = new RuntimeServices({} as PageController, ':memory:');
    const engine = services.getCaptureEngine();
    assert.ok(engine);
    assert.strictEqual(services.getCaptureEngine(), engine);
  });

  it('shares one session store between manager and engine', () => {
    const services = new RuntimeServices({} as PageController, ':memory:');
    const engine = services.getCaptureEngine();
    const manager = services.getCaptureSessionManager();

    assert.strictEqual(manager.getActiveSession(), null);
    assert.ok(engine.ingestRequest(sampleInput));
    // 同库同连接：engine 写入的行，manager 立刻读得到（spec §7 约束 3）。
    const session = manager.getActiveSession();
    assert.ok(session);
    assert.strictEqual(session.name, 'default');
    assert.strictEqual(manager.getRequests(session.id).length, 1);
  });

  it('does not open the on-disk session db until a session service is requested', () => {
    const services = new RuntimeServices({} as PageController, ':memory:');
    assert.doesNotThrow(() => services.getWasmAnalyzer());
  });
});

const sampleInput: CapturedRequestInput = {
  timestamp: 1700000000000,
  method: 'GET',
  url: 'https://example.com/api',
  source: 'cdp',
  requestHeaders: '{}',
  requestBody: null,
  statusCode: 200,
  responseHeaders: '{}',
  responseBody: null,
  contentType: 'application/json',
  initiator: null,
  durationMs: 0,
  isStreaming: 0,
  isWebSocket: 0,
  truncated: 0,
};
