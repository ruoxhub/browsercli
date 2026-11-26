/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {browserOptions} from '../../../src/config/browser-options.js';
import {
  categoryToFlagName,
  ConfigToolCategory,
  getCategoryOptions,
  getOffByDefaultCategories,
  isCategoryOffByDefault,
} from '../../../src/config/category-options.js';
import {runtimeOptions} from '../../../src/config/runtime-options.js';
import {
  getCliOptions,
  isReloadableOption,
  serverOptions,
  stripYargsPositionalArgs,
  withoutDefaults,
} from '../../../src/config/server-options.js';
import {toolOptions} from '../../../src/config/tool-options.js';
import {validateUrlPatterns} from '../../../src/config/urlPattern.js';

describe('modular config options', () => {
  describe('urlPattern', () => {
    it('accepts valid URL patterns', () => {
      validateUrlPatterns(
        [
          'https://example.com/*',
          '*://*.google.com/api/*',
          'https://127.0.0.1:9222/*',
        ],
        '--blockedUrlPattern',
      );
    });

    it('rejects partial IPv4 wildcards, regexp groups, and named groups', () => {
      assert.throws(
        () => validateUrlPatterns(['*://127.0.0.*/*'], '--blockedUrlPattern'),
        /partial IPv4 wildcard/,
      );
      assert.throws(
        () =>
          validateUrlPatterns(
            ['https://(foo|bar).com/*'],
            '--blockedUrlPattern',
          ),
        /regexp group/,
      );
      assert.throws(
        () =>
          validateUrlPatterns(
            ['https://example.com/:id'],
            '--allowedUrlPattern',
          ),
        /":name" named group/,
      );
    });

    it('rejects invalid URLPattern syntax', () => {
      assert.throws(
        () =>
          validateUrlPatterns(['not a valid [pattern'], '--blockedUrlPattern'),
        /Invalid --blockedUrlPattern/,
      );
    });
  });

  describe('category-options', () => {
    it('marks off-by-default categories without a default property', () => {
      const options = getCategoryOptions();
      assert.equal(options.categoryInput.default, true);
      assert.equal(options.categoryInput.reloadable, true);
      assert.equal('default' in options.categoryExtensions, false);
      assert.equal(options.categoryExtensions.reloadable, false);
      assert.equal(options.categoryNetworkMocks.reloadable, false);
      assert.equal(isCategoryOffByDefault(ConfigToolCategory.EXTENSIONS), true);
      assert.equal(isCategoryOffByDefault(ConfigToolCategory.INPUT), false);
      assert.ok(
        getOffByDefaultCategories().includes(ConfigToolCategory.EXTENSIONS),
      );
      assert.equal(
        categoryToFlagName(ConfigToolCategory.NETWORK_MOCKS),
        'categoryNetworkMocks',
      );
    });
  });

  describe('coercions and helpers', () => {
    it('validates browserUrl, wsEndpoint, and wsHeaders', () => {
      assert.equal(
        browserOptions.browserUrl.coerce?.('http://127.0.0.1:9222'),
        'http://127.0.0.1:9222',
      );
      assert.throws(
        () => browserOptions.browserUrl.coerce?.('not-a-url'),
        /not valid URL/,
      );

      assert.equal(
        browserOptions.wsEndpoint.coerce?.(
          'ws://127.0.0.1:9222/devtools/browser/1',
        ),
        'ws://127.0.0.1:9222/devtools/browser/1',
      );
      assert.throws(
        () => browserOptions.wsEndpoint.coerce?.('http://127.0.0.1:9222'),
        /must use ws:\/\/ or wss:\/\//,
      );

      assert.deepEqual(
        browserOptions.wsHeaders.coerce('{"Authorization":"Bearer tok"}'),
        {Authorization: 'Bearer tok'},
      );
      assert.throws(
        () => browserOptions.wsHeaders.coerce('{"Authorization":123}'),
        /Header "Authorization" must have a string value/,
      );
    });

    it('validates viewport, blockedUrlPattern, and allowedUrlPattern', () => {
      assert.deepEqual(runtimeOptions.viewport.coerce('1280x720'), {
        width: 1280,
        height: 720,
      });
      assert.deepEqual(
        runtimeOptions.viewport.coerce({width: 800, height: 600}),
        {width: 800, height: 600},
      );
      assert.throws(
        () => runtimeOptions.viewport.coerce('1280x0'),
        /Invalid viewport/,
      );

      assert.equal(runtimeOptions.blockedUrlPattern.coerce?.([]), undefined);
      assert.throws(
        () => runtimeOptions.allowedUrlPattern.coerce?.([]),
        /at least one pattern is required/,
      );
    });

    it('validates tool and server numeric bounds', () => {
      assert.equal(toolOptions.screenshotQuality.coerce?.(85), 85);
      assert.throws(
        () => toolOptions.screenshotQuality.coerce?.(101),
        /Invalid screenshotQuality/,
      );
      assert.throws(
        () => toolOptions.screenshotMaxWidth.coerce?.(0),
        /Invalid screenshotMaxWidth/,
      );
      assert.throws(
        () => toolOptions.screenshotMaxHeight.coerce?.(-5),
        /Invalid screenshotMaxHeight/,
      );
      assert.throws(
        () => serverOptions.screencastFps.coerce?.(0),
        /Invalid screencastFps/,
      );
      assert.throws(
        () => serverOptions.maxNavigationSaved.coerce?.(26),
        /Invalid maxNavigationSaved/,
      );
    });

    it('strips defaults and positional metadata cleanly', () => {
      const stripped = withoutDefaults(serverOptions);
      assert.equal('default' in stripped.headless, false);
      assert.equal(stripped.headless.defaultDescription, 'false');

      const cliOpts = getCliOptions();
      assert.equal('browser' in cliOpts, false);
      assert.equal('toolResultRecording' in cliOpts, false);
      assert.equal('viaCli' in cliOpts, false);
      assert.equal('headless' in cliOpts, true);

      assert.deepEqual(
        stripYargsPositionalArgs({_: ['a'], $0: 'cli', headless: true}),
        {headless: true},
      );

      assert.equal(isReloadableOption('screenshotFormat'), true);
      assert.equal(isReloadableOption('headless'), false);
    });
  });
});
