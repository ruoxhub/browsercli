import {describe, it} from 'node:test';
import assert from 'node:assert';
import {isDaemonRunning, serializeArgs, socketPath} from '../../../src/daemon/utils.js';

describe('daemon/utils', () => {
  it('socketPath 应该是有效路径', () => {
    assert.ok(socketPath.endsWith('js-reverse-mcp.sock'));
  });

  it('serializeArgs 应该正确序列化布尔参数', () => {
    const options = {
      headless: {type: 'boolean'},
      isolated: {type: 'boolean'},
    };
    const argv = {headless: true, isolated: false};
    const result = serializeArgs(options, argv);
    assert.deepStrictEqual(result, ['--headless']);
  });

  it('serializeArgs 应该正确序列化字符串参数', () => {
    const options = {
      browserUrl: {type: 'string'},
    };
    const argv = {browserUrl: 'http://127.0.0.1:9222'};
    const result = serializeArgs(options, argv);
    assert.deepStrictEqual(result, ['--browserUrl=http://127.0.0.1:9222']);
  });
});
