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

import {ConfigWatcher} from '../../../src/config/ConfigWatcher.js';

const DEBOUNCE_MS = 40;
const SETTLE_MS = 220;
const POLL_TIMEOUT_MS = 4000;
const POLL_INTERVAL_MS = 20;

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await wait(POLL_INTERVAL_MS);
  }
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bcli-watcher-'));
}

describe('ConfigWatcher', () => {
  it('debounces rapid writes into a single onChange with latest content', async () => {
    const dir = createTempDir();
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, '{}', 'utf8');
    const seen: string[] = [];
    const watcher = new ConfigWatcher(
      configPath,
      async content => {
        seen.push(content);
      },
      {debounceMs: DEBOUNCE_MS},
    );

    try {
      watcher.start();
      assert.equal(watcher.isWatching, true);
      fs.writeFileSync(configPath, '{"screenshotFormat":"jpeg"}', 'utf8');
      fs.writeFileSync(configPath, '{"screenshotFormat":"webp"}', 'utf8');

      await waitFor(() => seen.length > 0);
      await wait(SETTLE_MS);
      assert.deepEqual(seen, ['{"screenshotFormat":"webp"}']);
    } finally {
      watcher.dispose();
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });

  it('detects atomic rename replacements and ignores unrelated files', async () => {
    const dir = createTempDir();
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, '{}', 'utf8');
    const seen: string[] = [];
    const watcher = new ConfigWatcher(
      configPath,
      async content => {
        seen.push(content);
      },
      {debounceMs: DEBOUNCE_MS},
    );

    try {
      watcher.start();
      fs.writeFileSync(path.join(dir, 'unrelated.json'), '{"a":1}', 'utf8');
      await wait(SETTLE_MS);
      assert.deepEqual(seen, []);

      const tmpFile = path.join(dir, 'config.json.tmp');
      fs.writeFileSync(tmpFile, '{"redactNetworkHeaders":true}', 'utf8');
      fs.renameSync(tmpFile, configPath);

      await waitFor(() => seen.length === 1);
      assert.deepEqual(seen, ['{"redactNetworkHeaders":true}']);
    } finally {
      watcher.dispose();
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });

  it('skips duplicate content and stops notifications after dispose', async () => {
    const dir = createTempDir();
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, '{"headless":true}', 'utf8');
    const seen: string[] = [];
    const watcher = new ConfigWatcher(
      configPath,
      async content => {
        seen.push(content);
      },
      {debounceMs: DEBOUNCE_MS},
    );

    try {
      watcher.start();
      fs.writeFileSync(configPath, '{"headless":true}', 'utf8');
      await wait(SETTLE_MS);
      assert.deepEqual(seen, []);

      watcher.dispose();
      assert.equal(watcher.isWatching, false);
      fs.writeFileSync(configPath, '{"headless":false}', 'utf8');
      await wait(SETTLE_MS);
      assert.deepEqual(seen, []);
    } finally {
      watcher.dispose();
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });

  it('reports onChange errors via onError without crashing', async () => {
    const dir = createTempDir();
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, '{}', 'utf8');
    const errors: Array<{msg: string; err: unknown}> = [];
    const boom = new Error('apply failed');
    const watcher = new ConfigWatcher(
      configPath,
      async () => {
        throw boom;
      },
      {
        debounceMs: DEBOUNCE_MS,
        onError: (msg, err) => {
          errors.push({msg, err});
        },
      },
    );

    try {
      watcher.start();
      fs.writeFileSync(configPath, '{"debug":true}', 'utf8');
      await waitFor(() => errors.length === 1);
      assert.equal(errors[0].msg, `Failed to apply ${configPath}:`);
      assert.equal(errors[0].err, boom);
    } finally {
      watcher.dispose();
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });

  it('supports Symbol.dispose and logger callback', () => {
    const dir = createTempDir();
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, '{}', 'utf8');
    const logs: string[] = [];
    const watcher = new ConfigWatcher(configPath, async () => undefined, {
      debounceMs: DEBOUNCE_MS,
      logger: msg => {
        logs.push(msg);
      },
    });

    try {
      watcher.start();
      assert.equal(logs.length, 1);
      assert.match(logs[0], /^Watching .* for config changes$/);
      watcher[Symbol.dispose]();
      assert.equal(watcher.isWatching, false);
    } finally {
      watcher.dispose();
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });
});
