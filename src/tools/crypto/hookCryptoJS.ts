/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import type {
  HookResult,
  LogFormat,
  CryptoJSAlgorithm,
} from './types.js';

/**
 * Hook CryptoJS 加密库：AES、DES、MD5、SHA、HMAC 等对称/哈希算法。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param algorithms - 要 Hook 的算法，默认 ['all']
 * @param logFormat - 日志输出格式，默认 'compact'
 * @returns 结构化结果对象
 */
export async function hookCryptoJS(
  frame: Frame,
  algorithms?: CryptoJSAlgorithm[],
  logFormat?: LogFormat,
): Promise<HookResult> {
  const algos = algorithms || ['all'];
  const format = logFormat || 'compact';

  const hookCode = `
(function() {
  'use strict';

  const hookId = 'hook_cryptojs';
  const algorithms = ${JSON.stringify(algos)};
  const logFormat = '${format}';

  function hasEncryptProp(obj) {
    const requiredProps = ['ciphertext', 'key', 'iv', 'algorithm', 'mode', 'padding', 'blockSize', 'formatter'];
    if (!obj || typeof obj !== 'object') return false;
    return requiredProps.every(prop => prop in obj);
  }

  function hasDecryptProp(obj) {
    const requiredProps = ['sigBytes', 'words'];
    if (!obj || typeof obj !== 'object') return false;
    return requiredProps.every(prop => prop in obj);
  }

  function getSigBytes(size) {
    switch (size) {
      case 8: return "64bits";
      case 16: return "128bits";
      case 24: return "192bits";
      case 32: return "256bits";
      default: return "Unknown";
    }
  }

  function log(data) {
    if (logFormat === 'json') {
      console.log(JSON.stringify(data));
    } else if (logFormat === 'full') {
      console.group('[CryptoJS Hook]');
      console.log(data);
      console.groupEnd();
    } else {
      console.log('[CryptoJS]', data);
    }
  }

  // Hook Function.prototype.apply
  const temp_apply = Function.prototype.apply;
  Function.prototype.apply = function() {
    // Symmetric encryption
    if (arguments.length === 2 && arguments[0] && arguments[1] &&
        typeof arguments[1] === 'object' && arguments[1].length === 1 &&
        hasEncryptProp(arguments[1][0])) {

      if (Object.hasOwn(arguments[0], "$super") && Object.hasOwn(arguments[1], "callee")) {
        const data = {
          type: 'encrypt',
          timestamp: Date.now(),
          algorithm: arguments[1][0].algorithm?.toString() || 'Unknown',
          mode: arguments[1][0].mode?.toString() || 'Unknown',
          padding: arguments[1][0].padding?.toString() || 'Unknown',
          key: arguments[1][0].key?.toString() || 'N/A',
          iv: arguments[1][0].iv?.toString() || 'N/A',
        };

        let encryptText = arguments[0].$super.toString.call(arguments[1][0]);
        if (encryptText !== "[object Object]") {
          data.ciphertext = encryptText;
        }

        log(data);
      }

    // Symmetric decryption
    } else if (arguments.length === 2 && arguments[0] && arguments[1] &&
               typeof arguments[1] === 'object' && arguments[1].length === 3 &&
               hasDecryptProp(arguments[1][1])) {

      if (Object.hasOwn(arguments[0], "$super") && Object.hasOwn(arguments[1], "callee")) {
        const data = {
          type: 'decrypt',
          timestamp: Date.now(),
          key: arguments[1][1].toString() || 'N/A',
          iv: arguments[1][2]?.iv?.toString() || 'N/A',
        };

        log(data);
      }
    }

    return temp_apply.apply(this, arguments);
  };

  console.log('[' + hookId + '] ✅ CryptoJS hook installed');
})();
`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: 'CryptoJS Hook 已安装',
      tooltype: 'hook_cryptojs',
      algorithms: algos,
      logFormat: format,
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_cryptojs',
    };
  }
}