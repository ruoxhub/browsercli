/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {NetworkModule} from '../../../../src/modules/network/NetworkModule.js';
import type {NetworkServices} from '../../../../src/modules/network/NetworkTypes.js';

interface TestRequest {
  url(): string;
  method(): string;
  postData(): string | null;
  resourceType(): string;
  headers(): Record<string, string>;
  response(): Promise<{
    status(): number;
    statusText?(): string;
    headers(): Record<string, string>;
  }>;
}

function createMockRequest(): TestRequest {
  return {
    url: () => 'https://api.example.com/v1/sign',
    method: () => 'POST',
    postData: () => '{"foo":"bar"}',
    resourceType: () => 'xhr',
    headers: () => ({
      'X-Sign': 'original-signature',
      'Content-Type': 'application/json',
      Host: 'api.example.com',
    }),
    response: async () => ({
      status: () => 200,
      headers: () => ({}),
    }),
  };
}

function createMockServices(
  overrides: {
    cookies?: Array<{name: string; value: string; domain: string}>;
    cookiesThrow?: boolean;
    getRequestById?: (id: number) => unknown;
  } = {},
): NetworkServices {
  const page = {
    context: () => ({
      cookies: async () => {
        if (overrides.cookiesThrow) {
          throw new Error('cookie read failed');
        }
        return overrides.cookies ?? [];
      },
    }),
  };
  return {
    resolvePage: () => ({page: page as any, pageId: 'page-1', pageIdx: 0}),
    getPages: () => [page as any],
    getSelectedPage: () => page as any,
    getNetworkRequests: () => [],
    getNetworkRequestsForPage: () => [],
    getNetworkRequestById:
      overrides.getRequestById ?? (() => createMockRequest() as any),
    getNetworkRequestStableId: () => 1,
    getRequestInitiator: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    clearNetworkRequests: () => {},
    clearNetworkRequestsForPage: () => {},
    getWebSocketConnections: () => [],
    getWebSocketConnectionById: () =>
      ({
        connection: {url: '', status: 'open', requestId: '', createdAt: 0},
        frames: [],
      }) as any,
    getWebSocketStableId: () => 0,
    getDevToolsData: async () => undefined,
    resolveCdpRequestId: () => undefined,
  } as NetworkServices;
}

describe('export_request_as_curl', () => {
  const networkModule = new NetworkModule();

  it('exports curl without Cookie header when includeCookies omitted', async () => {
    const services = createMockServices();

    const result = await networkModule.exportCurl(services, {reqid: 5});

    assert.equal(result.success, true);
    assert.equal(result.data.originalReqid, 5);
    assert.equal(result.data.override, null);
    assert.ok(
      result.data.curl.startsWith(
        "curl -X POST 'https://api.example.com/v1/sign'",
      ),
    );
    assert.ok(result.data.curl.includes("-H 'X-Sign: original-signature'"));
    assert.ok(result.data.curl.includes("-H 'Content-Type: application/json'"));
    assert.ok(
      !result.data.curl.includes('Host:'),
      'Host header should be stripped',
    );
    assert.ok(result.data.curl.includes('--data \'{"foo":"bar"}\''));
    assert.ok(!result.data.curl.includes('Cookie'));
  });

  it('exports curl with Cookie header when includeCookies=true and cookies match domain', async () => {
    const services = createMockServices({
      cookies: [
        {name: 'session', value: 'abc', domain: 'api.example.com'},
        {name: 'other', value: 'xyz', domain: 'other.test'},
      ],
    });

    const result = await networkModule.exportCurl(services, {
      reqid: 5,
      includeCookies: true,
    });

    assert.equal(result.success, true);
    assert.ok(result.data.curl.includes("-H 'Cookie: session=abc'"));
    assert.ok(
      !result.data.curl.includes('xyz'),
      'other.test cookie should be filtered out',
    );
  });

  it('matches cookies on subdomain (api.example.com cookie matches sub.api.example.com URL)', async () => {
    const services = createMockServices({
      cookies: [{name: 's', value: 'v', domain: 'api.example.com'}],
      getRequestById: () => ({
        ...createMockRequest(),
        url: () => 'https://sub.api.example.com/v1/sign',
      }),
    });

    const result = await networkModule.exportCurl(services, {
      reqid: 5,
      includeCookies: true,
    });

    assert.ok(result.data.curl.includes('Cookie: s=v'));
  });

  it('does not match cookies on lookalike domain (example.com cookie does not match evil-example.com)', async () => {
    const services = createMockServices({
      cookies: [{name: 's', value: 'v', domain: 'example.com'}],
      getRequestById: () => ({
        ...createMockRequest(),
        url: () => 'https://evil-example.com/v1/sign',
      }),
    });

    const result = await networkModule.exportCurl(services, {
      reqid: 5,
      includeCookies: true,
    });

    assert.ok(!result.data.curl.includes('Cookie'));
  });

  it('proceeds without cookies and notes failure when cookies() throws', async () => {
    const services = createMockServices({cookiesThrow: true});

    const result = await networkModule.exportCurl(services, {
      reqid: 5,
      includeCookies: true,
    });

    assert.equal(result.success, true);
    assert.ok(!result.data.curl.includes('Cookie'));
    assert.match(result.message, /Cookie 读取失败/);
  });

  it('returns failure when reqid is invalid', async () => {
    const services = createMockServices({
      getRequestById: () => {
        throw new Error('reqid not found');
      },
    });

    const result = await networkModule.exportCurl(services, {reqid: 999});

    assert.equal(result.success, false);
    assert.match(result.message, /reqid not found/);
    assert.equal(result.data.curl, '');
    assert.equal(result.data.originalReqid, 999);
  });

  it('applies overrides when building the curl command', async () => {
    const services = createMockServices();

    const result = await networkModule.exportCurl(services, {
      reqid: 5,
      method: 'PUT',
      url: 'https://api.example.com/v2/sign',
      headers: {'X-Test': '1'},
    });

    assert.ok(
      result.data.curl.startsWith(
        "curl -X PUT 'https://api.example.com/v2/sign'",
      ),
    );
    assert.ok(result.data.curl.includes("-H 'X-Test: 1'"));
    assert.equal(result.data.override.method, 'PUT');
  });
});
