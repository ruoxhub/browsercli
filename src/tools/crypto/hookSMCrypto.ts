/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {HookResult, LogFormat, SMAlgorithm} from './types.js';

/**
 * Hook SM-crypto 国密库：SM2、SM3、SM4 算法。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param algorithms - 要 Hook 的算法，默认 ['all']
 * @param logFormat - 日志输出格式，默认 'compact'
 * @returns 结构化结果对象
 */
export async function hookSMCrypto(
  frame: Frame,
  algorithms?: SMAlgorithm[],
  logFormat?: LogFormat,
): Promise<HookResult> {
  const algos = algorithms || ['all'];
  const format = logFormat || 'compact';

  const hookCode = `
(function() {
  'use strict';

  const hookId = 'hook_smcrypto';
  const algorithms = ${JSON.stringify(algos)};
  const logFormat = '${format}';

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
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: 'SM-Crypto Hook 已安装',
      tooltype: 'hook_smcrypto',
      algorithms: algos,
      logFormat: format,
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_smcrypto',
    };
  }
}