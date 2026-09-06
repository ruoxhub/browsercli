/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {buildDaemonArgPlan} from '../../../src/ipc/daemonArgs.js';

describe('buildDaemonArgPlan', () => {
  it('consumes daemon-only tokens and keeps the rest for parseWorkerArgs', () => {
    assert.deepEqual(
      buildDaemonArgPlan([
        '--daemon',
        '--session',
        'proj-a',
        '--no-console',
        '--proxycli-daemon',
      ]),
      {
        daemon: true,
        proxycliDaemon: true,
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
      proxycliDaemon: false,
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
        proxycliDaemon: false,
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
