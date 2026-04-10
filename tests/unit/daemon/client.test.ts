/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {createServer} from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import {describe, it, before, after} from 'node:test';

import {
  sendCommand,
  handleResponse,
  startDaemon,
  stopDaemon,
  setTestSocketPath,
} from '../../../src/daemon/client.js';
import type {CallToolResult} from '../../../src/third_party/index.js';

const testSocketPath = path.join(
  os.tmpdir(),
  `js-reverse-mcp-test-${process.pid}.sock`,
);

describe('daemon/client', () => {
  let server: import('node:net').Server;

  before(async () => {
    setTestSocketPath(testSocketPath);

    server = createServer(socket => {
      socket.on('data', chunk => {
        const msg = chunk.toString();
        // 解析请求并返回适当的响应
        try {
          const request = JSON.parse(msg.slice(0, msg.indexOf('\0')));
          if (request.method === 'status') {
            socket.write(
              JSON.stringify({
                success: true,
                result: JSON.stringify({
                  pid: process.pid,
                  socketPath: testSocketPath,
                }),
              }) + '\n',
            );
          } else if (request.method === 'shutdown') {
            socket.write(JSON.stringify({success: true}) + '\n');
          } else {
            socket.write(
              JSON.stringify({success: true, result: 'mock'}) + '\n',
            );
          }
          socket.end();
        } catch {
          socket.write(
            JSON.stringify({success: false, error: '解析失败'}) + '\n',
          );
          socket.end();
        }
      });
    });

    await new Promise<void>(resolve => server.listen(testSocketPath, resolve));
  });

  after(() => {
    server.close();
  });

  it('sendCommand 应该发送并接收 IPC 消息', async () => {
    const response = await sendCommand({
      method: 'invoke_tool',
      tool: 'test',
      args: {},
    });
    assert.strictEqual(response.success, true);
    assert.strictEqual(response.result, 'mock');
  });

  it('status 命令应该返回 daemon 状态', async () => {
    const response = await sendCommand({method: 'status'});
    assert.strictEqual(response.success, true);
    assert.ok(response.result);
    const result = JSON.parse(response.result!);
    assert.ok(result.pid);
    assert.ok(result.socketPath);
  });

  it('shutdown 命令应该成功', async () => {
    const response = await sendCommand({method: 'shutdown'});
    assert.strictEqual(response.success, true);
  });

  it('handleResponse 应该正确处理 JSON 格式', () => {
    const result = {
      content: [{type: 'text' as const, text: 'Hello World'}],
    } satisfies CallToolResult;
    const output = handleResponse(result, 'json');
    assert.ok(output.includes('Hello World'));
  });

  it('handleResponse 应该正确处理 text 格式', () => {
    const result = {
      content: [
        {type: 'text' as const, text: 'Line 1'},
        {type: 'text' as const, text: 'Line 2'},
      ],
    } satisfies CallToolResult;
    const output = handleResponse(result, 'text');
    assert.strictEqual(output, 'Line 1\nLine 2');
  });

  it('handleResponse 应该处理 md 格式', () => {
    const result = {
      content: [{type: 'text' as const, text: '# Title\n\nContent'}],
    } satisfies CallToolResult;
    const output = handleResponse(result, 'md');
    assert.strictEqual(output, '# Title\n\nContent');
  });
});

describe('daemon/client - 错误处理', () => {
  it('socket 不存在时应该返回友好的中文错误提示', async () => {
    const nonExistentSocket = '/tmp/js-reverse-mcp-nonexistent-test.sock';
    setTestSocketPath(nonExistentSocket);

    try {
      await sendCommand({method: 'status'});
      assert.fail('Expected error to be thrown');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok(
        error.message.includes('后台服务未运行'),
        `Expected Chinese error message, got: ${error.message}`,
      );
      assert.ok(
        error.message.includes('js-reverse start'),
        `Expected usage hint in error message, got: ${error.message}`,
      );
    }
  });
});
