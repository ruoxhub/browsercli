/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';

import {NetworkMockManager} from '../../../../src/modules/network/NetworkMockManager.js';
import {NetworkModule} from '../../../../src/modules/network/NetworkModule.js';
import type {NetworkServices} from '../../../../src/modules/network/NetworkTypes.js';
import {mockNetwork} from '../../../../src/tools/network.js';
import {removeNetworkMock} from '../../../../src/tools/network.js';
import {ErrorCodes, ToolError} from '../../../../src/utils/errors.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

describe('mock_network, remove_network_mock & request/response file paths', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'mockNetwork-test-'));
  });

  after(async () => {
    await rm(tmpDir, {recursive: true, force: true});
  });

  it('rejects conflicting body + upstream on mock_network', async () => {
    const response = new ToolResponseAccumulator();
    await assert.rejects(
      mockNetwork.handler(
        {
          params: {
            route: 'https://example.com/*',
            body: './a.json',
            upstream: 'https://localhost:3000/mock',
          },
        },
        response,
        {} as never,
      ),
      (err: unknown) =>
        err instanceof ToolError && err.code === ErrorCodes.VALIDATION,
    );
  });

  it('lists existing mocks when no action params are provided', async () => {
    const response = new ToolResponseAccumulator();
    await mockNetwork.handler(
      {params: {route: 'https://example.com/api/*'}},
      response,
      {
        mockNetwork: async () => {
          throw new Error('should not be called when listing');
        },
        listNetworkMocks: () => [
          {
            id: 1,
            urlPattern: 'https://example.com/api/*',
            kind: 'upstream',
            upstreamUrl: 'https://httpbin.org/get',
            diagnostics: {hits: 0, errors: 0, navigations: 0},
          },
        ],
      } as never,
    );
    const data = (
      response.toJSON().structuredContent as Record<string, unknown>
    ).data as Record<string, unknown>;
    assert.equal((data.mocks as unknown[]).length, 1);
  });

  it('manages add/update/list/remove lifecycle in NetworkMockManager', async () => {
    const routes: Array<{url: unknown; handler: unknown}> = [];
    const unroutes: unknown[] = [];
    const fakePage = {
      route: async (url: unknown, handler: unknown) => {
        routes.push({url, handler});
      },
      unroute: async (url: unknown) => {
        unroutes.push(url);
      },
    };
    const manager = new NetworkMockManager(fakePage as never);

    const created = await manager.mock({
      urlPattern: 'https://api.example.com/*',
      resourceType: 'fetch',
      kind: 'upstream',
      upstreamUrl: 'https://localhost:9000/proxy',
    });
    assert.equal(created.id, 1);
    assert.equal(routes.length, 1);

    const localBodyFile = path.join(tmpDir, 'payload.json');
    await writeFile(localBodyFile, '{"ok":true}', 'utf-8');

    const updated = await manager.mock({
      urlPattern: 'https://api.example.com/*',
      resourceType: 'fetch',
      kind: 'file',
      responseFilePath: localBodyFile,
      loadResponseFile: async () =>
        new Uint8Array(await readFile(localBodyFile)),
    });
    assert.equal(updated.id, 1);
    assert.equal(updated.kind, 'file');
    assert.equal(manager.list().length, 1);

    const removed = await manager.remove({
      urlPattern: 'https://api.example.com/*',
      resourceType: 'fetch',
    });
    assert.equal(removed, 1);
    assert.equal(manager.list().length, 0);
    assert.equal(unroutes.length, 1);
  });

  it('remove_network_mock returns removed count', async () => {
    const response = new ToolResponseAccumulator();
    await removeNetworkMock.handler(
      {params: {route: 'https://api.example.com/*'}},
      response,
      {
        removeNetworkMocks: async () => 2,
      } as never,
    );
    const data = (
      response.toJSON().structuredContent as Record<string, unknown>
    ).data as Record<string, unknown>;
    assert.equal(data.removedCount, 2);
  });

  it('NetworkModule.getRequest saves requestFilePath and responseFilePath independently', async () => {
    const networkModule = new NetworkModule();
    const request = {
      url: () => 'https://api.example.com/submit',
      method: () => 'POST',
      resourceType: () => 'xhr',
      postData: () => '{"hello":"world"}',
      headers: () => ({'content-type': 'application/json'}),
      response: async () => ({
        status: () => 200,
        statusText: () => 'OK',
        headers: () => ({'content-type': 'application/json'}),
        text: async () => '{"result":42}',
        body: async () => Buffer.from('{"result":42}'),
      }),
    };
    const services = {
      resolvePage: () => {
        throw new Error('unused');
      },
      getPages: () => [],
      getSelectedPage: () => null,
      getNetworkRequests: () => [],
      getNetworkRequestsForPage: () => [],
      getNetworkRequestById: () => request as never,
      getNetworkRequestStableId: () => 5,
      getRequestInitiator: () => undefined,
      clearNetworkRequests: () => undefined,
      clearNetworkRequestsForPage: () => undefined,
      getWebSocketConnections: () => [],
      getWebSocketConnectionById: () => ({connection: {}, frames: []}) as never,
      getWebSocketStableId: () => 0,
      getDevToolsData: async () => undefined,
      resolveCdpRequestId: () => undefined,
    } as NetworkServices;

    const reqFile = path.join(tmpDir, 'nested', 'req.json');
    const respFile = path.join(tmpDir, 'nested', 'resp.json');
    const result = await networkModule.getRequest(services, {
      reqid: 5,
      requestFilePath: reqFile,
      responseFilePath: respFile,
    });
    assert.equal(result.success, true);
    assert.equal(result.data.requestSavedPath, reqFile);
    assert.equal(result.data.responseSavedPath, respFile);
    assert.equal(await readFile(reqFile, 'utf-8'), '{"hello":"world"}');
    assert.equal(await readFile(respFile, 'utf-8'), '{"result":42}');
  });
});
