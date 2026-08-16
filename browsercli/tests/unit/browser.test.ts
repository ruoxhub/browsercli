import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {AxiError} from 'axi-sdk-js';

import {cliCommands} from '../../src/app.js';
import {browserCommand} from '../../src/commands/browser.js';
import type {AxiStructuredOutput} from '../../src/output.js';
import type {WorkerContext} from '../../src/types.js';
import type {
  BrowserConnectOptions,
  BrowserConnectionStatus,
  BrowserDisconnectOptions,
  WorkerHttpClient,
} from '../../src/WorkerHttpClient.js';

function context() {
  const calls: Array<{
    action: string;
    options?: BrowserConnectOptions | BrowserDisconnectOptions;
  }> = [];
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
  const client = {
    connectBrowser: async (options: BrowserConnectOptions) => {
      calls.push({action: 'connect', options});
      return connected;
    },
    disconnectBrowser: async (options?: BrowserDisconnectOptions) => {
      calls.push({
        action: 'disconnect',
        ...(options === undefined ? {} : {options}),
      });
      return disconnected;
    },
    getBrowserStatus: async () => {
      calls.push({action: 'status'});
      return connected;
    },
  } as unknown as WorkerHttpClient;
  return {
    calls,
    ctx: {httpClient: client, transport: 'http'} as WorkerContext,
  };
}

describe('browserCommand', () => {
  it('registers browser as a top-level command', () => {
    assert.strictEqual(cliCommands.browser, browserCommand);
  });

  it('maps approved connect flags to the HTTP payload', async () => {
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
        action: 'connect',
        options: {
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
        action: 'connect',
        options: {executablePath: 'C:\\Chrome\\chrome.exe'},
      },
    ]);

    const channel = context();
    await browserCommand(['connect', '--channel', 'stable'], channel.ctx);
    assert.deepEqual(channel.calls, [
      {action: 'connect', options: {channel: 'stable'}},
    ]);

    const current = context();
    await browserCommand(['connect'], current.ctx);
    assert.deepEqual(current.calls, [{action: 'connect', options: {}}]);
  });

  it('dispatches status and disconnect', async () => {
    const first = context();
    await browserCommand(['status', '--json'], first.ctx);
    assert.deepEqual(first.calls, [{action: 'status'}]);

    const second = context();
    await browserCommand(['disconnect'], second.ctx);
    assert.deepEqual(second.calls, [{action: 'disconnect'}]);

    const forced = context();
    await browserCommand(['disconnect', '--force'], forced.ctx);
    assert.deepEqual(forced.calls, [
      {action: 'disconnect', options: {force: true}},
    ]);
  });

  it('rejects conflicting targets and invalid values before HTTP', async () => {
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
});
