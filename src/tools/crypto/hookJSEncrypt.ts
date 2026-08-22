/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * Hook JSEncrypt RSA 加密库：公钥/私钥、原始数据、密文。
 */
export const hookJSEncrypt = defineTool({
  name: 'hook_jsencrypt',
  description: 'Hook JSEncrypt RSA 加密库：拦截公钥/私钥、明文、密文。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    logFormat: zod
      .enum(['compact', 'json'])
      .optional()
      .describe('日志输出格式（默认 "compact"）。'),
  },
  handler: async (request, response, context) => {
    const format = request.params.logFormat || 'compact';
    const frame = context.getSelectedFrame();

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

  if (typeof window.JSEncrypt === 'undefined') {
    console.log('[' + hookId + '] ⚠️ JSEncrypt not found on this page');
    return;
  }

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
      response.setStructuredContent({
        success: true,
        message: 'JSEncrypt Hook 已安装',
        tooltype: 'hook_jsencrypt',
        data: {},
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `错误：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'hook_jsencrypt'},
      );
    }
  },
});
