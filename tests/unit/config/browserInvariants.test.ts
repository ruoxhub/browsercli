/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {
  ENV_FALSE_VALUES,
  ENV_TRUE_VALUES,
  getEnvFlag,
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
    assert.deepStrictEqual([...ENV_TRUE_VALUES], ['true', '1', 'yes', 'on']);
    assert.deepStrictEqual([...ENV_FALSE_VALUES], ['false', '0', 'no', 'off']);
  });

  it('parses the same accepted values through getEnvBoolean and getEnvFlag', () => {
    const accepted = [
      ...ENV_TRUE_VALUES.map(value => [value, true] as const),
      ...ENV_FALSE_VALUES.map(value => [value, false] as const),
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
