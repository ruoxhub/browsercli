/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, it} from 'node:test';

import {
  formatConfigValidationError,
  GlobalConfigSchema,
  resolveConfig,
  validateGlobalConfig,
} from '../../../src/config.js';

describe('config schema validation', {concurrency: false}, () => {
  const originalEnv = {...process.env};

  afterEach(() => {
    process.env = {...originalEnv};
  });

  it('parses valid global config and coerces numeric strings', () => {
    const config = validateGlobalConfig({
      browser: {
        channel: 'chrome-beta',
        viewport: {width: '1440', height: '900'},
        remoteDebuggingPort: '9222',
        waitForBrowserPollMs: '250',
        args: ['--disable-dev-shm-usage'],
      },
      toolResultRecording: {
        enabled: 'true',
        outputDir: '~/.jsreverse/tool-results',
      },
      sessionStateTtlMs: '60000',
    });

    assert.strictEqual(config.browser?.remoteDebuggingPort, 9222);
    assert.strictEqual(config.browser?.channel, 'beta');
    assert.deepStrictEqual(config.browser?.viewport, {
      width: 1440,
      height: 900,
    });
    assert.strictEqual(config.browser?.waitForBrowserPollMs, 250);
    assert.strictEqual(config.toolResultRecording?.enabled, true);
    assert.strictEqual(
      config.toolResultRecording?.outputDir,
      '~/.jsreverse/tool-results',
    );
    assert.strictEqual(config.sessionStateTtlMs, 60000);
  });

  it('rejects invalid browser port with readable path details', () => {
    assert.throws(
      () =>
        validateGlobalConfig({
          browser: {remoteDebuggingPort: 70000},
        }),
      /browser\.remoteDebuggingPort/,
    );
  });

  it('formats nested schema errors as user-facing config paths', () => {
    const result = GlobalConfigSchema.safeParse({
      browser: {
        channel: 'nightly',
        viewport: {width: 0, height: 900},
      },
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      const message = formatConfigValidationError(result.error);
      assert.match(message, /browser\.channel/);
      assert.match(message, /browser\.viewport\.width/);
    }
  });

  it('accepts moz-firefox channel without aliasing it', () => {
    const config = validateGlobalConfig({
      browser: {channel: 'moz-firefox'},
    });
    assert.strictEqual(config.browser?.channel, 'moz-firefox');
  });

  it('accepts firefox channel as a plain Firefox launcher hint', () => {
    const config = validateGlobalConfig({
      browser: {channel: 'firefox'},
    });
    assert.strictEqual(config.browser?.channel, 'firefox');
  });

  it('accepts bidi-chrome channel without aliasing it', () => {
    const config = validateGlobalConfig({
      browser: {channel: 'bidi-chrome'},
    });
    assert.strictEqual(config.browser?.channel, 'bidi-chrome');
  });

  it('accepts bidi-chromium channel without aliasing it', () => {
    const config = validateGlobalConfig({
      browser: {channel: 'bidi-chromium'},
    });
    assert.strictEqual(config.browser?.channel, 'bidi-chromium');
  });

  it('resolves config from user config file (~/.browsercli/config.json)', () => {
    const tmpDir = mkdtempSync(
      path.join(os.tmpdir(), 'browsercli-resolve-test-'),
    );
    process.env.PROXYCLI_CONFIG_DIR = tmpDir;
    try {
      writeFileSync(
        path.join(tmpDir, 'config.json'),
        JSON.stringify({
          headless: true,
          browserUrl: 'http://127.0.0.1:9222',
        }),
        'utf-8',
      );

      const config = resolveConfig();
      assert.strictEqual(config.headless, true);
      assert.strictEqual(config.browserUrl, 'http://127.0.0.1:9222');
    } finally {
      delete process.env.PROXYCLI_CONFIG_DIR;
      rmSync(tmpDir, {recursive: true, force: true});
    }
  });

  it('allows overriding user config file with explicit arguments', () => {
    const tmpDir = mkdtempSync(
      path.join(os.tmpdir(), 'browsercli-resolve-test-'),
    );
    process.env.PROXYCLI_CONFIG_DIR = tmpDir;
    try {
      writeFileSync(
        path.join(tmpDir, 'config.json'),
        JSON.stringify({
          headless: true,
          browserUrl: 'http://127.0.0.1:9222',
        }),
        'utf-8',
      );

      const config = resolveConfig({headless: false});
      assert.strictEqual(config.headless, false);
      assert.strictEqual(config.browserUrl, 'http://127.0.0.1:9222');
    } finally {
      delete process.env.PROXYCLI_CONFIG_DIR;
      rmSync(tmpDir, {recursive: true, force: true});
    }
  });
});
