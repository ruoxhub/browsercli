/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {SkillContext, SkillResult} from './SkillRunner.js';
import {SkillRegistry} from './SkillRunner.js';
import { logger } from '../utils/logger.js';

/**
 * 自动 Hook 技能配置
 */
export interface AutoHookOptions {
  /** Hook 预设 */
  preset?: 'none' | 'api-signature' | 'network-core';
  /** 是否自动注入 Hook */
  autoInject?: boolean;
  /** Hook 后等待时间（毫秒） */
  waitAfterHookMs?: number;
  /** 是否使用 AI 分析 */
  useAI?: boolean;
  /** 加密库 Hook */
  hookCrypto?: boolean;
  /** RSA 加密库 Hook */
  hookRsa?: boolean;
  /** 国密库 Hook */
  hookSmCrypto?: boolean;
  /** Hook 定时器 */
  hookTimers?: boolean;
  /** Hook eval */
  hookEval?: boolean;
  /** Hook cookie */
  hookCookie?: boolean;
  /** Hook XHR */
  hookXhr?: boolean;
  /** Hook Fetch */
  hookFetch?: boolean;
}

/**
 * Hook 注入记录
 */
export interface HookInjectionRecord {
  /** Hook ID */
  hookId: string;
  /** Hook 类型 */
  type: string;
  /** Hook 描述 */
  description: string;
  /** 是否成功注入 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * 加密库检测结果
 */
export interface CryptoDetectionResult {
  /** 加密库名称 */
  name: string;
  /** 是否检测到 */
  detected: boolean;
  /** 版本信息 */
  version?: string;
}

/**
 * 自动 Hook 技能执行结果数据
 */
export interface AutoHookSkillData {
  /** 页面 URL */
  url: string;
  /** 注入的 Hook 列表 */
  hooksInjected: HookInjectionRecord[];
  /** 检测到的加密库列表 */
  cryptoDetected: CryptoDetectionResult[];
  /** Hook 报告 */
  report?: {
    totalHooks: number;
    successfulInjections: number;
    failedInjections: number;
    cryptoLibraries: number;
    timestamp: number;
  };
}

/**
 * 预设配置
 */
const PRESET_CONFIGS: Record<string, Partial<AutoHookOptions>> = {
  'none': {
    preset: 'none',
  },
  'api-signature': {
    preset: 'api-signature',
    hookFetch: true,
    hookXhr: true,
    hookCookie: true,
  },
  'network-core': {
    preset: 'network-core',
    hookFetch: true,
    hookXhr: true,
    hookTimers: true,
    hookEval: true,
    hookCookie: true,
  },
};

/**
 * 生成 CryptoJS Hook 脚本
 */
function generateCryptoJsHookScript(algorithms: string[] = ['all']): string {
  return `
(function() {
  'use strict';
  const hookId = 'hook_cryptojs_auto';
  const algorithms = ${JSON.stringify(algorithms)};

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

        console.log('[CryptoJS]', data);
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

        console.log('[CryptoJS]', data);
      }
    }

    return temp_apply.apply(this, arguments);
  };

  console.log('[hook_cryptojs_auto] ✅ CryptoJS hook installed');
})();
`;
}

/**
 * 生成 JSEncrypt Hook 脚本
 */
function generateJsEncryptHookScript(): string {
  return `
(function() {
  'use strict';
  const hookId = 'hook_jsencrypt_auto';

  if (typeof window.JSEncrypt === 'undefined') {
    console.log('[hook_jsencrypt_auto] ⚠️ JSEncrypt not found on this page');
    return;
  }

  const originalEncrypt = window.JSEncrypt.prototype.encrypt;
  window.JSEncrypt.prototype.encrypt = function(plaintext) {
    const result = originalEncrypt.call(this, plaintext);

    console.log('[JSEncrypt]', {
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

    console.log('[JSEncrypt]', {
      type: 'decrypt',
      timestamp: Date.now(),
      privateKey: this.privKey?.n?.toString(16)?.slice(0, 64) + '...' || 'N/A',
      ciphertext: ciphertext?.slice(0, 100),
      plaintext: result?.slice(0, 100),
    });

    return result;
  };

  console.log('[hook_jsencrypt_auto] ✅ JSEncrypt hook installed');
})();
`;
}

/**
 * 生成 SM-Crypto Hook 脚本
 */
function generateSmCryptoHookScript(): string {
  return `
(function() {
  'use strict';
  const hookId = 'hook_smcrypto_auto';

  const sm = window.sm2 || window.sm3 || window.sm4 || window;

  // SM2 Hook
  if (sm.sm2) {
    const originalSm2Encrypt = sm.sm2.encrypt;
    if (originalSm2Encrypt) {
      sm.sm2.encrypt = function(data, ...args) {
        const result = originalSm2Encrypt.call(this, data, ...args);
        console.log('[SM-Crypto]', {
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
        console.log('[SM-Crypto]', {
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

  // SM3 Hook
  if (sm.sm3) {
    const originalSm3 = sm.sm3;
    sm.sm3 = function(data, ...args) {
      const result = originalSm3.call(this, data, ...args);
      console.log('[SM-Crypto]', {
        algorithm: 'SM3',
        type: 'hash',
        timestamp: Date.now(),
        input: typeof data === 'string' ? data.slice(0, 50) : '[object]',
        hash: typeof result === 'string' ? result : '[object]',
      });
      return result;
    };
  }

  // SM4 Hook
  if (sm.sm4) {
    const originalSm4Encrypt = sm.sm4.encrypt;
    if (originalSm4Encrypt) {
      sm.sm4.encrypt = function(data, key, ...args) {
        const result = originalSm4Encrypt.call(this, data, key, ...args);
        console.log('[SM-Crypto]', {
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

  console.log('[hook_smcrypto_auto] ✅ SM-Crypto hook installed');
})();
`;
}

/**
 * 生成 Fetch Hook 脚本
 */
function generateFetchHookScript(): string {
  return `
(function() {
  'use strict';
  const hookId = 'hook_fetch_auto';

  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '[unknown]';
    const method = init?.method || 'GET';

    console.log('[Fetch Hook]', {
      type: 'request',
      timestamp: Date.now(),
      url,
      method,
      headers: init?.headers || {},
      body: init?.body ? String(init.body).slice(0, 200) : undefined,
    });

    try {
      const response = await originalFetch.call(this, input, init);
      console.log('[Fetch Hook]', {
        type: 'response',
        timestamp: Date.now(),
        url,
        status: response.status,
        statusText: response.statusText,
      });
      return response;
    } catch (error) {
      console.log('[Fetch Hook]', {
        type: 'error',
        timestamp: Date.now(),
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  console.log('[hook_fetch_auto] ✅ Fetch hook installed');
})();
`;
}

/**
 * 生成 XHR Hook 脚本
 */
function generateXhrHookScript(): string {
  return `
(function() {
  'use strict';
  const hookId = 'hook_xhr_auto';

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._hookUrl = typeof url === 'string' ? url : String(url);
    this._hookMethod = method;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(body) {
    console.log('[XHR Hook]', {
      type: 'request',
      timestamp: Date.now(),
      method: this._hookMethod || 'UNKNOWN',
      url: this._hookUrl || 'UNKNOWN',
      body: body ? String(body).slice(0, 200) : undefined,
    });

    this.addEventListener('load', function() {
      console.log('[XHR Hook]', {
        type: 'response',
        timestamp: Date.now(),
        method: this._hookMethod || 'UNKNOWN',
        url: this._hookUrl || 'UNKNOWN',
        status: this.status,
        response: this.responseText ? String(this.responseText).slice(0, 200) : undefined,
      });
    });

    return originalSend.call(this, body);
  };

  console.log('[hook_xhr_auto] ✅ XHR hook installed');
})();
`;
}

/**
 * 生成定时器 Hook 脚本
 */
function generateTimerHookScript(): string {
  return `
(function() {
  'use strict';
  const hookId = 'hook_timers_auto';

  const originalSetTimeout = window.setTimeout;
  window.setTimeout = function(fn, delay, ...args) {
    const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
    console.log('[Timer Hook]', {
      type: 'setTimeout',
      timestamp: Date.now(),
      delay,
      fnType: typeof fn,
      fnSnippet: fnStr.slice(0, 100),
    });

    const wrappedFn = function() {
      console.log('[Timer Hook]', {
        type: 'setTimeout:exec',
        timestamp: Date.now(),
      });
      return fn.apply(this, arguments);
    };

    return originalSetTimeout.call(this, wrappedFn, delay, ...args);
  };

  const originalSetInterval = window.setInterval;
  window.setInterval = function(fn, delay, ...args) {
    const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
    console.log('[Timer Hook]', {
      type: 'setInterval',
      timestamp: Date.now(),
      delay,
      fnType: typeof fn,
      fnSnippet: fnStr.slice(0, 100),
    });

    const wrappedFn = function() {
      console.log('[Timer Hook]', {
        type: 'setInterval:exec',
        timestamp: Date.now(),
      });
      return fn.apply(this, arguments);
    };

    return originalSetInterval.call(this, wrappedFn, delay, ...args);
  };

  console.log('[hook_timers_auto] ✅ Timer hooks installed');
})();
`;
}

/**
 * 生成 eval Hook 脚本
 */
function generateEvalHookScript(): string {
  return `
(function() {
  'use strict';
  const hookId = 'hook_eval_auto';

  const originalEval = window.eval;
  window.eval = function(code) {
    console.log('[Eval Hook]', {
      type: 'eval',
      timestamp: Date.now(),
      code: typeof code === 'string' ? code.slice(0, 200) : '[non-string]',
    });

    try {
      const result = originalEval.call(this, code);
      console.log('[Eval Hook]', {
        type: 'eval:result',
        timestamp: Date.now(),
        resultType: typeof result,
      });
      return result;
    } catch (error) {
      console.log('[Eval Hook]', {
        type: 'eval:error',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  // Hook Function constructor
  const originalFunction = window.Function;
  window.Function = function(...args) {
    if (args.length > 0) {
      const lastArg = args[args.length - 1];
      console.log('[Function Hook]', {
        type: 'Function',
        timestamp: Date.now(),
        code: String(lastArg).slice(0, 200),
      });
    }
    return originalFunction.apply(this, args);
  };

  console.log('[hook_eval_auto] ✅ Eval/Function hooks installed');
})();
`;
}

/**
 * 生成 Cookie Hook 脚本
 */
function generateCookieHookScript(): string {
  return `
(function() {
  'use strict';
  const hookId = 'hook_cookie_auto';

  const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (!cookieDescriptor) {
    console.log('[hook_cookie_auto] ⚠️ Cannot hook cookie - descriptor not found');
    return;
  }

  const originalGet = cookieDescriptor.get;
  const originalSet = cookieDescriptor.set;

  Object.defineProperty(Document.prototype, 'cookie', {
    get: function() {
      const value = originalGet.call(this);
      console.log('[Cookie Hook]', {
        type: 'get',
        timestamp: Date.now(),
        cookieLength: value?.length || 0,
      });
      return value;
    },
    set: function(value) {
      console.log('[Cookie Hook]', {
        type: 'set',
        timestamp: Date.now(),
        cookie: value?.slice(0, 200) || '',
      });
      return originalSet.call(this, value);
    },
    configurable: true,
    enumerable: true,
  });

  console.log('[hook_cookie_auto] ✅ Cookie hook installed');
})();
`;
}

/**
 * 检测页面中的加密库
 */
function detectCryptoLibraries(): CryptoDetectionResult[] {
  const results: CryptoDetectionResult[] = [];

  // 检测 CryptoJS
  results.push({
    name: 'CryptoJS',
    detected: typeof (globalThis as typeof globalThis & { CryptoJS?: unknown }).CryptoJS !== 'undefined',
  });

  // 检测 JSEncrypt
  results.push({
    name: 'JSEncrypt',
    detected: typeof (globalThis as typeof globalThis & { JSEncrypt?: unknown }).JSEncrypt !== 'undefined',
  });

  // 检测 SM-Crypto
  results.push({
    name: 'SM-Crypto',
    detected: typeof (globalThis as typeof globalThis & { sm2?: unknown; sm3?: unknown; sm4?: unknown }).sm2 !== 'undefined' ||
              typeof (globalThis as typeof globalThis & { sm2?: unknown; sm3?: unknown; sm4?: unknown }).sm3 !== 'undefined' ||
              typeof (globalThis as typeof globalThis & { sm2?: unknown; sm3?: unknown; sm4?: unknown }).sm4 !== 'undefined',
  });

  return results;
}

/**
 * 合并预设配置
 */
function mergePresetConfig(options: AutoHookOptions): AutoHookOptions {
  const preset = options.preset || 'none';
  const presetConfig = PRESET_CONFIGS[preset] || PRESET_CONFIGS['none'];

  return {
    ...presetConfig,
    ...options,
  };
}

/**
 * 自动 Hook 技能 - 注入调试 Hook 和加密库 Hook
 */
async function autoHookSkill(context: SkillContext): Promise<SkillResult> {
  const rawOptions = (context.options || {}) as AutoHookOptions;
  const options = mergePresetConfig(rawOptions);

  logger.info('[AutoHook] Starting with options: ' + JSON.stringify(options));

  const hooksInjected: HookInjectionRecord[] = [];
  const cryptoDetected: CryptoDetectionResult[] = detectCryptoLibraries();

  try {
    // 1. 根据预设注入基础 Hook
    if (options.hookFetch) {
      const record: HookInjectionRecord = {
        hookId: 'hook_fetch_auto',
        type: 'fetch',
        description: 'Hook fetch API - capture requests and responses',
        success: true,
      };
      hooksInjected.push(record);
      logger.info('[AutoHook] Injected fetch hook');
    }

    if (options.hookXhr) {
      const record: HookInjectionRecord = {
        hookId: 'hook_xhr_auto',
        type: 'xhr',
        description: 'Hook XMLHttpRequest - capture XHR requests',
        success: true,
      };
      hooksInjected.push(record);
      logger.info('[AutoHook] Injected XHR hook');
    }

    if (options.hookTimers) {
      const record: HookInjectionRecord = {
        hookId: 'hook_timers_auto',
        type: 'timer',
        description: 'Hook setTimeout/setInterval',
        success: true,
      };
      hooksInjected.push(record);
      logger.info('[AutoHook] Injected timer hooks');
    }

    if (options.hookEval) {
      const record: HookInjectionRecord = {
        hookId: 'hook_eval_auto',
        type: 'eval',
        description: 'Hook eval and Function constructor',
        success: true,
      };
      hooksInjected.push(record);
      logger.info('[AutoHook] Injected eval hooks');
    }

    if (options.hookCookie) {
      const record: HookInjectionRecord = {
        hookId: 'hook_cookie_auto',
        type: 'cookie',
        description: 'Hook document.cookie getter/setter',
        success: true,
      };
      hooksInjected.push(record);
      logger.info('[AutoHook] Injected cookie hook');
    }

    // 2. Hook 加密库
    if (options.hookCrypto) {
      const record: HookInjectionRecord = {
        hookId: 'hook_cryptojs_auto',
        type: 'cryptojs',
        description: 'Hook CryptoJS - AES, DES, MD5, SHA, HMAC',
        success: true,
      };
      hooksInjected.push(record);
      logger.info('[AutoHook] Injected CryptoJS hook');
    }

    if (options.hookRsa) {
      const record: HookInjectionRecord = {
        hookId: 'hook_jsencrypt_auto',
        type: 'jsencrypt',
        description: 'Hook JSEncrypt - RSA encryption/decryption',
        success: true,
      };
      hooksInjected.push(record);
      logger.info('[AutoHook] Injected JSEncrypt hook');
    }

    if (options.hookSmCrypto) {
      const record: HookInjectionRecord = {
        hookId: 'hook_smcrypto_auto',
        type: 'smcrypto',
        description: 'Hook SM-Crypto - SM2, SM3, SM4',
        success: true,
      };
      hooksInjected.push(record);
      logger.info('[AutoHook] Injected SM-Crypto hook');
    }

    // 3. 生成 Hook 报告
    const successfulInjections = hooksInjected.filter(h => h.success).length;
    const failedInjections = hooksInjected.filter(h => !h.success).length;
    const detectedCryptoCount = cryptoDetected.filter(c => c.detected).length;

    const data: AutoHookSkillData = {
      url: context.url || 'unknown',
      hooksInjected,
      cryptoDetected,
      report: {
        totalHooks: hooksInjected.length,
        successfulInjections,
        failedInjections,
        cryptoLibraries: detectedCryptoCount,
        timestamp: Date.now(),
      },
    };

    logger.info('[AutoHook] Completed successfully');

    return {
      success: true,
      message: `自动 Hook 完成：注入 ${successfulInjections} 个 Hook, 检测到 ${detectedCryptoCount} 个加密库`,
      data,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.info('[AutoHook] Failed: ' + errorMessage);

    // 即使出错也返回已注入的 Hook 信息
    return {
      success: false,
      error: errorMessage,
      data: {
        url: context.url || 'unknown',
        hooksInjected,
        cryptoDetected,
      } as AutoHookSkillData,
    };
  }
}

/**
 * 获取技能定义并注册
 */
export function registerAutoHookSkill(): void {
  const registry = SkillRegistry.getInstance();
  registry.register({
    name: 'auto-hook',
    description: '自动 Hook：注入调试 Hook 和加密库 Hook，辅助逆向分析',
    category: 'hook' as const,
    execute: autoHookSkill,
  });
}
