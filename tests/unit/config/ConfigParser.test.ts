/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {
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
});
