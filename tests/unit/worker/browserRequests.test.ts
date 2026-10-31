/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';

import {resetRuntimeConfigStore} from '../../../src/config/RuntimeConfigStore.js';
import {
  BrowserConfigRequestError,
  candidateBrowserConfig,
  effectiveBrowserConfig,
  parseBrowserConnectBody,
  parseBrowserDisconnectBody,
} from '../../../src/worker/browserRequests.js';

describe('parseBrowserConnectBody', () => {
  it('returns a ws-target patch and clears stale selectors', () => {
    const patch = parseBrowserConnectBody({
      wsEndpoint: 'ws://new/devtools',
      headless: false,
    });
    assert.strictEqual(patch.wsEndpoint, 'ws://new/devtools');
    assert.strictEqual(patch.headless, false);
    assert.strictEqual(patch.browserURL, undefined);
    assert.strictEqual(patch.channel, undefined);
    assert.strictEqual(patch.executablePath, undefined);
    assert.strictEqual(patch.remoteDebuggingUrl, undefined);
  });

  it('clears stale targets for HTTP and local selectors', () => {
    const http = parseBrowserConnectBody({browserURL: 'https://new:9222'});
    assert.strictEqual(http.browserURL, 'https://new:9222');
    assert.strictEqual(http.wsEndpoint, undefined);
    assert.strictEqual(http.remoteDebuggingUrl, undefined);

    const unadorned = parseBrowserConnectBody({browserURL: '127.0.0.1:53687'});
    assert.strictEqual(unadorned.browserURL, 'http://127.0.0.1:53687');

    const channel = parseBrowserConnectBody({channel: 'stable'});
    assert.strictEqual(channel.channel, 'stable');
    assert.strictEqual(channel.browserURL, undefined);
    assert.strictEqual(channel.executablePath, undefined);
    assert.strictEqual(channel.remoteDebuggingUrl, undefined);

    const path = parseBrowserConnectBody({executablePath: 'new-browser.exe'});
    assert.strictEqual(path.executablePath, 'new-browser.exe');
    assert.strictEqual(path.browserURL, undefined);
    assert.strictEqual(path.channel, undefined);
    assert.strictEqual(path.wsEndpoint, undefined);
  });

  it('rejects conflicts, invalid values, and unknown fields', () => {
    const cases: Array<[unknown, 'VALIDATION' | 'BROWSER_CONFIG_CONFLICT']> = [
      [null, 'VALIDATION'],
      [[], 'VALIDATION'],
      [
        {browserURL: 'http://host:9222', wsEndpoint: 'ws://host/devtools'},
        'BROWSER_CONFIG_CONFLICT',
      ],
      [{channel: 'stable', executablePath: 'a.exe'}, 'BROWSER_CONFIG_CONFLICT'],
      [
        {channel: 'stable', browserURL: 'http://host:9222'},
        'BROWSER_CONFIG_CONFLICT',
      ],
      [{browserURL: 'ftp://host'}, 'VALIDATION'],
      [{wsEndpoint: 'http://host'}, 'VALIDATION'],
      [{executablePath: ''}, 'VALIDATION'],
      [{viewport: {width: 0, height: 720}}, 'VALIDATION'],
      [{wsHeaders: {Authorization: 123}}, 'VALIDATION'],
      [{unknownField: true}, 'VALIDATION'],
    ];

    for (const [body, expectedCode] of cases) {
      assert.throws(
        () => parseBrowserConnectBody(body),
        (error: unknown) =>
          error instanceof BrowserConfigRequestError &&
          error.code === expectedCode,
        `expected ${expectedCode} for ${JSON.stringify(body)}`,
      );
    }
  });

  it('returns an empty patch for an empty body', () => {
    assert.deepEqual(parseBrowserConnectBody({}), {});
  });
});

describe('parseBrowserDisconnectBody', () => {
  it('accepts absent or literal-boolean force', () => {
    assert.strictEqual(parseBrowserDisconnectBody({}), false);
    assert.strictEqual(parseBrowserDisconnectBody({force: true}), true);
    assert.strictEqual(parseBrowserDisconnectBody({force: false}), false);
  });

  it('rejects non-boolean force and extra keys', () => {
    for (const body of [{force: 'true'}, {force: 1}, {force: true, extra: 1}]) {
      assert.throws(
        () => parseBrowserDisconnectBody(body),
        (error: unknown) =>
          error instanceof BrowserConfigRequestError &&
          error.code === 'VALIDATION',
        `expected VALIDATION for ${JSON.stringify(body)}`,
      );
    }
  });
});

describe('effectiveBrowserConfig and candidateBrowserConfig', () => {
  afterEach(() => {
    resetRuntimeConfigStore({});
  });

  it('merges runtime store browser overrides over the base config', () => {
    resetRuntimeConfigStore({
      browser: {headless: true, wsEndpoint: 'ws://runtime/devtools'},
    });
    const config = effectiveBrowserConfig();
    assert.strictEqual(config.headless, true);
    assert.strictEqual(config.wsEndpoint, 'ws://runtime/devtools');
  });

  it('candidateBrowserConfig commits the previewed config to store', () => {
    const {commit, config} = candidateBrowserConfig({headless: false});
    assert.strictEqual(config.headless, false);
    commit();
    assert.strictEqual(effectiveBrowserConfig().headless, false);
  });
});
