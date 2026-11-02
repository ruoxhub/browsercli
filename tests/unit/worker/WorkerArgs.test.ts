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
      headless: true,
      wsEndpoint: 'ws://browser',
    });
  });

  it('ignores unknown and missing-value flags without consuming next flags', () => {
    const config = parseWorkerArgs([
      '--browserUrl',
      '--headless',
      '--unknown',
      'value',
    ]);

    assert.deepStrictEqual(config, {
      headless: true,
    });
  });

  it('parses `--flag=value` form used by config-file spawn flags', () => {
    const config = parseWorkerArgs([
      '--browserUrl=http://127.0.0.1:9222',
      '--wsEndpoint=ws://browser',
      '--executablePath=C:/Chrome/chrome.exe',
      '--browserUrl=',
    ]);

    assert.deepStrictEqual(config, {
      browserUrl: 'http://127.0.0.1:9222',
      executablePath: 'C:/Chrome/chrome.exe',
      wsEndpoint: 'ws://browser',
    });
  });

  it('parses migrated chrome-devtools options into GlobalConfig', () => {
    const config = parseWorkerArgs([
      '-u',
      'http://127.0.0.1:9222',
      '--categoryNavigation=false',
      '--no-categoryInput',
      '--categoryDebugging',
      '--proxyServer',
      'http://10.0.0.1:8080',
      '--screenshotFormat=webp',
      '--screenshotMaxWidth=1280',
      '--chromeArg=--no-sandbox,--disable-gpu',
      '--blockedUrlPattern',
      '*://adservice.google.com/*',
      '--watchConfig',
    ]);

    assert.strictEqual(config.browserUrl, 'http://127.0.0.1:9222');
    assert.strictEqual(config.categoryNavigation, false);
    assert.strictEqual(config.categoryInput, false);
    assert.strictEqual(config.categoryDebugging, true);
    assert.strictEqual(config.proxyServer, 'http://10.0.0.1:8080');
    assert.strictEqual(config.screenshotFormat, 'webp');
    assert.strictEqual(config.screenshotMaxWidth, '1280');
    assert.deepStrictEqual(config.chromeArg, ['--no-sandbox', '--disable-gpu']);
    assert.deepStrictEqual(config.blockedUrlPattern, [
      '*://adservice.google.com/*',
    ]);
    assert.strictEqual(config.watchConfig, true);
  });

  it('maps resolved config into WorkerStartOptions', () => {
    const options = toWorkerOptions({
      browserUrl: 'http://127.0.0.1:9222',
      executablePath: undefined,
      headless: false,
      wsEndpoint: undefined,
    });

    assert.deepStrictEqual(options, {
      browserUrl: 'http://127.0.0.1:9222',
      executablePath: undefined,
      headless: false,
      wsEndpoint: undefined,
    });
  });
});
