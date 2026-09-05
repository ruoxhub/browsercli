/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {PassThrough} from 'node:stream';
import {describe, it} from 'node:test';

import {MitmModule} from '../../../../src/modules/proxy/MitmModule.js';
import {
  ProxyCli,
  tokenizeLine,
} from '../../../../src/modules/proxy/ProxyCli.js';

describe('ProxyCli - Foundation & Tokenizer', () => {
  it('tokenizeLine 正确拆分单双引号与空格参数', () => {
    assert.deepStrictEqual(tokenizeLine('help'), ['help']);
    assert.deepStrictEqual(tokenizeLine('start 8888'), ['start', '8888']);
    assert.deepStrictEqual(
      tokenizeLine('rule add mock "/api/v1/user info" 200 \'{"code": 0}\''),
      ['rule', 'add', 'mock', '/api/v1/user info', '200', '{"code": 0}'],
    );
    assert.deepStrictEqual(tokenizeLine('   ls   10   auth   '), [
      'ls',
      '10',
      'auth',
    ]);
  });

  it('handleCommand 支持 help 与 exit 命令', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let outData = '';
    output.on('data', chunk => {
      outData += chunk.toString();
    });

    const mockModule = new MitmModule();
    const cli = new ProxyCli(mockModule, input, output);

    const helpHandled = await cli.handleCommand('help');
    assert.strictEqual(helpHandled, true);
    assert.match(outData, /Available commands/i);

    const exitHandled = await cli.handleCommand('exit');
    assert.strictEqual(exitHandled, false); // false 表示终止 REPL
  });

  it('支持 start, stop, restart 与 status 生命周期流转', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let outData = '';
    output.on('data', chunk => {
      outData += chunk.toString();
    });

    const mockModule = new MitmModule();
    const cli = new ProxyCli(mockModule, input, output);

    // 1. start
    await cli.handleCommand('start 0');
    assert.match(outData, /MITM Proxy started/i);

    // 2. status
    outData = '';
    await cli.handleCommand('status');
    assert.match(outData, /RUNNING/i);

    // 3. restart
    outData = '';
    await cli.handleCommand('restart 0');
    assert.match(outData, /MITM Proxy started/i);

    // 4. stop
    outData = '';
    await cli.handleCommand('stop');
    assert.match(outData, /Proxy stopped/i);

    // 5. status after stop
    outData = '';
    await cli.handleCommand('status');
    assert.match(outData, /STOPPED/i);
  });
});
