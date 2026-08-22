/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';

import {NetworkModule} from '../../../../src/modules/network/NetworkModule.js';
import type {NetworkServices} from '../../../../src/modules/network/NetworkTypes.js';

function createRequest(responseBody: string) {
  return {
    url: () => 'https://example.test/api',
    method: () => 'GET',
    postData: () => null,
    resourceType: () => 'xhr',
    headers: () => ({}),
    response: async () => ({
      status: () => 200,
      statusText: () => 'OK',
      headers: () => ({'content-type': 'application/json'}),
      text: async () => responseBody,
    }),
  };
}

function createServices(body: string): NetworkServices {
  const request = createRequest(body);
  return {
    resolvePage: () => {
      throw new Error('unused');
    },
    getPages: () => [],
    getSelectedPage: () => null,
    getNetworkRequests: () => [],
    getNetworkRequestsForPage: () => [],
    getNetworkRequestById: () => request as never,
    getNetworkRequestStableId: () => 101,
    getRequestInitiator: () => undefined,
    clearNetworkRequests: () => undefined,
    clearNetworkRequestsForPage: () => undefined,
    getWebSocketConnections: () => [],
    getWebSocketConnectionById: () => ({connection: {}, frames: []}) as never,
    getWebSocketStableId: () => 0,
    getDevToolsData: async () => undefined,
    resolveCdpRequestId: () => undefined,
  } as NetworkServices;
}

describe('getNetworkRequest body handling', () => {
  const networkModule = new NetworkModule();
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'getNetworkRequest-'));
  });

  after(async () => {
    await rm(tmpDir, {recursive: true, force: true});
  });

  it('truncates large bodies by default and reports metadata', async () => {
    const services = createServices('x'.repeat(5000));
    const result = await networkModule.getRequest(services, {reqid: 101});
    assert.equal(result.success, true);
    assert.equal(result.data.isTruncated, true);
    assert.equal(result.data.totalBodyLength, 5000);
    assert.ok(result.data.responseBody!.length < 5000);
    assert.equal(result.data.previewLength, result.data.responseBody!.length);
  });

  it('returns the full body when fullBody is set', async () => {
    const services = createServices('x'.repeat(5000));
    const result = await networkModule.getRequest(services, {
      reqid: 101,
      fullBody: true,
    });
    assert.equal(result.data.isTruncated, false);
    assert.equal(result.data.responseBody!.length, 5000);
  });

  it('writes body to disk when saveTo is set', async () => {
    const body = '{"a":1}';
    const services = createServices(body);
    const target = path.join(tmpDir, 'out.json');
    const result = await networkModule.getRequest(services, {
      reqid: 101,
      saveTo: target,
    });
    assert.equal(result.data.savedPath, target);
    assert.equal(result.data.responseBody, undefined);
    assert.equal(await readFile(target, 'utf8'), body);
  });
});
