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

  it('支持 ls, show, curl, clear 命令', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let outData = '';
    output.on('data', chunk => {
      outData += chunk.toString();
    });

    const module = new MitmModule();
    // 注入一条测试请求到 store
    // SAFETY: Access private store for mock data injection in unit test.
    const store = (
      module as unknown as {store: {addRequest: (r: unknown) => void}}
    ).store;
    store.addRequest({
      id: 'req_1',
      timestamp: Date.now(),
      method: 'POST',
      url: 'https://api.example.com/v1/login',
      clientIp: '127.0.0.1',
      statusCode: 200,
      requestHeaders: {'content-type': 'application/json'},
      requestBody: '{"user":"admin"}',
      responseHeaders: {'content-type': 'application/json'},
      responseBody: '{"code":0,"token":"abc"}',
      durationMs: 45,
    });

    const cli = new ProxyCli(module, input, output);

    // 1. ls
    outData = '';
    await cli.handleCommand('ls');
    assert.match(outData, /req_1/);
    assert.match(outData, /POST/);
    assert.match(outData, /200/);

    // 2. show req_1
    outData = '';
    await cli.handleCommand('show req_1');
    assert.match(outData, /Request #req_1/);
    assert.match(outData, /token/);

    // 3. curl req_1
    outData = '';
    await cli.handleCommand('curl req_1');
    assert.match(outData, /curl -X POST/);

    // 4. clear
    outData = '';
    await cli.handleCommand('clear');
    assert.match(outData, /Cleared/i);
  });

  it('支持使用 mitmproxy 过滤表达式执行 ls', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let outData = '';
    output.on('data', chunk => {
      outData += chunk.toString();
    });

    const module = new MitmModule();
    const store = (
      module as unknown as {store: {addRequest: (r: unknown) => void}}
    ).store;

    store.addRequest({
      id: 1,
      timestamp: Date.now(),
      method: 'POST',
      url: 'https://api.example.com/v1/login',
      statusCode: 200,
      requestHeaders: {'content-type': 'application/json'},
      responseHeaders: {'content-type': 'application/json'},
      durationMs: 45,
    });
    store.addRequest({
      id: 2,
      timestamp: Date.now(),
      method: 'GET',
      url: 'https://cdn.example.com/static/bundle.js',
      statusCode: 200,
      contentType: 'application/javascript',
      isStatic: true,
      requestHeaders: {'content-type': 'application/javascript'},
      responseHeaders: {'content-type': 'application/javascript'},
      durationMs: 12,
    });

    const cli = new ProxyCli(module, input, output);

    // 1. 过滤 ~m POST & ~c 200
    outData = '';
    await cli.handleCommand('ls ~m POST & ~c 200');
    assert.match(outData, /#1/);
    assert.doesNotMatch(outData, /#2/);

    // 2. 排除静态资源 !~a
    outData = '';
    await cli.handleCommand('ls !~a');
    assert.match(outData, /#1/);
    assert.doesNotMatch(outData, /#2/);

    // 3. 仅静态资源 ~a
    outData = '';
    await cli.handleCommand('ls ~a');
    assert.match(outData, /#2/);
    assert.doesNotMatch(outData, /#1/);

    // 4. help ls 显示流过滤语法提示
    outData = '';
    await cli.handleCommand('help ls');
    assert.match(outData, /mitmproxy/i);
    assert.match(outData, /~a/);
    assert.match(outData, /~m/);
  });

  it('tail 开关切换及 safeLog 在活跃提示符时正常刷新', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let outData = '';
    output.on('data', chunk => {
      outData += chunk.toString();
    });

    const module = new MitmModule();
    const cli = new ProxyCli(module, input, output);

    await cli.handleCommand('tail on');
    assert.match(outData, /Tail is now ON/i);

    outData = '';
    await cli.handleCommand('tail off');
    assert.match(outData, /Tail is now OFF/i);

    // 测试 safeLog
    outData = '';
    cli.safeLog('[TEST LOG]');
    assert.match(outData, /\[TEST LOG\]/);
  });

  it('支持 rule 与 filter 的增删查清命令', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let outData = '';
    output.on('data', chunk => {
      outData += chunk.toString();
    });

    const module = new MitmModule();
    const cli = new ProxyCli(module, input, output);

    // 1. rule add mock
    await cli.handleCommand('rule add mock /api/v1 200 {"ok":true}');
    assert.match(outData, /Rule added/i);

    // 2. rule ls
    outData = '';
    await cli.handleCommand('rule ls');
    assert.match(outData, /mock/i);
    assert.match(outData, /\/api\/v1/);

    // 3. filter allow & filter ls
    outData = '';
    await cli.handleCommand('filter allow api.github.com');
    assert.match(outData, /Filter added/i);

    outData = '';
    await cli.handleCommand('filter ls');
    assert.match(outData, /api\.github\.com/);

    // 4. rule rm & filter rm
    outData = '';
    await cli.handleCommand('rule clear');
    assert.match(outData, /Cleared/i);

    outData = '';
    await cli.handleCommand('filter clear');
    assert.match(outData, /Cleared/i);
  });

  it('支持 ca, sysproxy, proc 与 har 命令分发', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let outData = '';
    output.on('data', chunk => {
      outData += chunk.toString();
    });

    const module = new MitmModule();
    const cli = new ProxyCli(module, input, output);

    // 1. ca path
    await cli.handleCommand('ca path');
    assert.match(outData, /ca\.crt/);

    // 2. sysproxy status
    outData = '';
    await cli.handleCommand('sysproxy status');
    assert.match(outData, /System proxy/i);

    // 3. proc ls
    outData = '';
    await cli.handleCommand('proc ls');
    assert.match(outData, /Local processes/i);

    // 4. har export
    outData = '';
    await cli.handleCommand('har export');
    assert.match(outData, /HAR exported/i);
  });

  it('completer 正确补全一级命令与二级子命令', () => {
    const module = new MitmModule();
    const cli = new ProxyCli(module);

    // 1. 一级命令补全
    const [hits1] = cli.completer('st');
    assert.ok(hits1.includes('start'));
    assert.ok(hits1.includes('status'));

    // 2. 二级子命令补全
    const [hits2] = cli.completer('rule ');
    assert.ok(hits2.includes('ls'));
    assert.ok(hits2.includes('add'));
    assert.ok(hits2.includes('rm'));
    assert.ok(hits2.includes('clear'));

    const [hits3] = cli.completer('sysproxy ');
    assert.ok(hits3.includes('on'));
    assert.ok(hits3.includes('off'));

    const [hits4] = cli.completer('up');
    assert.ok(hits4.includes('upstream'));

    const [hits5] = cli.completer('upstream ');
    assert.ok(hits5.includes('set'));
    assert.ok(hits5.includes('clear'));
  });

  it('支持 upstream 命令查看、设置与清除二级代理', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let outData = '';
    output.on('data', chunk => {
      outData += chunk.toString();
    });

    const mockModule = new MitmModule();
    const cli = new ProxyCli(mockModule, input, output);

    // 1. 默认无二级代理
    await cli.handleCommand('upstream');
    assert.match(outData, /Current upstream proxy: None/);
    outData = '';

    // 2. 设置二级代理
    await cli.handleCommand('upstream set http://127.0.0.1:7890');
    assert.match(outData, /Upstream proxy set to: http:\/\/127\.0\.0\.1:7890/);
    outData = '';

    // 3. 查看当前配置
    await cli.handleCommand('upstream');
    assert.match(outData, /Current upstream proxy: http:\/\/127\.0\.0\.1:7890/);
    outData = '';

    // 4. 清除二级代理
    await cli.handleCommand('upstream clear');
    assert.match(outData, /Upstream proxy cleared/);
    outData = '';

    await cli.handleCommand('upstream');
    assert.match(outData, /Current upstream proxy: None/);
  });
});
