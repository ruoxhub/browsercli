/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {
  assertBrowserConfigInvariants,
  BrowserConfigInvariantError,
  ENV_FALSE_VALUES,
  ENV_TRUE_VALUES,
  getEnvFlag,
  isEgoWithTarget,
  isKeepPageWithoutEgo,
  withConfigFileHint,
} from '../../../src/config/browserInvariants.js';
import {getEnvBoolean} from '../../../src/config/resolver.js';

describe('env boolean vocabulary', () => {
  const KEY = 'BROWSERCLI_TEST_ENV_BOOLEAN';
  const original = process.env[KEY];

  beforeEach(() => {
    delete process.env[KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('parses the same accepted values through getEnvBoolean and getEnvFlag', () => {
    // Both readers used to carry their own copy of the vocabulary, which could
    // drift silently: BROWSER_EGO/BROWSER_KEEP_PAGE go through getEnvFlag (the CLI
    // cannot import resolver), everything else through getEnvBoolean. Since
    // resolver now delegates to the shared parser this pins the delegation.
    const accepted = [
      ...ENV_TRUE_VALUES.map(value => [value, true] as const),
      ...ENV_FALSE_VALUES.map(value => [value, false] as const),
      // The vocabulary is applied after normalisation, so case and whitespace
      // must not change the verdict in either reader.
      ...ENV_TRUE_VALUES.map(
        value => [`  ${value.toUpperCase()} `, true] as const,
      ),
    ];
    for (const [raw, expected] of accepted) {
      process.env[KEY] = raw;
      assert.strictEqual(
        getEnvBoolean(KEY),
        expected,
        `getEnvBoolean(${JSON.stringify(raw)})`,
      );
      assert.strictEqual(
        getEnvFlag(KEY),
        expected,
        `getEnvFlag(${JSON.stringify(raw)})`,
      );
    }
  });

  it('falls back to the default for unset, empty and unrecognised values', () => {
    const unrecognised = ['', '  ', 'truthy', '2', 'enabled', 'offf'];
    for (const raw of unrecognised) {
      if (raw === '') delete process.env[KEY];
      else process.env[KEY] = raw;
      assert.strictEqual(getEnvBoolean(KEY, undefined), undefined, raw);
      assert.strictEqual(getEnvBoolean(KEY, true), true, raw);
      assert.strictEqual(getEnvBoolean(KEY, false), false, raw);
      assert.strictEqual(getEnvFlag(KEY), undefined, raw);
    }
  });
});

describe('ego config predicates', () => {
  it('treats keepPage as meaningful only under ego', () => {
    assert.strictEqual(isKeepPageWithoutEgo({keepPage: true}), true);
    assert.strictEqual(
      isKeepPageWithoutEgo({keepPage: true, ego: false}),
      true,
    );
    assert.strictEqual(isKeepPageWithoutEgo({keepPage: false}), false);
    assert.strictEqual(
      isKeepPageWithoutEgo({keepPage: true, ego: true}),
      false,
    );
  });

  it('treats ego as mutually exclusive with each connection target', () => {
    for (const target of [
      {browserURL: 'http://127.0.0.1:9222'},
      {wsEndpoint: 'ws://127.0.0.1:1/x'},
      {channel: 'stable'},
      {executablePath: 'C:/browser.exe'},
    ]) {
      assert.strictEqual(isEgoWithTarget({ego: true, ...target}), true);
      assert.strictEqual(isEgoWithTarget({ego: false, ...target}), false);
    }
    assert.strictEqual(isEgoWithTarget({ego: true}), false);
  });

  it('assert throws only for keepPage without ego', () => {
    assert.doesNotThrow(() => assertBrowserConfigInvariants({ego: true}));
    assert.doesNotThrow(() =>
      assertBrowserConfigInvariants({ego: true, keepPage: true}),
    );
    assert.throws(
      () => assertBrowserConfigInvariants({keepPage: true}),
      (error: unknown) => {
        assert.ok(error instanceof BrowserConfigInvariantError);
        assert.strictEqual(error.code, 'VALIDATION');
        assert.match(error.message, /keepPage/);
        assert.match(error.message, /BROWSER_EGO/);
        return true;
      },
    );
  });

  it('names the files and env vars a stale keepPage needs edited', () => {
    // The bare message names both keys but no file. Daemon startup turns this into
    // a hard exit, so "which file do I edit" is the only useful remaining question.
    const original = new BrowserConfigInvariantError('keepPage 需要 ego');
    const hinted = withConfigFileHint(original, {
      configFile: 'C:/Users/x/.browsercli/config.json',
      runtimeFile: 'C:/Users/x/.browsercli/runtime-config.json',
    });
    assert.ok(hinted instanceof BrowserConfigInvariantError);
    assert.strictEqual(hinted.code, 'VALIDATION');
    assert.match(hinted.message, /C:\/Users\/x\/\.browsercli\/config\.json/);
    assert.match(
      hinted.message,
      /C:\/Users\/x\/\.browsercli\/runtime-config\.json/,
    );
    assert.match(hinted.message, /BROWSER_KEEP_PAGE/);
    assert.match(hinted.message, /browser\.keepPage/);
  });
});
