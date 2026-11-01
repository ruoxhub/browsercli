/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it, beforeEach, afterEach} from 'node:test';

import {AxiError} from 'axi-sdk-js';

import {cliCommands} from '../../../src/cli/app.js';
import {browserCommand} from '../../../src/cli/commands/browser.js';
import type {DaemonEvent, DaemonLike} from '../../../src/cli/daemonClient.js';
import type {AxiStructuredOutput} from '../../../src/cli/output.js';
import type {
  BrowserConnectOptions,
  BrowserConnectionStatus,
  WorkerContext,
} from '../../../src/cli/types.js';

function context() {
  const calls: Array<{method: string; params?: Record<string, unknown>}> = [];
  const connected: BrowserConnectionStatus = {
    connected: true,
    mode: 'ws-endpoint',
    pages: 2,
  };
  const disconnected: BrowserConnectionStatus = {
    connected: false,
    mode: 'disconnected',
    pages: 0,
  };
  const client: DaemonLike = {
    async request<T>(method: string, params?: Record<string, unknown>) {
      calls.push({method, params});
      if (method === 'browser.connect') return connected as T;
      if (method === 'browser.disconnect') return disconnected as T;
      return connected as T;
    },
    onEvent(_cb: (event: DaemonEvent) => void) {
      return () => undefined;
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    close() {},
  };
  const ctx: WorkerContext = {
    session: 'default',
    connect: async () => client,
  };
  return {calls, ctx};
}

describe('browserCommand', () => {
  let tmpConfigDir: string;
  let prevConfigDir: string | undefined;

  beforeEach(() => {
    tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcli-browser-test-'));
    prevConfigDir = process.env.BROWSERCLI_CONFIG_DIR;
    process.env.BROWSERCLI_CONFIG_DIR = tmpConfigDir;
  });

  afterEach(() => {
    if (prevConfigDir === undefined) delete process.env.BROWSERCLI_CONFIG_DIR;
    else process.env.BROWSERCLI_CONFIG_DIR = prevConfigDir;
    fs.rmSync(tmpConfigDir, {recursive: true, force: true});
  });

  it('registers browser as a top-level command', () => {
    assert.strictEqual(cliCommands.browser, browserCommand);
  });

  it('maps approved connect flags to the browser.connect body', async () => {
    const {calls, ctx} = context();
    const output = (await browserCommand(
      [
        'connect',
        '--ws-endpoint',
        'wss://host/devtools',
        '--ws-headers',
        '{"Authorization":"Bearer token"}',
        '--headless=false',
        '--isolated',
        '--user-data-dir',
        'profile-dir',
        '--viewport',
        '1280x720',
        '--accept-insecure-certs',
        '--cloak=false',
        '--js-stealth',
        '--minimal-stealth',
        '--full-stealth-args=false',
      ],
      ctx,
    )) as AxiStructuredOutput;

    assert.deepEqual(calls, [
      {
        method: 'browser.connect',
        params: {
          body: {
            wsEndpoint: 'wss://host/devtools',
            wsHeaders: {Authorization: 'Bearer token'},
            headless: false,
            isolated: true,
            userDataDir: 'profile-dir',
            viewport: {width: 1280, height: 720},
            acceptInsecureCerts: true,
            cloak: false,
            jsStealth: true,
            minimalStealth: true,
            fullStealthArgs: false,
          } satisfies BrowserConnectOptions,
        },
      },
    ]);
    assert.strictEqual(output.command, 'browser');
    assert.strictEqual(output.action, 'connect');
    assert.strictEqual(output.connected, true);
    assert.ok(!JSON.stringify(output).includes('Bearer token'));
  });

  it('maps local targets and sends an empty patch when no flags are given', async () => {
    const executable = context();
    await browserCommand(
      ['connect', '--executable-path', 'C:\\Chrome\\chrome.exe'],
      executable.ctx,
    );
    assert.deepEqual(executable.calls, [
      {
        method: 'browser.connect',
        params: {body: {executablePath: 'C:\\Chrome\\chrome.exe'}},
      },
    ]);

    const channel = context();
    await browserCommand(['connect', '--channel', 'stable'], channel.ctx);
    assert.deepEqual(channel.calls, [
      {method: 'browser.connect', params: {body: {channel: 'stable'}}},
    ]);

    const current = context();
    await browserCommand(['connect'], current.ctx);
    assert.deepEqual(current.calls, [
      {method: 'browser.connect', params: {body: {}}},
    ]);
  });

  it('dispatches status and disconnect', async () => {
    const first = context();
    await browserCommand(['status', '--json'], first.ctx);
    assert.deepEqual(first.calls, [
      {method: 'browser.status', params: undefined},
    ]);

    const second = context();
    await browserCommand(['disconnect'], second.ctx);
    assert.deepEqual(second.calls, [
      {method: 'browser.disconnect', params: {body: {}}},
    ]);

    const forced = context();
    await browserCommand(['disconnect', '--force'], forced.ctx);
    assert.deepEqual(forced.calls, [
      {method: 'browser.disconnect', params: {body: {force: true}}},
    ]);
  });

  it('rejects conflicting targets and invalid values before connecting', async () => {
    const invalid: string[][] = [
      ['connect', '--browser-url', 'http://host', '--ws-endpoint', 'ws://host'],
      ['connect', '--browser-url', 'ftp://host'],
      ['connect', '--ws-endpoint', 'http://host'],
      ['connect', '--channel', 'stable', '--executable-path', 'chrome.exe'],
      ['connect', '--viewport', '1280'],
      ['connect', '--ws-headers', '{"Authorization":1}'],
      ['connect', '--headless=maybe'],
      ['connect', '--unknown'],
      ['status', '--headless'],
      ['status', '--force'],
      ['unknown'],
    ];

    for (const args of invalid) {
      const {calls, ctx} = context();
      await assert.rejects(
        async () => browserCommand(args, ctx),
        error => error instanceof AxiError && error.code === 'VALIDATION_ERROR',
      );
      assert.deepEqual(calls, []);
    }
  });

  it('uses table output by default and structured output for --json', async () => {
    const table = context();
    const tableOutput = (await browserCommand(
      ['status'],
      table.ctx,
    )) as AxiStructuredOutput;
    assert.deepEqual(tableOutput.headers, ['Property', 'Value']);
    assert.ok(Array.isArray(tableOutput.rows));

    const json = context();
    const jsonOutput = (await browserCommand(
      ['status', '--json'],
      json.ctx,
    )) as AxiStructuredOutput;
    assert.strictEqual(jsonOutput.status, 'success');
    assert.strictEqual(jsonOutput.mode, 'ws-endpoint');
    assert.strictEqual(jsonOutput.pages, 2);
  });

  it('falls back to ~/.browsercli/config.json when CLI flags are omitted', async () => {
    fs.writeFileSync(
      path.join(tmpConfigDir, 'config.json'),
      JSON.stringify({
        browserUrl: 'http://127.0.0.1:9222',
        headless: 'false',
        cloak: 'true',
      }),
      'utf-8',
    );

    const {calls, ctx} = context();
    await browserCommand(['connect'], ctx);
    assert.deepEqual(calls, [
      {
        method: 'browser.connect',
        params: {
          body: {
            browserURL: 'http://127.0.0.1:9222',
            headless: false,
            cloak: true,
          },
        },
      },
    ]);
  });

  it('suppresses config file target when CLI provides a conflicting target flag', async () => {
    fs.writeFileSync(
      path.join(tmpConfigDir, 'config.json'),
      JSON.stringify({
        browserUrl: 'http://127.0.0.1:9222',
      }),
      'utf-8',
    );

    const {calls, ctx} = context();
    await browserCommand(
      ['connect', '--ws-endpoint', 'wss://override.host/devtools'],
      ctx,
    );
    assert.deepEqual(calls, [
      {
        method: 'browser.connect',
        params: {
          body: {
            wsEndpoint: 'wss://override.host/devtools',
          },
        },
      },
    ]);
  });

  it('supports nested browser object in config file', async () => {
    fs.writeFileSync(
      path.join(tmpConfigDir, 'config.json'),
      JSON.stringify({
        browser: {
          browserURL: 'http://127.0.0.1:9333',
          isolated: false,
        },
      }),
      'utf-8',
    );

    const {calls, ctx} = context();
    await browserCommand(['connect'], ctx);
    assert.deepEqual(calls, [
      {
        method: 'browser.connect',
        params: {
          body: {
            browserURL: 'http://127.0.0.1:9333',
            isolated: false,
          },
        },
      },
    ]);
  });

  it('resolves remote target over default local channel when both exist in config file', async () => {
    fs.writeFileSync(
      path.join(tmpConfigDir, 'config.json'),
      JSON.stringify({
        browser: {
          channel: 'stable',
          browserURL: 'http://127.0.0.1:19222',
        },
      }),
      'utf-8',
    );

    const {calls, ctx} = context();
    await browserCommand(['connect'], ctx);
    assert.deepEqual(calls, [
      {
        method: 'browser.connect',
        params: {
          body: {
            browserURL: 'http://127.0.0.1:19222',
          },
        },
      },
    ]);
  });

  it('honors environment variables over config file but yields to CLI flags', async () => {
    fs.writeFileSync(
      path.join(tmpConfigDir, 'config.json'),
      JSON.stringify({
        browserUrl: 'http://127.0.0.1:9222',
        headless: 'true',
      }),
      'utf-8',
    );

    process.env.BROWSER_URL = 'http://127.0.0.1:9555';
    process.env.BROWSER_HEADLESS = 'false';

    try {
      // 1. Env takes precedence over config file
      const envWinner = context();
      await browserCommand(['connect'], envWinner.ctx);
      assert.deepEqual(envWinner.calls, [
        {
          method: 'browser.connect',
          params: {
            body: {
              browserURL: 'http://127.0.0.1:9555',
              headless: false,
            },
          },
        },
      ]);

      // 2. CLI flag takes precedence over env
      const cliWinner = context();
      await browserCommand(
        ['connect', '--browser-url', 'http://127.0.0.1:9888'],
        cliWinner.ctx,
      );
      assert.deepEqual(cliWinner.calls, [
        {
          method: 'browser.connect',
          params: {
            body: {
              browserURL: 'http://127.0.0.1:9888',
              headless: false,
            },
          },
        },
      ]);
    } finally {
      delete process.env.BROWSER_URL;
      delete process.env.BROWSER_HEADLESS;
    }
  });

  it('supports --auto-connect and --user-data-dir flags', async () => {
    const {calls, ctx} = context();
    await browserCommand(
      ['connect', '--auto-connect', '--user-data-dir', 'C:\\profile'],
      ctx,
    );
    assert.deepEqual(calls, [
      {
        method: 'browser.connect',
        params: {
          body: {
            autoConnect: true,
            userDataDir: 'C:\\profile',
          },
        },
      },
    ]);
  });

  it('supports autoConnect from config.json and suppresses local channel', async () => {
    fs.writeFileSync(
      path.join(tmpConfigDir, 'config.json'),
      JSON.stringify({
        autoConnect: true,
        channel: 'stable',
        userDataDir: 'C:\\citro-profile',
      }),
      'utf-8',
    );

    const {calls, ctx} = context();
    await browserCommand(['connect'], ctx);
    assert.deepEqual(calls, [
      {
        method: 'browser.connect',
        params: {
          body: {
            autoConnect: true,
            userDataDir: 'C:\\citro-profile',
          },
        },
      },
    ]);
  });
});
