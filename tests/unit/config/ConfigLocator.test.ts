/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import {describe, it} from 'node:test';

import {
  CONFIG_FILE_NAME,
  ConfigLocator,
  NO_CONFIG_DISCOVERY_ENV,
} from '../../../src/config/ConfigLocator.js';

const HOME = path.resolve('/home/tester');
const PLUGIN_DATA = path.resolve('/plugins/data/browsercli');
const XDG_CONFIG_HOME = path.resolve('/xdg/config');
const CUSTOM_DIR = path.resolve('/custom/config-dir');

const PLUGIN_CONFIG = path.join(PLUGIN_DATA, 'browsercli.config.json');
const USER_CONFIG = path.join(HOME, '.browsercli', 'config.json');
const XDG_CONFIG = path.join(XDG_CONFIG_HOME, 'browsercli', 'config.json');
const FALLBACK_CONFIG = path.join(HOME, '.config', 'browsercli', 'config.json');
const LEGACY_CONFIG = path.join(HOME, '.proxycli', 'config.json');

describe('ConfigLocator', () => {
  const locator = new ConfigLocator();

  describe('getPrimaryConfigPath', () => {
    it('defaults to ~/.browsercli/config.json', () => {
      assert.equal(locator.getPrimaryConfigPath({}, HOME), USER_CONFIG);
    });

    it('prefers BROWSERCLI_CONFIG_DIR over PROXYCLI_CONFIG_DIR', () => {
      assert.equal(
        locator.getPrimaryConfigPath(
          {
            BROWSERCLI_CONFIG_DIR: CUSTOM_DIR,
            PROXYCLI_CONFIG_DIR: '/legacy/dir',
          },
          HOME,
        ),
        path.join(CUSTOM_DIR, 'config.json'),
      );
      assert.equal(
        locator.getPrimaryConfigPath({PROXYCLI_CONFIG_DIR: CUSTOM_DIR}, HOME),
        path.join(CUSTOM_DIR, 'config.json'),
      );
    });
  });

  describe('getPlatformConfigPath', () => {
    it('falls back to ~/.config/browsercli/config.json on Linux and macOS', () => {
      for (const platform of ['linux', 'darwin'] as const) {
        assert.equal(
          locator.getPlatformConfigPath({}, platform, HOME),
          FALLBACK_CONFIG,
        );
      }
    });

    it('respects absolute XDG_CONFIG_HOME and ignores relative paths', () => {
      assert.equal(
        locator.getPlatformConfigPath({XDG_CONFIG_HOME}, 'linux', HOME),
        XDG_CONFIG,
      );
      assert.equal(
        locator.getPlatformConfigPath(
          {XDG_CONFIG_HOME: 'relative/path'},
          'linux',
          HOME,
        ),
        FALLBACK_CONFIG,
      );
    });

    it('uses LOCALAPPDATA on Windows and falls back to ~/.config when absent', () => {
      const localAppData = path.resolve('/AppData/Local');
      assert.equal(
        locator.getPlatformConfigPath(
          {LOCALAPPDATA: localAppData},
          'win32',
          HOME,
        ),
        path.join(localAppData, 'browsercli', 'config.json'),
      );
      assert.equal(
        locator.getPlatformConfigPath({}, 'win32', HOME),
        FALLBACK_CONFIG,
      );
    });

    it('exposes CONFIG_FILE_NAME and getGlobalConfigPath parity alias', () => {
      assert.equal(CONFIG_FILE_NAME, 'browsercli.config.json');
      assert.equal(
        locator.getGlobalConfigPath({XDG_CONFIG_HOME}, 'linux', HOME),
        XDG_CONFIG,
      );
    });
  });

  describe('locate', () => {
    it('returns undefined when no config file exists', () => {
      assert.equal(
        locator.locate({PLUGIN_DATA}, () => false, 'linux', HOME),
        undefined,
      );
    });

    it('returns undefined when BROWSERCLI_NO_CONFIG_DISCOVERY is enabled', () => {
      const files = new Set([PLUGIN_CONFIG, USER_CONFIG]);
      assert.equal(
        locator.locate(
          {PLUGIN_DATA, [NO_CONFIG_DISCOVERY_ENV]: 'true'},
          p => files.has(p),
          'linux',
          HOME,
        ),
        undefined,
      );
    });

    it('keeps discovery active when BROWSERCLI_NO_CONFIG_DISCOVERY is false', () => {
      const files = new Set([USER_CONFIG]);
      assert.equal(
        locator.locate(
          {[NO_CONFIG_DISCOVERY_ENV]: 'false'},
          p => files.has(p),
          'linux',
          HOME,
        ),
        USER_CONFIG,
      );
    });

    it('follows priority PLUGIN_DATA > ~/.browsercli > XDG > ~/.proxycli', () => {
      const all = new Set([
        PLUGIN_CONFIG,
        USER_CONFIG,
        XDG_CONFIG,
        LEGACY_CONFIG,
      ]);
      assert.equal(
        locator.locate(
          {PLUGIN_DATA, XDG_CONFIG_HOME},
          p => all.has(p),
          'linux',
          HOME,
        ),
        PLUGIN_CONFIG,
      );

      all.delete(PLUGIN_CONFIG);
      assert.equal(
        locator.locate(
          {PLUGIN_DATA, XDG_CONFIG_HOME},
          p => all.has(p),
          'linux',
          HOME,
        ),
        USER_CONFIG,
      );

      all.delete(USER_CONFIG);
      assert.equal(
        locator.locate(
          {PLUGIN_DATA, XDG_CONFIG_HOME},
          p => all.has(p),
          'linux',
          HOME,
        ),
        XDG_CONFIG,
      );

      all.delete(XDG_CONFIG);
      assert.equal(
        locator.locate(
          {PLUGIN_DATA, XDG_CONFIG_HOME},
          p => all.has(p),
          'linux',
          HOME,
        ),
        LEGACY_CONFIG,
      );
    });

    it('isolates search strictly to custom dir when BROWSERCLI_CONFIG_DIR is set', () => {
      const files = new Set([USER_CONFIG, LEGACY_CONFIG]);
      assert.equal(
        locator.locate(
          {BROWSERCLI_CONFIG_DIR: CUSTOM_DIR},
          p => files.has(p),
          'linux',
          HOME,
        ),
        undefined,
      );
    });
  });
});
