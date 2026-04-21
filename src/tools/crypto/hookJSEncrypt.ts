/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {HookResult, LogFormat} from './types.js';

/**
 * Hook JSEncrypt RSA 加密库：公钥/私钥、原始数据、密文。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param logFormat - 日志输出格式，默认 'compact'
 * @returns 结构化结果对象
 */
export async function hookJSEncrypt(
  frame: Frame,
  logFormat?: LogFormat,
): Promise<HookResult> {
  const format = logFormat || 'compact';

  const hookCode = `
(function() {
  'use strict';

  const hookId = 'hook_jsencrypt';
  const logFormat = '${format}';

  function log(data) {
    if (logFormat === 'json') {
      console.log(JSON.stringify(data));
    } else {
      console.log('[JSEncrypt Hook]', data);
    }
  }

  // Check if JSEncrypt exists
  if (typeof window.JSEncrypt === 'undefined') {
    console.log('[' + hookId + '] ⚠️ JSEncrypt not found on this page');
    return;
  }

  // Hook JSEncrypt.prototype.encrypt
  const originalEncrypt = window.JSEncrypt.prototype.encrypt;
  window.JSEncrypt.prototype.encrypt = function(plaintext) {
    const result = originalEncrypt.call(this, plaintext);

    log({
      type: 'encrypt',
      timestamp: Date.now(),
      publicKey: this.pubKey?.n?.toString(16)?.slice(0, 64) + '...' || 'N/A',
      plaintext: plaintext?.slice(0, 100),
      ciphertext: result?.slice(0, 200),
    });

    return result;
  };

  // Hook JSEncrypt.prototype.decrypt
  const originalDecrypt = window.JSEncrypt.prototype.decrypt;
  window.JSEncrypt.prototype.decrypt = function(ciphertext) {
    const result = originalDecrypt.call(this, ciphertext);

    log({
      type: 'decrypt',
      timestamp: Date.now(),
      privateKey: this.privKey?.n?.toString(16)?.slice(0, 64) + '...' || 'N/A',
      ciphertext: ciphertext?.slice(0, 100),
      plaintext: result?.slice(0, 100),
    });

    return result;
  };

  console.log('[' + hookId + '] ✅ JSEncrypt hook installed');
})();
`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: 'JSEncrypt Hook 已安装',
      tooltype: 'hook_jsencrypt',
      logFormat: format,
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_jsencrypt',
    };
  }
}