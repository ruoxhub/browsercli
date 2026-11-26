/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {runConfig} from '../../../src/cli/commands.js';
import {resolveDeprecatedToolHint} from '../../../src/cli/deprecatedHints.js';
import {loadCliConfig} from '../../../src/cli/sessionPaths.js';
import {CliError} from '../../../src/cli/toolInvoke.js';

describe('auxiliary CLI commands', () => {
  let tmpDir: string;
  let prevConfigDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcli-cmds-'));
    prevConfigDir = process.env.BROWSERCLI_CONFIG_DIR;
    process.env.BROWSERCLI_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    if (prevConfigDir === undefined) delete process.env.BROWSERCLI_CONFIG_DIR;
    else process.env.BROWSERCLI_CONFIG_DIR = prevConfigDir;
    fs.rmSync(tmpDir, {recursive: true, force: true});
  });

  it('runConfig supports --set, --get, positional set/get, and PROXYCLI_ENTRY fallback', () => {
    runConfig({set: 'isolate_workspace=true'});
    assert.equal(loadCliConfig().isolate_workspace, 'true');

    runConfig({action: 'set', arg: 'cloak=true'});
    assert.equal(runConfig({action: 'get', arg: 'cloak'}).value, 'true');

    runConfig({set: 'outputFormat=toon'});
    assert.equal(loadCliConfig().outputFormat, 'toon');
    assert.equal(runConfig({get: 'outputFormat'}).value, 'toon');
    assert.throws(
      () => runConfig({set: 'outputFormat=invalid'}),
      (err: unknown) =>
        err instanceof CliError && err.code === 'VALIDATION_ERROR',
    );

    const prevBcli = process.env.BROWSERCLI_ENTRY;
    const prevProxy = process.env.PROXYCLI_ENTRY;
    delete process.env.BROWSERCLI_ENTRY;
    process.env.PROXYCLI_ENTRY = 'build/proxy-worker.js';
    try {
      assert.equal(
        runConfig({get: 'workerEntry'}).value,
        'build/proxy-worker.js',
      );
    } finally {
      if (prevBcli !== undefined) process.env.BROWSERCLI_ENTRY = prevBcli;
      else delete process.env.BROWSERCLI_ENTRY;
      if (prevProxy !== undefined) process.env.PROXYCLI_ENTRY = prevProxy;
      else delete process.env.PROXYCLI_ENTRY;
    }
  });

  it('routes deprecated video command to screencast_start / screencast_stop hint', () => {
    const hint = resolveDeprecatedToolHint('video');
    assert.ok(hint);
    assert.match(hint, /screencast_start/);
    assert.match(hint, /screencast_stop/);
  });
});
