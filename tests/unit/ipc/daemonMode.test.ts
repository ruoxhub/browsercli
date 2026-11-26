/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {
  persistRuntimeConfig,
  RUNTIME_CONFIG_PATH,
} from '../../../src/config/runtimeConfigPersistence.js';
import {
  getRuntimeConfigStore,
  resetRuntimeConfigStore,
} from '../../../src/config/RuntimeConfigStore.js';
import {buildDaemonArgPlan} from '../../../src/ipc/daemonArgs.js';
import {
  seedConfig,
  startDaemonConfigWatcher,
} from '../../../src/worker/daemonMain.js';

describe('buildDaemonArgPlan', () => {
  it('consumes daemon-only tokens and keeps the rest for parseWorkerArgs', () => {
    assert.deepEqual(
      buildDaemonArgPlan([
        '--daemon',
        '--session',
        'proj-a',
        '--no-console',
        '--browsercli-daemon',
      ]),
      {
        daemon: true,
        browsercliDaemon: true,
        session: 'proj-a',
        noConsole: true,
        minimalStealth: false,
        consolePort: undefined,
        spawnFlags: [],
      },
    );
  });

  it('accepts --session=x and --console-port=x; non-daemon argv returns daemon:false', () => {
    assert.deepEqual(buildDaemonArgPlan(['--daemon', '--session=x']), {
      daemon: true,
      browsercliDaemon: false,
      session: 'x',
      noConsole: false,
      minimalStealth: false,
      consolePort: undefined,
      spawnFlags: [],
    });
    assert.deepEqual(
      buildDaemonArgPlan(['--headless', '--console-port=9000']),
      {
        daemon: false,
        browsercliDaemon: false,
        session: 'default',
        noConsole: false,
        minimalStealth: false,
        consolePort: 9000,
        spawnFlags: ['--headless'],
      },
    );
  });

  it('falls back to BROWSERCLI_SESSION env then default', () => {
    process.env.BROWSERCLI_SESSION = 'e1';
    try {
      assert.equal(buildDaemonArgPlan(['--daemon']).session, 'e1');
    } finally {
      delete process.env.BROWSERCLI_SESSION;
    }
    assert.equal(buildDaemonArgPlan(['--daemon']).session, 'default');
  });

  it('routes unrecognized worker flags into spawnFlags untouched', () => {
    const plan = buildDaemonArgPlan([
      '--daemon',
      '--console-port=9100',
      '--cloak',
      '--unknown-flag',
      '--minimal-stealth',
    ]);
    assert.equal(plan.consolePort, 9100);
    assert.equal(plan.minimalStealth, true);
    assert.deepEqual(plan.spawnFlags, ['--cloak', '--unknown-flag']);
  });

  it('supports space-separated --console-port value', () => {
    const plan = buildDaemonArgPlan(['--daemon', '--console-port', '9200']);
    assert.equal(plan.consolePort, 9200);
    assert.deepEqual(plan.spawnFlags, []);
  });
});

describe('seedConfig priority', () => {
  beforeEach(() => {
    resetRuntimeConfigStore();
    if (existsSync(RUNTIME_CONFIG_PATH)) rmSync(RUNTIME_CONFIG_PATH);
  });

  afterEach(() => {
    resetRuntimeConfigStore();
    if (existsSync(RUNTIME_CONFIG_PATH)) rmSync(RUNTIME_CONFIG_PATH);
  });

  it('explicit spawnFlags override cached runtime config', () => {
    // 模拟上次持久化的配置（例如连接到 9222）
    persistRuntimeConfig({
      browser: {browserURL: 'http://127.0.0.1:9222', headless: false},
    });

    // 本次显式启动传入不同的 URL 和 headless flag
    const plan = buildDaemonArgPlan([
      '--daemon',
      '--browserUrl=http://127.0.0.1:9555',
      '--headless',
    ]);

    seedConfig(plan);

    const effective = getRuntimeConfigStore().get();
    assert.equal(effective.browserUrl, 'http://127.0.0.1:9555');
    assert.equal(effective.headless, true);
  });

  it('loads explicit --config file and hot-reloads reloadable options with --watch-config', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'bcli-daemon-cfg-'));
    const configPath = path.join(tmpDir, 'custom.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        screenshotFormat: 'png',
        redactNetworkHeaders: false,
      }),
      'utf-8',
    );

    const plan = buildDaemonArgPlan([
      '--daemon',
      `--config=${configPath}`,
      '--watch-config',
      '--screenshot-format=jpeg',
    ]);

    seedConfig(plan);
    const serverConfig = getRuntimeConfigStore().getServerConfig();
    assert.ok(serverConfig);
    assert.equal(serverConfig.configPath, path.resolve(configPath));
    assert.equal(getRuntimeConfigStore().get().screenshotFormat, 'jpeg');
    assert.equal(getRuntimeConfigStore().get().redactNetworkHeaders, false);

    const watcher = startDaemonConfigWatcher(serverConfig);
    assert.ok(watcher);
    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          screenshotFormat: 'webp',
          redactNetworkHeaders: true,
        }),
        'utf-8',
      );

      const deadline = Date.now() + 4000;
      while (!getRuntimeConfigStore().get().redactNetworkHeaders) {
        if (Date.now() >= deadline) {
          throw new Error('Timed out waiting for daemon config hot-reload');
        }
        await new Promise(resolve => setTimeout(resolve, 30));
      }

      // CLI override (--screenshot-format=jpeg) survives hot-reload; file-only reloadable option updates
      assert.equal(getRuntimeConfigStore().get().screenshotFormat, 'jpeg');
      assert.equal(getRuntimeConfigStore().get().redactNetworkHeaders, true);
    } finally {
      watcher.dispose();
      rmSync(tmpDir, {recursive: true, force: true});
    }
  });
});


