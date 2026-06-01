/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, it} from 'node:test';

import {
  formatConfigValidationError,
  GlobalConfigSchema,
  getToolResultRecordingConfig,
  resolveConfig,
  validateGlobalConfig,
} from '../../../src/config.js';

describe('config schema validation', {concurrency: false}, () => {
  const originalEnv = {...process.env};
  const originalCwd = process.cwd();

  afterEach(() => {
    process.env = {...originalEnv};
    process.chdir(originalCwd);
  });

  function withIsolatedConfigSources(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'js-reverse-config-'));
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    delete process.env.JSREVERSER_RECORD_TOOL_RESULTS;
    delete process.env.JSREVERSER_TOOL_RESULTS_DIR;
    process.chdir(dir);
    return dir;
  }

  it('parses valid global config and coerces numeric strings', () => {
    const config = validateGlobalConfig({
      rpcHost: 'ws://127.0.0.1:5620',
      group: 'reverse',
      llmProvider: 'openai',
      openai: {
        apiKey: 'sk-test',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-4o',
      },
      browser: {
        channel: 'chrome-beta',
        viewport: {width: '1440', height: '900'},
        remoteDebuggingPort: '9222',
        waitForBrowserPollMs: '250',
        args: ['--disable-dev-shm-usage'],
      },
      toolResultRecording: {
        enabled: 'true',
        outputDir: '~/.jsreverse/tool-results',
      },
      sessionStateTtlMs: '60000',
    });

    assert.strictEqual(config.browser?.remoteDebuggingPort, 9222);
    assert.strictEqual(config.browser?.channel, 'beta');
    assert.deepStrictEqual(config.browser?.viewport, {
      width: 1440,
      height: 900,
    });
    assert.strictEqual(config.browser?.waitForBrowserPollMs, 250);
    assert.strictEqual(config.toolResultRecording?.enabled, true);
    assert.strictEqual(
      config.toolResultRecording?.outputDir,
      '~/.jsreverse/tool-results',
    );
    assert.strictEqual(config.sessionStateTtlMs, 60000);
  });

  it('rejects unsupported providers at schema boundary', () => {
    assert.throws(
      () => GlobalConfigSchema.parse({llmProvider: 'gemni'}),
      /llmProvider/,
    );
  });

  it('rejects invalid browser port with readable path details', () => {
    assert.throws(
      () =>
        validateGlobalConfig({
          browser: {remoteDebuggingPort: 70000},
        }),
      /browser\.remoteDebuggingPort/,
    );
  });

  it('formats nested schema errors as user-facing config paths', () => {
    const result = GlobalConfigSchema.safeParse({
      browser: {
        channel: 'nightly',
        viewport: {width: 0, height: 900},
      },
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      const message = formatConfigValidationError(result.error);
      assert.match(message, /browser\.channel/);
      assert.match(message, /browser\.viewport\.width/);
    }
  });

  it('accepts moz-firefox channel without aliasing it', () => {
    const config = validateGlobalConfig({
      browser: {channel: 'moz-firefox'},
    });
    assert.strictEqual(config.browser?.channel, 'moz-firefox');
  });

  it('accepts firefox channel as a plain Firefox launcher hint', () => {
    const config = validateGlobalConfig({
      browser: {channel: 'firefox'},
    });
    assert.strictEqual(config.browser?.channel, 'firefox');
  });

  it('accepts bidi-chrome channel without aliasing it', () => {
    const config = validateGlobalConfig({
      browser: {channel: 'bidi-chrome'},
    });
    assert.strictEqual(config.browser?.channel, 'bidi-chrome');
  });

  it('accepts bidi-chromium channel without aliasing it', () => {
    const config = validateGlobalConfig({
      browser: {channel: 'bidi-chromium'},
    });
    assert.strictEqual(config.browser?.channel, 'bidi-chromium');
  });

  it('validates and coerces environment-backed config before resolution', () => {
    process.env.BROWSER_HEADLESS = 'false';
    process.env.REMOTE_DEBUGGING_PORT = '9223';
    process.env.OPENAI_API_KEY = 'sk-env';

    const config = resolveConfig();

    assert.strictEqual(config.headless, false);
  });

  it('resolves tool result recording from environment variables', () => {
    const script = [
      "import {getToolResultRecordingConfig} from './build/src/config.js';",
      'const config = getToolResultRecordingConfig();',
      'console.log(JSON.stringify(config));',
    ].join('\n');
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: originalCwd,
        env: {
          ...process.env,
          JSREVERSER_RECORD_TOOL_RESULTS: 'true',
          JSREVERSER_TOOL_RESULTS_DIR: 'tmp/tool-results',
        },
        encoding: 'utf-8',
      },
    );
    const config = JSON.parse(output) as {
      enabled: boolean;
      outputDir: string;
    };

    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.outputDir, 'tmp/tool-results');
  });

  it('defaults tool result recording to the user config directory', () => {
    const dir = withIsolatedConfigSources();
    process.env.JSREVERSER_RECORD_TOOL_RESULTS = 'false';
    process.env.JSREVERSER_TOOL_RESULTS_DIR = '';
    writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({outputDir: 'artifacts'}, null, 2),
      'utf-8',
    );

    const config = getToolResultRecordingConfig();

    assert.strictEqual(config.enabled, false);
    assert.match(
      config.outputDir.replace(/\\/g, '/'),
      /artifacts\/tool-results$/,
    );
    rmSync(dir, {force: true, recursive: true});
  });

  it('allows configuring tool result recording through config command', async () => {
    const dir = withIsolatedConfigSources();
    const script = [
      "import {configCommand} from './build/src/cli/commands/config.js';",
      "import {getToolResultRecordingConfig} from './build/src/config.js';",
      "const enabledResult = await configCommand(['--set', 'toolResultRecording.enabled=true'], {});",
      "const outputDirResult = await configCommand(['--set', 'toolResultRecording.outputDir=tmp/tool-results'], {});",
      'const config = getToolResultRecordingConfig();',
      'console.log(JSON.stringify({enabledResult, outputDirResult, config}));',
    ].join('\n');
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: originalCwd,
        env: {
          ...process.env,
          HOME: dir,
          USERPROFILE: dir,
        },
        encoding: 'utf-8',
      },
    );
    const result = JSON.parse(output) as {
      enabledResult: Record<string, unknown>;
      outputDirResult: Record<string, unknown>;
      config: {
        enabled: boolean;
        outputDir: string;
      };
    };

    assert.deepStrictEqual(
      {
        key: result.enabledResult.key,
        value: result.enabledResult.value,
      },
      {
        key: 'toolResultRecording.enabled',
        value: true,
      },
    );
    assert.deepStrictEqual(
      {
        key: result.outputDirResult.key,
        value: result.outputDirResult.value,
      },
      {
        key: 'toolResultRecording.outputDir',
        value: 'tmp/tool-results',
      },
    );

    assert.strictEqual(result.config.enabled, true);
    assert.strictEqual(result.config.outputDir, 'tmp/tool-results');
    rmSync(dir, {force: true, recursive: true});
  });
});
