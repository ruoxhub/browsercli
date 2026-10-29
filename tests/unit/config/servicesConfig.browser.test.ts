/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, test} from 'node:test';

import {BrowserConfigInvariantError} from '../../../src/config/browserInvariants.js';
import {resetRuntimeConfigStore} from '../../../src/config/RuntimeConfigStore.js';
import {getBrowserManagerConfig} from '../../../src/config/servicesConfig.js';
import type {BrowserManagerConfig} from '../../../src/types/browser.js';

test('getBrowserManagerConfig returns valid BrowserManagerConfig typed from L0', () => {
  const originalEnv = process.env.CHROME_HEADLESS;
  try {
    process.env.CHROME_HEADLESS = 'true';
    const config: BrowserManagerConfig = getBrowserManagerConfig();
    assert.equal(config.headless, true);
    assert.equal(typeof config, 'object');
  } finally {
    if (originalEnv === undefined) {
      delete process.env.CHROME_HEADLESS;
    } else {
      process.env.CHROME_HEADLESS = originalEnv;
    }
  }
});

describe('getBrowserManagerConfig ego fields (W3)', () => {
  const ENV_KEYS = ['BROWSER_EGO', 'BROWSER_KEEP_PAGE'] as const;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    // The file config must not leak into the assertions below.
    resetRuntimeConfigStore({});
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetRuntimeConfigStore({});
  });

  test('maps BROWSER_EGO onto config.ego', () => {
    // The MCP/getRuntime startup path reads browser config through this table;
    // without the entry the CLI (which sends a request body) and the daemon
    // (which reads env) would disagree about ego mode.
    process.env.BROWSER_EGO = 'true';
    assert.equal(getBrowserManagerConfig().ego, true);

    process.env.BROWSER_EGO = 'false';
    assert.equal(getBrowserManagerConfig().ego, false);
  });

  test('maps BROWSER_KEEP_PAGE onto config.keepPage when ego is selected', () => {
    // `keepPage` alone is rejected (I1): it is only read on the ego branch, so
    // accepting it would be a silent no-op. The pair is the accepted shape.
    process.env.BROWSER_EGO = 'true';
    process.env.BROWSER_KEEP_PAGE = 'true';
    assert.equal(getBrowserManagerConfig().keepPage, true);

    process.env.BROWSER_KEEP_PAGE = 'false';
    assert.equal(getBrowserManagerConfig().keepPage, false);
  });

  test('rejects BROWSER_KEEP_PAGE without BROWSER_EGO (I1)', () => {
    // Before the guard this returned `{keepPage: true, ego: undefined}`,
    // `ensureBrowser()` took the local-launch branch, and `keepPage` was never
    // read — the user believed it took effect and it did not.
    process.env.BROWSER_KEEP_PAGE = '1';
    assert.throws(
      () => getBrowserManagerConfig(),
      (error: unknown) => {
        assert.ok(
          error instanceof BrowserConfigInvariantError,
          'expected BrowserConfigInvariantError',
        );
        assert.strictEqual(error.code, 'VALIDATION');
        assert.match(error.message, /keepPage/);
        assert.match(error.message, /BROWSER_KEEP_PAGE/);
        assert.match(error.message, /BROWSER_EGO/);
        return true;
      },
    );

    // An explicit `BROWSER_EGO=false` does not select ego mode either.
    process.env.BROWSER_EGO = 'false';
    assert.throws(() => getBrowserManagerConfig(), BrowserConfigInvariantError);
  });

  test('accepts ego alone and ego + keepPage (I1)', () => {
    process.env.BROWSER_EGO = 'true';
    assert.equal(getBrowserManagerConfig().ego, true);
    assert.equal(getBrowserManagerConfig().keepPage, undefined);

    process.env.BROWSER_KEEP_PAGE = 'true';
    const config = getBrowserManagerConfig();
    assert.strictEqual(config.ego, true);
    assert.strictEqual(config.keepPage, true);
  });

  test('rejects a store/file config that only sets keepPage (I1)', () => {
    // The CLI flag, the IPC body, the env var and config.json all funnel into
    // this one merge, so the guard covers the store path as well.
    resetRuntimeConfigStore({browser: {keepPage: true}});
    assert.throws(() => getBrowserManagerConfig(), BrowserConfigInvariantError);
  });

  test('leaves both unset by default so no inherited policy reaches the bridge', () => {
    const config = getBrowserManagerConfig();
    // Unlike `cloak`, these two carry no `default: false`: an unset retention
    // policy must stay distinguishable from an explicit `BROWSER_KEEP_PAGE=false`
    // so the file config below can still win when no env var is present.
    assert.ok(!config.ego);
    assert.ok(!config.keepPage);
  });

  test('reads the file config keys when the env vars are absent', () => {
    resetRuntimeConfigStore({browser: {ego: true, keepPage: true}});
    const config = getBrowserManagerConfig();
    assert.strictEqual(config.ego, true);
    assert.strictEqual(config.keepPage, true);
  });
});
