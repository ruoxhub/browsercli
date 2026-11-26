/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, it, mock} from 'node:test';

import {ConfigLocator} from '../../../src/config/ConfigLocator.js';
import {ConfigParser} from '../../../src/config/ConfigParser.js';
import {
  DEFAULT_FILESYSTEM_ROOT,
  isReloadableOption,
} from '../../../src/config/options.js';
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

  describe('applyDefaults and ConfigParser integration', () => {
    afterEach(() => {
      mock.restoreAll();
    });

    function parseWithArgs(argv: string[] = [], env: NodeJS.ProcessEnv = {}) {
      const locator = new ConfigLocator();
      mock.method(locator, 'locate', () => undefined);
      return new ConfigParser(
        '0.0.0',
        ['node', 'main.js', ...argv],
        env,
        false,
        locator,
      ).parseConfig();
    }

    it('keeps explicit values and fills in defaults', () => {
      const args = ServerConfig.applyDefaults({headless: true}, {env: {}});
      assert.equal(args.headless, true);
      assert.equal(args.isolated, false);
      assert.equal(args.channel, 'stable');
      assert.equal(args.categoryExtensions, undefined);
    });

    it('drops unknown CLI keys that are not in serverOptions', () => {
      mock.method(console, 'error', () => undefined);
      const config = parseWithArgs(['--unknownFlag=value']);
      assert.equal('unknownFlag' in config.resolved, false);
    });

    for (const explicitArgs of [
      {browserUrl: 'http://127.0.0.1:9222'},
      {wsEndpoint: 'ws://127.0.0.1:9222'},
      {executablePath: '/tmp/chrome'},
    ]) {
      it(`does not default channel with ${Object.keys(explicitArgs)[0]}`, () => {
        assert.equal(
          ServerConfig.applyDefaults(explicitArgs, {env: {}}).channel,
          undefined,
        );
      });
    }

    it('applies viaCli defaults when launching a browser', () => {
      const args = ServerConfig.applyDefaults(
        {
          viaCli: true,
          filesystemRoot: DEFAULT_FILESYSTEM_ROOT,
        },
        {env: {}},
      );
      assert.equal(args.headless, true);
      assert.equal(args.isolated, true);
      assert.equal(args.categoryExtensions, true);
      assert.equal(args.allowUnrestrictedPaths, true);
      assert.equal(args.filesystemRoot, undefined);
      assert.equal(args.pageIdRouting, true);
    });

    it('keeps default filesystemRoot for viaCli with explicit allowUnrestrictedPaths=false', () => {
      const args = ServerConfig.applyDefaults(
        {
          viaCli: true,
          allowUnrestrictedPaths: false,
        },
        {env: {}},
      );
      assert.equal(args.allowUnrestrictedPaths, false);
      assert.deepEqual(args.filesystemRoot, DEFAULT_FILESYSTEM_ROOT);
    });

    it('does not enable isolated or extensions for viaCli with browserUrl', () => {
      const args = ServerConfig.applyDefaults(
        {
          viaCli: true,
          browserUrl: 'http://127.0.0.1:9222',
        },
        {env: {}},
      );
      assert.equal(args.isolated, false);
      assert.equal(args.categoryExtensions, undefined);
    });

    it('turns off usage statistics in CI and prints notice once across reloads', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcli-ci-'));
      try {
        const configPath = path.join(tmpDir, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify({headless: true}), 'utf-8');
        const consoleError = mock.method(console, 'error', () => undefined);
        const locator = new ConfigLocator();
        mock.method(locator, 'locate', () => configPath);
        const ciParser = new ConfigParser(
          '0.0.0',
          ['node', 'main.js'],
          {CI: 'true'},
          false,
          locator,
        );

        ciParser.parseConfig();
        const reloaded = ciParser.reloadConfig();

        assert.equal(reloaded.resolved.usageStatistics, false);
        assert.equal(consoleError.mock.callCount(), 1);
      } finally {
        fs.rmSync(tmpDir, {recursive: true, force: true});
      }
    });

    it('applies env overrides when merging reloadable options', () => {
      const initial = parseWithArgs();
      const next = parseWithArgs();

      const mergedWithCi = initial.mergeReloadable(next, {
        env: {CI: 'true'},
      }).resolved;
      const mergedWithoutCi = initial.mergeReloadable(next).resolved;

      assert.equal(mergedWithCi.usageStatistics, false);
      assert.equal(mergedWithoutCi.usageStatistics, true);
    });

    it('ignores restart-required options whose defaults are derived from other options', () => {
      const previous = parseWithArgs(['--viaCli']);
      const next = parseWithArgs([
        '--viaCli',
        '--browserUrl=http://127.0.0.1:9222',
      ]);

      assert.equal(previous.resolved.categoryExtensions, true);
      assert.equal(next.resolved.categoryExtensions, undefined);
      assert.equal(previous.resolved.isolated, true);
      assert.equal(next.resolved.isolated, false);
      assert.equal(previous.resolved.channel, 'stable');
      assert.equal(next.resolved.channel, undefined);
      assert.deepEqual(previous.getRestartRequiredChanges(next), [
        'browserUrl',
      ]);
    });
  });
});
