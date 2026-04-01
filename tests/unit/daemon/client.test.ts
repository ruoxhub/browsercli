import {describe, it, before, after} from 'node:test';
import assert from 'node:assert';
import {createServer} from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import {sendCommand, handleResponse, setTestSocketPath} from '../../../src/daemon/client.js';
import type {CallToolResult} from '../../../src/third_party/index.js';

// 测试使用唯一的 socket 路径避免冲突
const testSocketPath = path.join(os.tmpdir(), `js-reverse-mcp-test-${process.pid}.sock`);

describe('daemon/client', () => {
  let server: import('node:net').Server;

  before(async () => {
    // 设置测试 socket 路径
    setTestSocketPath(testSocketPath);

    // 创建模拟 Server
    server = createServer((socket) => {
      socket.on('data', () => {
        socket.write(JSON.stringify({success: true, result: 'mock'}) + '\n');
        socket.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(testSocketPath, resolve));
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

  it('handleResponse 应该正确处理 JSON 格式', () => {
    const result: CallToolResult = {
      content: [{type: 'text', text: 'Hello World'}],
    };
    const output = handleResponse(result, 'json');
    assert.ok(output.includes('Hello World'));
  });

  it('handleResponse 应该正确处理 text 格式', () => {
    const result: CallToolResult = {
      content: [
        {type: 'text', text: 'Line 1'},
        {type: 'text', text: 'Line 2'},
      ],
    };
    const output = handleResponse(result, 'text');
    assert.strictEqual(output, 'Line 1\nLine 2');
  });
});
