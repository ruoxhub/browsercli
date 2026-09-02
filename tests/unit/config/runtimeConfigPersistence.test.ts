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
        llmProvider: 'openai',
        openai: {apiKey: 'sk-abc', baseURL: 'https://x/v1', model: 'gpt-4o'},
        browser: {browserURL: 'http://127.0.0.1:9222', headless: false},
        rpcHost: 'ws://ignored:1',
      });
      const loaded = loadCachedRuntimeConfig();
      assert.ok(loaded);
      assert.strictEqual(loaded?.llmProvider, 'openai');
      assert.strictEqual(loaded?.openai?.apiKey, 'sk-abc');
      assert.strictEqual(loaded?.browser?.browserURL, 'http://127.0.0.1:9222');
      // 启动期固定值不应回填
      assert.strictEqual(loaded?.rpcHost, undefined);
    });

    it('returns undefined on malformed JSON', () => {
      writeFileSync(RUNTIME_CONFIG_PATH, '{not-json', 'utf8');
      assert.strictEqual(loadCachedRuntimeConfig(), undefined);
    });

    it('returns undefined on invalid config', () => {
      seedFile({openai: {apiKey: ''}, llmProvider: 'openai'});
      assert.strictEqual(loadCachedRuntimeConfig(), undefined);
    });
  });

  describe('persistRuntimeConfig', () => {
    it('writes only writable fields', () => {
      const config: GlobalConfig = {
        llmProvider: 'openai',
        openai: {apiKey: 'sk-secret', model: 'gpt-4o'},
        browser: {wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/x'},
        rpcHost: 'ws://fixed:5612',
      };
      persistRuntimeConfig(config);

      const raw = JSON.parse(readFileSync(RUNTIME_CONFIG_PATH, 'utf8'));
      assert.strictEqual(raw.llmProvider, 'openai');
      assert.strictEqual(raw.openai.apiKey, 'sk-secret');
      assert.strictEqual(
        raw.browser.wsEndpoint,
        'ws://127.0.0.1:9222/devtools/browser/x',
      );
      assert.strictEqual(raw.rpcHost, undefined);
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
    it('removes an existing cache file', () => {
      seedFile({llmProvider: 'openai'});
      assert.ok(existsSync(RUNTIME_CONFIG_PATH));
      deleteRuntimeConfig();
      assert.strictEqual(existsSync(RUNTIME_CONFIG_PATH), false);
    });

    it('does not throw when the cache file is absent', () => {
      if (existsSync(RUNTIME_CONFIG_PATH)) rmSync(RUNTIME_CONFIG_PATH);
      assert.doesNotThrow(() => deleteRuntimeConfig());
    });
  });
});
