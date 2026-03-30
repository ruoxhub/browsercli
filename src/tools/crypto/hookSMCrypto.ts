/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { zod } from '../../third_party/index.js';
import { ToolCategory } from '../categories.js';
import { defineTool, type Context, type Response } from '../ToolDefinition.js';

export const hookSMCrypto = defineTool({
  name: 'hook_smcrypto',
  description: 'Hook SM-crypto 国密库：SM2、SM3、SM4 算法',
  annotations: {
    title: 'Hook SM-Crypto',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    algorithms: zod
      .array(zod.enum(['SM2', 'SM3', 'SM4', 'all']))
      .optional()
      .describe('要 Hook 的算法，默认全部'),
    logFormat: zod
      .enum(['full', 'compact', 'json'])
      .optional()
      .default('compact')
      .describe('日志输出格式'),
  },
  handler: async (request: { params: { algorithms?: Array<'SM2' | 'SM3' | 'SM4' | 'all'>; logFormat?: 'full' | 'compact' | 'json' } }, response: Response, context: Context) => {
    const algorithms = request.params.algorithms || ['all'];
    const logFormat = request.params.logFormat || 'compact';

    const hookCode = `
(function() {
  'use strict';

  const hookId = 'hook_smcrypto';
  const algorithms = ${JSON.stringify(algorithms)};
  const logFormat = '${logFormat}';

  function log(data) {
    if (logFormat === 'json') {
      console.log(JSON.stringify(data));
    } else {
      console.log('[SM-Crypto Hook]', data);
    }
  }

  const sm = window.sm2 || window.sm3 || window.sm4 || window;

  // SM2 Hook
  if (algorithms.includes('SM2') || algorithms.includes('all')) {
    if (sm.sm2) {
      const originalSm2Encrypt = sm.sm2.encrypt;
      if (originalSm2Encrypt) {
        sm.sm2.encrypt = function(data, ...args) {
          const result = originalSm2Encrypt.call(this, data, ...args);
          log({
            algorithm: 'SM2',
            type: 'encrypt',
            timestamp: Date.now(),
            plaintext: data?.slice(0, 50),
            ciphertext: typeof result === 'string' ? result.slice(0, 100) : '[object]',
          });
          return result;
        };
      }

      const originalSm2Decrypt = sm.sm2.decrypt;
      if (originalSm2Decrypt) {
        sm.sm2.decrypt = function(cipher, ...args) {
          const result = originalSm2Decrypt.call(this, cipher, ...args);
          log({
            algorithm: 'SM2',
            type: 'decrypt',
            timestamp: Date.now(),
            ciphertext: typeof cipher === 'string' ? cipher.slice(0, 50) : '[object]',
            plaintext: typeof result === 'string' ? result.slice(0, 50) : '[object]',
          });
          return result;
        };
      }
    }
  }

  // SM3 Hook
  if (algorithms.includes('SM3') || algorithms.includes('all')) {
    if (sm.sm3) {
      const originalSm3 = sm.sm3;
      sm.sm3 = function(data, ...args) {
        const result = originalSm3.call(this, data, ...args);
        log({
          algorithm: 'SM3',
          type: 'hash',
          timestamp: Date.now(),
          input: typeof data === 'string' ? data.slice(0, 50) : '[object]',
          hash: typeof result === 'string' ? result : '[object]',
        });
        return result;
      };
    }
  }

  // SM4 Hook
  if (algorithms.includes('SM4') || algorithms.includes('all')) {
    if (sm.sm4) {
      const originalSm4Encrypt = sm.sm4.encrypt;
      if (originalSm4Encrypt) {
        sm.sm4.encrypt = function(data, key, ...args) {
          const result = originalSm4Encrypt.call(this, data, key, ...args);
          log({
            algorithm: 'SM4',
            type: 'encrypt',
            timestamp: Date.now(),
            key: typeof key === 'string' ? key.slice(0, 32) : '[object]',
            plaintext: typeof data === 'string' ? data.slice(0, 50) : '[object]',
            ciphertext: typeof result === 'string' ? result.slice(0, 100) : '[object]',
          });
          return result;
        };
      }
    }
  }

  console.log('[' + hookId + '] ✅ SM-Crypto hook installed');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);

      response.appendResponseLine('✅ SM-Crypto Hook 已安装');
      response.appendResponseLine(`- 算法：${algorithms.join(', ')}`);
      response.appendResponseLine(`- 日志格式：${logFormat}`);
      response.appendResponseLine('');
      response.appendResponseLine('将捕获以下国密操作:');
      if (algorithms.includes('SM2') || algorithms.includes('all')) {
        response.appendResponseLine('  - SM2: 椭圆曲线公钥加密/解密');
      }
      if (algorithms.includes('SM3') || algorithms.includes('all')) {
        response.appendResponseLine('  - SM3: 密码杂凑算法');
      }
      if (algorithms.includes('SM4') || algorithms.includes('all')) {
        response.appendResponseLine('  - SM4: 分组密码算法');
      }
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
