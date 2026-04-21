/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {strict as assert} from 'node:assert';
import {describe, it, mock} from 'node:test';

import type {Frame} from '../../../src/third_party/index.js';

import {
  hookCryptoJS,
  hookJSEncrypt,
  hookSMCrypto,
} from '../../../src/tools/crypto/index.js';
import type {CryptoJSAlgorithm, SMAlgorithm} from '../../../src/tools/crypto/types.js';

function createErrorFrame(errorMsg: string): Frame {
  return {
    evaluate: async () => {
      throw new Error(errorMsg);
    },
  } as unknown as Frame;
}

describe('crypto functions', () => {
  describe('hookCryptoJS', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookCryptoJS(frame);

      assert.strictEqual(evaluate.mock.callCount(), 1);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.message, 'CryptoJS Hook 已安装');
      assert.strictEqual(result.tooltype, 'hook_cryptojs');
      assert.deepStrictEqual(result.algorithms, ['all']);
      assert.strictEqual(result.logFormat, 'compact');
    });

    it('应该支持自定义 algorithms 参数', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;
      const algorithms: CryptoJSAlgorithm[] = ['AES', 'MD5'];

      const result = await hookCryptoJS(frame, algorithms);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.algorithms, ['AES', 'MD5']);
    });

    it('应该支持自定义 logFormat 参数', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookCryptoJS(frame, undefined, 'json');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.logFormat, 'json');
    });

    it('应该在 evaluate 抛出错误时返回失败结果', async () => {
      const frame = createErrorFrame('注入失败');

      const result = await hookCryptoJS(frame);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.message, '错误：注入失败');
      assert.strictEqual(result.tooltype, 'hook_cryptojs');
    });

    it('Hook 代码应该包含正确的算法配置', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;
      const algorithms: CryptoJSAlgorithm[] = ['AES', 'SHA'];

      await hookCryptoJS(frame, algorithms);

      const calls = evaluate.mock.calls as unknown as Array<{arguments: [string]}>;
      const hookCode = calls[0].arguments[0];

      assert.ok(hookCode.includes('["AES","SHA"]'));
    });
  });

  describe('hookJSEncrypt', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookJSEncrypt(frame);

      assert.strictEqual(evaluate.mock.callCount(), 1);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.message, 'JSEncrypt Hook 已安装');
      assert.strictEqual(result.tooltype, 'hook_jsencrypt');
      assert.strictEqual(result.logFormat, 'compact');
    });

    it('应该支持自定义 logFormat 参数', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookJSEncrypt(frame, 'full');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.logFormat, 'full');
    });

    it('应该在 evaluate 抛出错误时返回失败结果', async () => {
      const frame = createErrorFrame('JSEncrypt 未找到');

      const result = await hookJSEncrypt(frame);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.message, '错误：JSEncrypt 未找到');
      assert.strictEqual(result.tooltype, 'hook_jsencrypt');
    });

    it('Hook 代码应该包含 hook_jsencrypt 标识', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      await hookJSEncrypt(frame);

      const calls = evaluate.mock.calls as unknown as Array<{arguments: [string]}>;
      const hookCode = calls[0].arguments[0];

      assert.ok(hookCode.includes('hook_jsencrypt'));
      assert.ok(hookCode.includes('JSEncrypt'));
    });
  });

  describe('hookSMCrypto', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookSMCrypto(frame);

      assert.strictEqual(evaluate.mock.callCount(), 1);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.message, 'SM-Crypto Hook 已安装');
      assert.strictEqual(result.tooltype, 'hook_smcrypto');
      assert.deepStrictEqual(result.algorithms, ['all']);
      assert.strictEqual(result.logFormat, 'compact');
    });

    it('应该支持自定义 algorithms 参数', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;
      const algorithms: SMAlgorithm[] = ['SM2', 'SM4'];

      const result = await hookSMCrypto(frame, algorithms);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.algorithms, ['SM2', 'SM4']);
    });

    it('应该支持自定义 logFormat 参数', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookSMCrypto(frame, undefined, 'json');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.logFormat, 'json');
    });

    it('应该在 evaluate 抛出错误时返回失败结果', async () => {
      const frame = createErrorFrame('SM-Crypto 未加载');

      const result = await hookSMCrypto(frame);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.message, '错误：SM-Crypto 未加载');
      assert.strictEqual(result.tooltype, 'hook_smcrypto');
    });

    it('Hook 代码应该包含 SM2、SM3、SM4 Hook 逻辑', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;
      const algorithms: SMAlgorithm[] = ['SM2', 'SM3'];

      await hookSMCrypto(frame, algorithms);

      const calls = evaluate.mock.calls as unknown as Array<{arguments: [string]}>;
      const hookCode = calls[0].arguments[0];

      assert.ok(hookCode.includes('["SM2","SM3"]'));
      assert.ok(hookCode.includes('sm.sm2'));
      assert.ok(hookCode.includes('sm.sm3'));
    });
  });
});