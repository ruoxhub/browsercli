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
});
