/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it, beforeEach, afterEach} from 'node:test';

import {configCommand} from '../../../src/cli/commands/config.js';
import {loadCliConfig} from '../../../src/cli/daemonClient.js';
import type {WorkerContext} from '../../../src/cli/types.js';

describe('configCommand isolate_workspace', () => {
  let tmpDir: string;
  let prevConfigDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcli-cfg-'));
    prevConfigDir = process.env.BROWSERCLI_CONFIG_DIR;
    process.env.BROWSERCLI_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    if (prevConfigDir === undefined) delete process.env.BROWSERCLI_CONFIG_DIR;
    else process.env.BROWSERCLI_CONFIG_DIR = prevConfigDir;
    fs.rmSync(tmpDir, {recursive: true, force: true});
  });

  it('allows setting isolate_workspace to true', async () => {
    const ctx = {session: 'default'} as WorkerContext;
    await configCommand(['--set', 'isolate_workspace=true'], ctx);
    const cfg = loadCliConfig();
    assert.equal(cfg.isolate_workspace, 'true');
  });
});
