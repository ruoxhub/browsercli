/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {dirname} from 'node:path';
import {after, before, describe, it} from 'node:test';

import {
  deleteRuntimeConfig,
  loadCachedRuntimeConfig,
  persistRuntimeConfig,
  RUNTIME_CONFIG_PATH,
  shouldAutoConnectOnStartup,
} from '../../../src/config/runtimeConfigPersistence.js';
import type {GlobalConfig} from '../../../src/config/schema.js';

describe('runtimeConfigPersistence', () => {
  before(() => {
    mkdirSync(dirname(RUNTIME_CONFIG_PATH), {recursive: true});
  });

  after(() => {
    if (existsSync(RUNTIME_CONFIG_PATH)) rmSync(RUNTIME_CONFIG_PATH);
  });

  function seedFile(content: unknown): void {
    writeFileSync(RUNTIME_CONFIG_PATH, JSON.stringify(content), 'utf8');
  }

  describe('loadCachedRuntimeConfig', () => {
    it('returns undefined when no cache file exists', () => {
      if (existsSync(RUNTIME_CONFIG_PATH)) rmSync(RUNTIME_CONFIG_PATH);
      assert.strictEqual(loadCachedRuntimeConfig(), undefined);
    });

    it('loads persisted writable fields', () => {
      seedFile({
        browser: {browserURL: 'http://127.0.0.1:9222', headless: false},
        debug: true,
      });
      const loaded = loadCachedRuntimeConfig();
      assert.ok(loaded);
      assert.strictEqual(loaded?.browser?.browserURL, 'http://127.0.0.1:9222');
      // 非连接设置字段不应回填
      assert.strictEqual(loaded?.debug, undefined);
    });

    it('returns undefined on malformed JSON', () => {
      writeFileSync(RUNTIME_CONFIG_PATH, '{not-json', 'utf8');
      assert.strictEqual(loadCachedRuntimeConfig(), undefined);
    });

    it('accepts cache file with UTF-8 BOM', () => {
      writeFileSync(
        RUNTIME_CONFIG_PATH,
        '\uFEFF' +
          JSON.stringify({browser: {browserURL: 'http://127.0.0.1:9222'}}),
        'utf8',
      );
      const loaded = loadCachedRuntimeConfig();
      assert.ok(loaded);
      assert.strictEqual(loaded?.browser?.browserURL, 'http://127.0.0.1:9222');
    });

    it('returns undefined on invalid config', () => {
      seedFile({browser: {remoteDebuggingPort: 1}});
      assert.strictEqual(loadCachedRuntimeConfig(), undefined);
    });
  });

  describe('persistRuntimeConfig', () => {
    it('writes only writable fields', () => {
      const config: GlobalConfig = {
        browser: {wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/x'},
        debug: true,
      };
      persistRuntimeConfig(config);

      const raw = JSON.parse(readFileSync(RUNTIME_CONFIG_PATH, 'utf8'));
      assert.strictEqual(
        raw.browser.wsEndpoint,
        'ws://127.0.0.1:9222/devtools/browser/x',
      );
      assert.strictEqual(raw.debug, undefined);
    });
  });

  describe('shouldAutoConnectOnStartup', () => {
    it('true when wsEndpoint present', () => {
      assert.ok(
        shouldAutoConnectOnStartup({
          browser: {wsEndpoint: 'ws://x'},
        }),
      );
    });

    it('true when browserURL present', () => {
      assert.ok(
        shouldAutoConnectOnStartup({browser: {browserURL: 'http://x:9222'}}),
      );
    });

    it('false when only launch-mode fields present', () => {
      assert.strictEqual(
        shouldAutoConnectOnStartup({
          browser: {headless: false, channel: 'stable'},
        }),
        false,
      );
    });

    it('false when no browser config', () => {
      assert.strictEqual(shouldAutoConnectOnStartup({}), false);
    });
  });

  describe('deleteRuntimeConfig', () => {
    it('removes an existing cache file and reports success', () => {
      seedFile({browser: {browserURL: 'http://127.0.0.1:9222'}});
      assert.ok(existsSync(RUNTIME_CONFIG_PATH));
      assert.strictEqual(deleteRuntimeConfig(), true);
      assert.strictEqual(existsSync(RUNTIME_CONFIG_PATH), false);
    });

    // 返回 boolean 是给 Task 3 的 reset 路由用的：Windows 上 EPERM/EBUSY
    // （另一个进程抱着文件）很常见，吐掉错误会让 reset 假成功 200，
    // apiKey 留在盘上且下次启动回填。ENOENT = 本来就没有缓存 → true。
    it('returns true without throwing when the cache file is absent', () => {
      if (existsSync(RUNTIME_CONFIG_PATH)) rmSync(RUNTIME_CONFIG_PATH);
      assert.strictEqual(deleteRuntimeConfig(), true);
      assert.strictEqual(existsSync(RUNTIME_CONFIG_PATH), false);
    });
  });
});
