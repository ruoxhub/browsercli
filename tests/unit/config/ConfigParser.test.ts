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
import {
  ConfigParser,
  loadUserConfigFile,
  parseConfigFile,
  parseConfigFileContent,
} from '../../../src/config/ConfigParser.js';

describe('ConfigParser', () => {
  it('parses valid JSON config content and strips UTF-8 BOM', () => {
    const parsed = parseConfigFileContent(
      '\uFEFF' +
        JSON.stringify({
          headless: true,
          screenshotFormat: 'webp',
          maxNavigationSaved: 8,
        }),
      {strict: true},
    );
    assert.equal(parsed.headless, true);
    assert.equal(parsed.screenshotFormat, 'webp');
    assert.equal(parsed.maxNavigationSaved, 8);
  });

  it('rejects non-object JSON roots', () => {
    for (const raw of ['[]', '"hello"', '123', 'null']) {
      assert.throws(
        () => parseConfigFileContent(raw),
        /Config must be a JSON object/,
      );
    }
  });

  it('rejects unknown keys and nested config option in strict mode', () => {
    assert.throws(
      () =>
        parseConfigFileContent(JSON.stringify({unknownOption: true}), {
          strict: true,
        }),
      /Unknown config option\(s\): unknownOption/,
    );
    assert.throws(
      () =>
        parseConfigFileContent(JSON.stringify({config: '/tmp/other.json'}), {
          strict: true,
        }),
      /Option "config" cannot be specified inside a config file/,
    );
  });

  it('wraps file parsing failures with Invalid JSON config file prefix', () => {
    assert.throws(
      () => parseConfigFile('/nonexistent/file.json', '{bad-json'),
      /Invalid JSON config file:/,
    );
  });

  it('loads a config file from disk and handles empty/missing files gracefully', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcli-parser-'));
    try {
      const configPath = path.join(tmpDir, 'config.json');
      assert.deepEqual(loadUserConfigFile(configPath), {});

      fs.writeFileSync(configPath, '   \n', 'utf-8');
      assert.deepEqual(loadUserConfigFile(configPath), {});

      fs.writeFileSync(
        configPath,
        '\uFEFF' + JSON.stringify({browserUrl: 'http://127.0.0.1:9222'}),
        'utf-8',
      );
      const loaded = loadUserConfigFile(configPath);
      assert.equal(loaded.browserUrl, 'http://127.0.0.1:9222');
    } finally {
      fs.rmSync(tmpDir, {recursive: true, force: true});
    }
  });

  describe('ConfigParser class', () => {
    afterEach(() => {
      mock.restoreAll();
    });

    it('parseCliArgs returns only explicitly passed flags', () => {
      const args = new ConfigParser('0.0.0', [
        'node',
        'main.js',
        '--headless',
      ]).parseCliArgs();
      assert.deepEqual(args, {
        headless: true,
      });
    });

    it('parseConfigFile validates wsHeaders, viewport, and rejects forbidden keys', () => {
      const parser = new ConfigParser('0.0.0');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcli-cp-'));
      try {
        const validPath = path.join(tmpDir, 'valid.json');
        fs.writeFileSync(
          validPath,
          JSON.stringify({
            wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/1',
            wsHeaders: {Authorization: 'Bearer token'},
            viewport: '1280x720',
          }),
          'utf-8',
        );
        const parsed = parser.parseConfigFile(validPath);
        assert.deepEqual(parsed.wsHeaders, {Authorization: 'Bearer token'});
        assert.deepEqual(parsed.viewport, {width: 1280, height: 720});

        const badHeaderPath = path.join(tmpDir, 'bad-header.json');
        fs.writeFileSync(
          badHeaderPath,
          JSON.stringify({
            wsEndpoint: 'ws://127.0.0.1:9222',
            wsHeaders: {Authorization: 123},
          }),
          'utf-8',
        );
        assert.throws(
          () => parser.parseConfigFile(badHeaderPath),
          /Header "Authorization" must have a string value/,
        );

        for (const forbiddenKey of ['config', 'help', 'version']) {
          const forbiddenPath = path.join(tmpDir, `${forbiddenKey}.json`);
          fs.writeFileSync(
            forbiddenPath,
            JSON.stringify({[forbiddenKey]: true}),
            'utf-8',
          );
          assert.throws(
            () => parser.parseConfigFile(forbiddenPath),
            new RegExp(`Invalid JSON config file: .*${forbiddenKey}`),
          );
        }
      } finally {
        fs.rmSync(tmpDir, {recursive: true, force: true});
      }
    });

    it('discovers config via ConfigLocator and prefers --config', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcli-disc-'));
      try {
        const discoveredPath = path.join(tmpDir, 'discovered.json');
        const explicitPath = path.join(tmpDir, 'explicit.json');
        fs.writeFileSync(
          discoveredPath,
          JSON.stringify({headless: true}),
          'utf-8',
        );
        fs.writeFileSync(
          explicitPath,
          JSON.stringify({screenshotFormat: 'webp'}),
          'utf-8',
        );

        const locator = new ConfigLocator();
        const locateMock = mock.method(locator, 'locate', () => discoveredPath);
        const discoveredParser = new ConfigParser(
          '0.0.0',
          ['node', 'main.js'],
          {},
          false,
          locator,
        );
        const discoveredArgs = discoveredParser.parse();
        assert.equal(discoveredArgs.headless, true);
        assert.equal(discoveredArgs.config, discoveredPath);
        assert.equal(discoveredParser.configPath, discoveredPath);

        const explicitParser = new ConfigParser(
          '0.0.0',
          ['node', 'main.js', '--config', explicitPath],
          {},
          false,
          locator,
        );
        const explicitArgs = explicitParser.parse();
        assert.equal(explicitArgs.screenshotFormat, 'webp');
        assert.equal(locateMock.mock.callCount(), 1);
      } finally {
        fs.rmSync(tmpDir, {recursive: true, force: true});
      }
    });

    it('reloads config without re-discovering and keeps CLI precedence', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcli-reload-'));
      try {
        const configPath = path.join(tmpDir, 'config.json');
        fs.writeFileSync(
          configPath,
          JSON.stringify({headless: false, memoryDebugging: false}),
          'utf-8',
        );
        const locator = new ConfigLocator();
        const locateMock = mock.method(locator, 'locate', () => configPath);
        const parser = new ConfigParser(
          '0.0.0',
          ['node', 'main.js', '--headless'],
          {},
          false,
          locator,
        );
        const initial = parser.parse();
        assert.equal(initial.headless, true);
        assert.equal(initial.memoryDebugging, false);

        fs.writeFileSync(
          configPath,
          JSON.stringify({headless: false, memoryDebugging: true}),
          'utf-8',
        );
        const reloaded = parser.reload();
        assert.equal(reloaded.headless, true);
        assert.equal(reloaded.memoryDebugging, true);
        assert.equal(locateMock.mock.callCount(), 1);

        fs.writeFileSync(configPath, '{', 'utf-8');
        assert.throws(() => parser.reload(), /Invalid JSON config file/);
      } finally {
        fs.rmSync(tmpDir, {recursive: true, force: true});
      }
    });
  });
});
