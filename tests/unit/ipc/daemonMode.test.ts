/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {existsSync, rmSync} from 'node:fs';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {
  getRuntimeConfigStore,
  resetRuntimeConfigStore,
} from '../../../src/config/RuntimeConfigStore.js';
import {
  persistRuntimeConfig,
  RUNTIME_CONFIG_PATH,
} from '../../../src/config/runtimeConfigPersistence.js';
import {buildDaemonArgPlan} from '../../../src/ipc/daemonArgs.js';
import {seedConfig} from '../../../src/worker/daemonMain.js';

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
});


