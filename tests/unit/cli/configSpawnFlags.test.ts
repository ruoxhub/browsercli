/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {mergeSpawnFlagsFromConfig} from '../../../src/cli/sessionArgs.js';

describe('mergeSpawnFlagsFromConfig', () => {
  it('appends boolean flags from config when absent from argv', () => {
    const merged = mergeSpawnFlagsFromConfig(['call', 'list_tools'], {
      headless: 'true',
      cloak: 'false',
    });
    assert.ok(merged.includes('--headless'));
    assert.ok(!merged.includes('--cloak'));
  });

  it('appends value flags in --flag=value form', () => {
    const merged = mergeSpawnFlagsFromConfig([], {
      browserUrl: 'http://127.0.0.1:9222',
    });
    assert.ok(merged.includes('--browserUrl=http://127.0.0.1:9222'));
  });

  it('explicit argv flags win over config-file values', () => {
    const merged = mergeSpawnFlagsFromConfig(
      ['--headless', '--browserUrl=http://127.0.0.1:9999'],
      {headless: 'false', browserUrl: 'http://127.0.0.1:9222'},
    );
    // argv 的 --headless 已存在，不再追加（true/false 无法表达“覆盖为 false”，
    // 布尔语义：显式出现过该 flag 即以 argv 为准）
    assert.equal(merged.filter(f => f === '--headless').length, 1);
    // argv 的 --browserUrl 已存在，config 的值不追加
    assert.ok(merged.includes('--browserUrl=http://127.0.0.1:9999'));
    assert.ok(!merged.includes('--browserUrl=http://127.0.0.1:9222'));
  });

  it('passes through existing whitelisted argv spawn flags untouched', () => {
    const merged = mergeSpawnFlagsFromConfig(
      ['--js-stealth', '--console-port=9000'],
      {},
    );
    assert.ok(merged.includes('--js-stealth'));
    assert.ok(merged.includes('--console-port=9000'));
  });

  it('ignores config keys with falsy string values', () => {
    const merged = mergeSpawnFlagsFromConfig([], {
      headless: 'false',
      browserUrl: undefined,
    });
    assert.equal(merged.length, 0);
  });
});
