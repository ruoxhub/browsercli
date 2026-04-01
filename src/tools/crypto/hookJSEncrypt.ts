/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { zod } from '../../third_party/index.js';
import { ToolCategory } from '../categories.js';
import { defineTool, type Context, type Response } from '../ToolDefinition.js';

export const hookJSEncrypt = defineTool({
  name: 'hook_jsencrypt',
  description: 'Hook JSEncrypt RSA 加密库：公钥/私钥、原始数据、密文',
  annotations: {
    title: 'Hook JSEncrypt',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    logFormat: zod
      .enum(['full', 'compact', 'json'])
      .optional()
      .default('compact')
      .describe('日志输出格式'),
  },
  handler: async (request: { params: { logFormat?: 'full' | 'compact' | 'json' } }, response: Response, context: Context) => {
    const logFormat = request.params.logFormat || 'compact';

    const hookCode = `
(function() {
  'use strict';

  const hookId = 'hook_jsencrypt';
  const logFormat = '${logFormat}';

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
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);

      response.appendResponseLine('✅ JSEncrypt Hook 已安装');
      response.appendResponseLine(`- 日志格式：${logFormat}`);
      response.appendResponseLine('');
      response.appendResponseLine('将捕获以下 RSA 操作:');
      response.appendResponseLine('  - encrypt(): 公钥加密');
      response.appendResponseLine('  - decrypt(): 私钥解密');
      response.appendResponseLine('');
      response.appendResponseLine('输出参数：publicKey, privateKey, plaintext, ciphertext');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
