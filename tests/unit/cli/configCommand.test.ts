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

  it('resolves workerEntry with PROXYCLI_ENTRY fallback when BROWSERCLI_ENTRY is unset', async () => {
    const prevBcli = process.env.BROWSERCLI_ENTRY;
    const prevProxy = process.env.PROXYCLI_ENTRY;
    delete process.env.BROWSERCLI_ENTRY;
    process.env.PROXYCLI_ENTRY = 'build/proxy-worker.js';
    try {
      const ctx = {session: 'default'} as WorkerContext;
      const res = (await configCommand(['--get', 'workerEntry'], ctx)) as {
        value: unknown;
      };
      assert.equal(res.value, 'build/proxy-worker.js');
    } finally {
      if (prevBcli !== undefined) process.env.BROWSERCLI_ENTRY = prevBcli;
      else delete process.env.BROWSERCLI_ENTRY;
      if (prevProxy !== undefined) process.env.PROXYCLI_ENTRY = prevProxy;
      else delete process.env.PROXYCLI_ENTRY;
    }
  });
});
