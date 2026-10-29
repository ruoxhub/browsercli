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
  isEgoWithLaunchOnly,
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

  it('pins the accepted values', () => {
    // The parity test below only proves the two readers agree with each other, so
    // deleting `'on'` from the shared list would still pass everywhere — every
    // reader would simply stop accepting it. Pin the content itself so a silent
    // vocabulary change fails: BROWSER_EGO / BROWSER_KEEP_PAGE are documented as
    // accepting these words, and a shell exporting `BROWSER_EGO=on` must keep
    // meaning "ego on".
    assert.deepStrictEqual([...ENV_TRUE_VALUES], ['true', '1', 'yes', 'on']);
    assert.deepStrictEqual([...ENV_FALSE_VALUES], ['false', '0', 'no', 'off']);
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

describe('ego with launch-only flags', () => {
  it('flags every flag that only the local launch path reads', () => {
    // ego mode never runs `launchBrowser()`, so these are accepted-and-ignored
    // unless something rejects them. One case per flag, so a new flag that joins
    // the family without joining the guard fails here.
    for (const flag of [
      {cloak: true},
      {headless: false},
      {userDataDir: '/tmp/x'},
      {isolated: true},
      {minimalStealth: true},
      {fullStealthArgs: true},
      {jsStealth: true},
      {acceptInsecureCerts: true},
    ]) {
      assert.equal(
        isEgoWithLaunchOnly({ego: true, ...flag}),
        true,
        `${Object.keys(flag)[0]} must be rejected in ego mode`,
      );
    }
  });

  it('leaves ego alone, and leaves every other mode alone', () => {
    assert.equal(isEgoWithLaunchOnly({ego: true}), false);
    assert.equal(
      isEgoWithLaunchOnly({ego: false, cloak: true, headless: false}),
      false,
      'without ego these flags are live, not ignored',
    );
    assert.equal(isEgoWithLaunchOnly({cloak: true}), false);
  });
});
