/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {isReloadableOption} from '../../../src/config/options.js';
import {
  type ReadonlyServerConfig,
  ServerConfig,
} from '../../../src/config/ServerConfig.js';

describe('ServerConfig', () => {
  describe('validateConflicts', () => {
    it('accepts a single active argument from a conflict group', () => {
      ServerConfig.validateConflicts({browserUrl: 'http://127.0.0.1:9222'});
    });

    it('ignores false and undefined values', () => {
      ServerConfig.validateConflicts({
        browserUrl: 'http://127.0.0.1:9222',
        wsEndpoint: undefined,
        autoConnect: false,
      });
    });

    it('rejects mutually exclusive arguments', () => {
      assert.throws(
        () =>
          ServerConfig.validateConflicts({
            browserUrl: 'http://127.0.0.1:9222',
            channel: 'canary',
          }),
        /Arguments channel and browserUrl are mutually exclusive/,
      );
      assert.throws(
        () =>
          ServerConfig.validateConflicts({
            blockedUrlPattern: ['https://a.example/*'],
            allowedUrlPattern: ['https://b.example/*'],
          }),
        /Arguments blockedUrlPattern and allowedUrlPattern are mutually exclusive/,
      );
      assert.throws(
        () =>
          ServerConfig.validateConflicts({
            userDataDir: '/tmp/profile',
            isolated: true,
          }),
        /Arguments userDataDir and isolated are mutually exclusive/,
      );
    });
  });

  describe('validateImplications', () => {
    it('accepts wsHeaders when wsEndpoint is present', () => {
      ServerConfig.validateImplications({
        wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/1',
        wsHeaders: {Authorization: 'Bearer tok'},
      });
    });

    it('rejects wsHeaders without wsEndpoint', () => {
      assert.throws(
        () =>
          ServerConfig.validateImplications({
            wsHeaders: {Authorization: 'Bearer tok'},
          }),
        /Implications failed:\n {2}wsHeaders -> wsEndpoint/,
      );
    });
  });

  describe('layer precedence (CLI > env > file > cached)', () => {
    it('merges layers in strict precedence order and shallow-merges nested browser', () => {
      const cfg = ServerConfig.create({
        cachedArgs: {
          browser: {headless: false, channel: 'stable'},
          screenshotFormat: 'png',
        },
        fileArgs: {
          browser: {headless: true},
          screenshotFormat: 'jpeg',
          redactNetworkHeaders: true,
        },
        envArgs: {
          screenshotFormat: 'webp',
        },
        cliArgs: {
          headless: false,
        },
        configPath: '/tmp/config.json',
      });

      assert.equal(cfg.resolved.browser?.channel, 'stable');
      assert.equal(cfg.resolved.browser?.headless, true);
      assert.equal(cfg.resolved.headless, false);
      assert.equal(cfg.resolved.screenshotFormat, 'webp');
      assert.equal(cfg.resolved.redactNetworkHeaders, true);
      assert.equal(cfg.configPath, '/tmp/config.json');
    });
  });

  describe('mergeReloadable & withFileArgs', () => {
    it('applies reloadable changes while keeping restart-required options intact', () => {
      assert.equal(isReloadableOption('screenshotFormat'), true);
      assert.equal(isReloadableOption('blockedUrlPattern'), true);
      assert.equal(isReloadableOption('headless'), false);
      assert.equal(isReloadableOption('categoryExtensions'), false);

      const initial = ServerConfig.create({
        fileArgs: {
          headless: false,
          screenshotFormat: 'png',
          categoryNetwork: true,
        },
      });
      const candidate = initial.withFileArgs({
        headless: true,
        categoryExtensions: true,
        screenshotFormat: 'webp',
        categoryNetwork: false,
        blockedUrlPattern: ['https://ads.example/*'],
      });

      const merged = initial.mergeReloadable(candidate);
      assert.equal(merged.resolved.headless, false);
      assert.equal(merged.resolved.categoryExtensions, undefined);
      assert.equal(merged.resolved.screenshotFormat, 'webp');
      assert.equal(merged.resolved.categoryNetwork, false);
      assert.deepEqual(merged.resolved.blockedUrlPattern, [
        'https://ads.example/*',
      ]);
    });

    it('preserves CLI override over reloaded config file values', () => {
      const initial = ServerConfig.create({
        cliArgs: {screenshotFormat: 'jpeg'},
        fileArgs: {screenshotFormat: 'png', redactNetworkHeaders: false},
      });

      const candidate = initial.withFileArgs({
        screenshotFormat: 'webp',
        redactNetworkHeaders: true,
      });
      const merged = initial.mergeReloadable(candidate);

      assert.equal(merged.resolved.screenshotFormat, 'jpeg');
      assert.equal(merged.resolved.redactNetworkHeaders, true);
    });

    it('switches between blockedUrlPattern and allowedUrlPattern across reloads', () => {
      const initial = ServerConfig.create({
        fileArgs: {blockedUrlPattern: ['https://blocked.example/*']},
      });
      const next = initial.withFileArgs({
        allowedUrlPattern: ['https://allowed.example/*'],
      });
      const merged = initial.mergeReloadable(next);

      assert.equal(merged.resolved.blockedUrlPattern, undefined);
      assert.deepEqual(merged.resolved.allowedUrlPattern, [
        'https://allowed.example/*',
      ]);
    });

    it('rejects reloadable options conflicting with startup restart-required options', () => {
      const initial = ServerConfig.create({
        cliArgs: {browserUrl: 'http://127.0.0.1:9222'},
      });
      const next = ServerConfig.create({
        fileArgs: {categoryPwa: true},
      });

      assert.throws(
        () => initial.mergeReloadable(next),
        /Arguments categoryPwa and browserUrl are mutually exclusive/,
      );
    });
  });

  describe('getRestartRequiredChanges', () => {
    it('ignores reloadable changes and reports restart-required diffs by value', () => {
      const initial = ServerConfig.create({
        fileArgs: {
          headless: false,
          chromeArg: ['--foo'],
          screenshotFormat: 'png',
        },
      });
      const sameRestart = initial.withFileArgs({
        headless: false,
        chromeArg: ['--foo'],
        screenshotFormat: 'webp',
      });
      assert.deepEqual(initial.getRestartRequiredChanges(sameRestart), []);

      const changedRestart = initial.withFileArgs({
        headless: true,
        chromeArg: ['--bar'],
        screenshotFormat: 'webp',
      });
      assert.deepEqual(initial.getRestartRequiredChanges(changedRestart), [
        'chromeArg',
        'headless',
      ]);
    });
  });

  describe('commit', () => {
    it('updates resolved view in place for ReadonlyServerConfig holders', () => {
      const config = ServerConfig.create({
        cliArgs: {headless: true},
        fileArgs: {screenshotFormat: 'png'},
      });
      const readonlyView: ReadonlyServerConfig = config;

      const candidate = config.withFileArgs({screenshotFormat: 'webp'});
      config.commit(config.mergeReloadable(candidate));

      assert.equal(readonlyView.resolved.screenshotFormat, 'webp');
      assert.equal(readonlyView.resolved.headless, true);
    });
  });
});
