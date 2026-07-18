/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * Hook CryptoJS 加密库：AES、DES、MD5、SHA、HMAC 等对称/哈希算法。
 */
export const hookCryptoJS = defineTool({
  name: 'hook_cryptojs',
  description:
    'Hook CryptoJS 加密库：拦截 AES、DES、MD5、SHA、HMAC 等对称/哈希算法。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    algorithms: zod
      .array(zod.string())
      .optional()
      .describe('要 Hook 的算法（默认 ["all"]）。'),
    logFormat: zod
      .enum(['compact', 'json', 'full'])
      .optional()
      .describe('日志输出格式（默认 "compact"）。'),
  },
  handler: async (request, response, context) => {
    const algos = request.params.algorithms || ['all'];
    const format = request.params.logFormat || 'compact';
    const frame = context.getSelectedFrame();

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

  const temp_apply = Function.prototype.apply;
  Function.prototype.apply = function() {
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
      response.setStructuredContent({
        success: true,
        message: 'CryptoJS Hook 已安装',
        tooltype: 'hook_cryptojs',
        data: {
          algorithms: algos,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_cryptojs',
        data: {},
      });
    }
  },
});
