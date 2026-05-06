/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {getRuntime} from '../../runtime.js';
import {logger} from '../../utils/logger.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 自动 Hook 工具配置
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
  /** 是否实际执行过页面注入 */
  injected?: boolean;
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
 * 自动 Hook 工具执行结果数据
 */
export interface AutoHookToolData {
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

/** 自动 Hook 工具统一返回结构 */
export interface AutoHookToolResult {
  success: boolean;
  message?: string;
  error?: string;
  tooltype: 'auto_hook';
  data?: AutoHookToolData;
}

/**
 * 预设配置
 */
const PRESET_CONFIGS: Record<string, Partial<AutoHookOptions>> = {
  none: {
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

function _generateHookStoreHelpers(hookId: string): string {
  return `
  window.__hookStore = window.__hookStore || {};
  if (!Array.isArray(window.__hookStore[hookId])) {
    window.__hookStore[hookId] = [];
  }

  function safeClone(value) {
    try {
      if (typeof value === 'function') return '[Function]';
      if (typeof Element !== 'undefined' && value instanceof Element) {
        return '[Element: ' + value.tagName + ']';
      }
      return JSON.parse(JSON.stringify(value));
    } catch (e) {
      try {
        return String(value);
      } catch {
        return '[Unserializable]';
      }
    }
  }

  function pushHookRecord(record) {
    const store = window.__hookStore[hookId];
    if (!Array.isArray(store)) return;
    store.push(record);
    if (store.length > 1000) {
      store.shift();
    }
  }
`;
}

/**
 * 生成 CryptoJS Hook 脚本
 */
function _generateCryptoJsHookScript(algorithms: string[] = ['all']): string {
  return `
(function() {
  'use strict';
  const hookId = 'hook_cryptojs_auto';
  const algorithms = ${JSON.stringify(algorithms)};
  ${_generateHookStoreHelpers('hook_cryptojs_auto')}

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
          hookId,
          type: 'cryptojs',
          target: 'Function.prototype.apply',
          event: 'encrypt',
          phase: 'before',
          operation: 'encrypt',
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

        pushHookRecord(data);
        console.log('[CryptoJS]', data);
      }

    } else if (arguments.length === 2 && arguments[0] && arguments[1] &&
               typeof arguments[1] === 'object' && arguments[1].length === 3 &&
               hasDecryptProp(arguments[1][1])) {

      if (Object.hasOwn(arguments[0], "$super") && Object.hasOwn(arguments[1], "callee")) {
        const data = {
          hookId,
          type: 'cryptojs',
          target: 'Function.prototype.apply',
          event: 'decrypt',
          phase: 'before',
          operation: 'decrypt',
          timestamp: Date.now(),
          key: arguments[1][1].toString() || 'N/A',
          iv: arguments[1][2]?.iv?.toString() || 'N/A',
        };

        pushHookRecord(data);
        console.log('[CryptoJS]', data);
      }
    }

    return temp_apply.apply(this, arguments);
  };

  pushHookRecord({
    hookId,
    type: 'cryptojs',
    target: 'Function.prototype.apply',
    event: 'installed',
    phase: 'install',
    timestamp: Date.now(),
    algorithms,
  });
  console.log('[hook_cryptojs_auto] ✅ CryptoJS hook installed');
})();
`;
}

/**
 * 生成 JSEncrypt Hook 脚本
 */
function _generateJsEncryptHookScript(): string {
  return `
(function() {
  'use strict';
  const hookId = 'hook_jsencrypt_auto';
  ${_generateHookStoreHelpers('hook_jsencrypt_auto')}

  if (typeof window.JSEncrypt === 'undefined') {
    pushHookRecord({
      hookId,
      type: 'jsencrypt',
      target: 'window.JSEncrypt',
      event: 'missing',
      phase: 'install',
      timestamp: Date.now(),
    });
    console.log('[hook_jsencrypt_auto] ⚠️ JSEncrypt not found on this page');
    return;
  }

  const originalEncrypt = window.JSEncrypt.prototype.encrypt;
  window.JSEncrypt.prototype.encrypt = function(plaintext) {
    const result = originalEncrypt.call(this, plaintext);

    const record = {
      hookId,
      type: 'jsencrypt',
      target: 'JSEncrypt.prototype.encrypt',
      event: 'encrypt',
      phase: 'after',
      timestamp: Date.now(),
      publicKey: this.pubKey?.n?.toString(16)?.slice(0, 64)
        ? this.pubKey.n.toString(16).slice(0, 64) + '...'
        : 'N/A',
      plaintext: plaintext?.slice(0, 100),
      ciphertext: result?.slice(0, 200),
    };
    pushHookRecord(record);
    console.log('[JSEncrypt]', record);

    return result;
  };

  const originalDecrypt = window.JSEncrypt.prototype.decrypt;
  window.JSEncrypt.prototype.decrypt = function(ciphertext) {
    const result = originalDecrypt.call(this, ciphertext);

    const record = {
      hookId,
      type: 'jsencrypt',
      target: 'JSEncrypt.prototype.decrypt',
      event: 'decrypt',
      phase: 'after',
      timestamp: Date.now(),
      privateKey: this.privKey?.n?.toString(16)
        ? this.privKey.n.toString(16).slice(0, 64) + '...'
        : 'N/A',
      ciphertext: ciphertext?.slice(0, 100),
      plaintext: result?.slice(0, 100),
    };
    pushHookRecord(record);
    console.log('[JSEncrypt]', record);

    return result;
  };

  pushHookRecord({
    hookId,
    type: 'jsencrypt',
    target: 'window.JSEncrypt',
    event: 'installed',
    phase: 'install',
    timestamp: Date.now(),
  });
  console.log('[hook_jsencrypt_auto] ✅ JSEncrypt hook installed');
})();
`;
}

/**
 * 生成 SM-Crypto Hook 脚本
 */
function _generateSmCryptoHookScript(): string {
  return `
(function() {
  'use strict';
  const hookId = 'hook_smcrypto_auto';
  ${_generateHookStoreHelpers('hook_smcrypto_auto')}

  const sm = window.sm2 || window.sm3 || window.sm4 || window;
  const detectedModules = [];
  if (sm.sm2) detectedModules.push('sm2');
  if (sm.sm3) detectedModules.push('sm3');
  if (sm.sm4) detectedModules.push('sm4');

  // SM2 Hook
  if (sm.sm2) {
    const originalSm2Encrypt = sm.sm2.encrypt;
    if (originalSm2Encrypt) {
      sm.sm2.encrypt = function(data, ...args) {
        const result = originalSm2Encrypt.call(this, data, ...args);
        const record = {
          hookId,
          type: 'smcrypto',
          target: 'sm2.encrypt',
          event: 'encrypt',
          phase: 'after',
          algorithm: 'SM2',
          timestamp: Date.now(),
          plaintext: data?.slice(0, 50),
          ciphertext: typeof result === 'string' ? result.slice(0, 100) : '[object]',
        };
        pushHookRecord(record);
        console.log('[SM-Crypto]', record);
        return result;
      };
    }

    const originalSm2Decrypt = sm.sm2.decrypt;
    if (originalSm2Decrypt) {
      sm.sm2.decrypt = function(cipher, ...args) {
        const result = originalSm2Decrypt.call(this, cipher, ...args);
        const record = {
          hookId,
          type: 'smcrypto',
          target: 'sm2.decrypt',
          event: 'decrypt',
          phase: 'after',
          algorithm: 'SM2',
          timestamp: Date.now(),
          ciphertext: typeof cipher === 'string' ? cipher.slice(0, 50) : '[object]',
          plaintext: typeof result === 'string' ? result.slice(0, 50) : '[object]',
        };
        pushHookRecord(record);
        console.log('[SM-Crypto]', record);
        return result;
      };
    }
  }

  // SM3 Hook
  if (sm.sm3) {
    const originalSm3 = sm.sm3;
    sm.sm3 = function(data, ...args) {
      const result = originalSm3.call(this, data, ...args);
      const record = {
        hookId,
        type: 'smcrypto',
        target: 'sm3',
        event: 'hash',
        phase: 'after',
        algorithm: 'SM3',
        timestamp: Date.now(),
        input: typeof data === 'string' ? data.slice(0, 50) : '[object]',
        hash: typeof result === 'string' ? result : '[object]',
      };
      pushHookRecord(record);
      console.log('[SM-Crypto]', record);
      return result;
    };
  }

  // SM4 Hook
  if (sm.sm4) {
    const originalSm4Encrypt = sm.sm4.encrypt;
    if (originalSm4Encrypt) {
      sm.sm4.encrypt = function(data, key, ...args) {
        const result = originalSm4Encrypt.call(this, data, key, ...args);
        const record = {
          hookId,
          type: 'smcrypto',
          target: 'sm4.encrypt',
          event: 'encrypt',
          phase: 'after',
          algorithm: 'SM4',
          timestamp: Date.now(),
          key: typeof key === 'string' ? key.slice(0, 32) : '[object]',
          plaintext: typeof data === 'string' ? data.slice(0, 50) : '[object]',
          ciphertext: typeof result === 'string' ? result.slice(0, 100) : '[object]',
        };
        pushHookRecord(record);
        console.log('[SM-Crypto]', record);
        return result;
      };
    }
  }

  pushHookRecord({
    hookId,
    type: 'smcrypto',
    target: 'window.sm*',
    event: 'installed',
    phase: 'install',
    timestamp: Date.now(),
    modules: detectedModules,
  });
  console.log('[hook_smcrypto_auto] ✅ SM-Crypto hook installed');
})();
`;
}

/**
 * 生成 Fetch Hook 脚本
 */
function _generateFetchHookScript(): string {
  return `
(function() {
  'use strict';
  const hookId = 'hook_fetch_auto';
  ${_generateHookStoreHelpers('hook_fetch_auto')}

  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '[unknown]';
    const method = init?.method || 'GET';

    const requestRecord = {
      hookId,
      type: 'fetch',
      target: 'window.fetch',
      event: 'request',
      phase: 'before',
      timestamp: Date.now(),
      url,
      method,
      headers: safeClone(init?.headers || {}),
      body: init?.body ? String(init.body).slice(0, 200) : undefined,
    };
    pushHookRecord(requestRecord);
    console.log('[Fetch Hook]', requestRecord);

    try {
      const response = await originalFetch.call(this, input, init);
      const responseRecord = {
        hookId,
        type: 'fetch',
        target: 'window.fetch',
        event: 'response',
        phase: 'success',
        timestamp: Date.now(),
        url,
        method,
        status: response.status,
        statusText: response.statusText,
      };
      pushHookRecord(responseRecord);
      console.log('[Fetch Hook]', responseRecord);
      return response;
    } catch (error) {
      const errorRecord = {
        hookId,
        type: 'fetch',
        target: 'window.fetch',
        event: 'error',
        phase: 'error',
        timestamp: Date.now(),
        url,
        method,
        error: error instanceof Error ? error.message : String(error),
      };
      pushHookRecord(errorRecord);
      console.log('[Fetch Hook]', errorRecord);
      throw error;
    }
  };

  pushHookRecord({
    hookId,
    type: 'fetch',
    target: 'window.fetch',
    event: 'installed',
    phase: 'install',
    timestamp: Date.now(),
  });

  console.log('[hook_fetch_auto] ✅ Fetch hook installed');
})();
`;
}

/**
 * 生成 XHR Hook 脚本
 */
function _generateXhrHookScript(): string {
  return `
(function() {
  'use strict';
  const hookId = 'hook_xhr_auto';
  ${_generateHookStoreHelpers('hook_xhr_auto')}

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._hookUrl = typeof url === 'string' ? url : String(url);
    this._hookMethod = method;
    this._hookCorrelationId = 'xhr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    pushHookRecord({
      hookId,
      type: 'xhr',
      target: 'XMLHttpRequest.open',
      event: 'open',
      phase: 'before',
      timestamp: Date.now(),
      url: this._hookUrl || 'UNKNOWN',
      method: this._hookMethod || 'UNKNOWN',
      correlationId: this._hookCorrelationId,
    });
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const requestRecord = {
      hookId,
      type: 'xhr',
      target: 'XMLHttpRequest.send',
      event: 'request',
      phase: 'before',
      timestamp: Date.now(),
      method: this._hookMethod || 'UNKNOWN',
      url: this._hookUrl || 'UNKNOWN',
      body: body ? String(body).slice(0, 200) : undefined,
      correlationId: this._hookCorrelationId,
    };
    pushHookRecord(requestRecord);
    console.log('[XHR Hook]', requestRecord);

    this.addEventListener('load', function() {
      const responseRecord = {
        hookId,
        type: 'xhr',
        target: 'XMLHttpRequest.send',
        event: 'response',
        phase: 'success',
        timestamp: Date.now(),
        method: this._hookMethod || 'UNKNOWN',
        url: this._hookUrl || 'UNKNOWN',
        status: this.status,
        response: this.responseText ? String(this.responseText).slice(0, 200) : undefined,
        correlationId: this._hookCorrelationId,
      };
      pushHookRecord(responseRecord);
      console.log('[XHR Hook]', responseRecord);
    });

    this.addEventListener('error', function() {
      const errorRecord = {
        hookId,
        type: 'xhr',
        target: 'XMLHttpRequest.send',
        event: 'error',
        phase: 'error',
        timestamp: Date.now(),
        method: this._hookMethod || 'UNKNOWN',
        url: this._hookUrl || 'UNKNOWN',
        correlationId: this._hookCorrelationId,
      };
      pushHookRecord(errorRecord);
      console.log('[XHR Hook]', errorRecord);
    });

    return originalSend.call(this, body);
  };

  pushHookRecord({
    hookId,
    type: 'xhr',
    target: 'XMLHttpRequest',
    event: 'installed',
    phase: 'install',
    timestamp: Date.now(),
  });

  console.log('[hook_xhr_auto] ✅ XHR hook installed');
})();
`;
}

/**
 * 生成定时器 Hook 脚本
 */
function _generateTimerHookScript(): string {
  return `
(function() {
  'use strict';
  const hookId = 'hook_timers_auto';
  ${_generateHookStoreHelpers('hook_timers_auto')}

  const originalSetTimeout = window.setTimeout;
  window.setTimeout = function(fn, delay, ...args) {
    const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
    const scheduleRecord = {
      hookId,
      type: 'timer',
      target: 'window.setTimeout',
      event: 'setTimeout',
      phase: 'before',
      timestamp: Date.now(),
      delay,
      fnType: typeof fn,
      fnSnippet: fnStr.slice(0, 100),
    };
    pushHookRecord(scheduleRecord);
    console.log('[Timer Hook]', scheduleRecord);

    const wrappedFn = function() {
      const execRecord = {
        hookId,
        type: 'timer',
        target: 'window.setTimeout',
        event: 'setTimeout:exec',
        phase: 'success',
        timestamp: Date.now(),
      };
      pushHookRecord(execRecord);
      console.log('[Timer Hook]', execRecord);
      return fn.apply(this, arguments);
    };

    return originalSetTimeout.call(this, wrappedFn, delay, ...args);
  };

  const originalSetInterval = window.setInterval;
  window.setInterval = function(fn, delay, ...args) {
    const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
    const scheduleRecord = {
      hookId,
      type: 'timer',
      target: 'window.setInterval',
      event: 'setInterval',
      phase: 'before',
      timestamp: Date.now(),
      delay,
      fnType: typeof fn,
      fnSnippet: fnStr.slice(0, 100),
    };
    pushHookRecord(scheduleRecord);
    console.log('[Timer Hook]', scheduleRecord);

    const wrappedFn = function() {
      const execRecord = {
        hookId,
        type: 'timer',
        target: 'window.setInterval',
        event: 'setInterval:exec',
        phase: 'success',
        timestamp: Date.now(),
      };
      pushHookRecord(execRecord);
      console.log('[Timer Hook]', execRecord);
      return fn.apply(this, arguments);
    };

    return originalSetInterval.call(this, wrappedFn, delay, ...args);
  };

  pushHookRecord({
    hookId,
    type: 'timer',
    target: 'window.setTimeout',
    event: 'installed',
    phase: 'install',
    timestamp: Date.now(),
  });

  console.log('[hook_timers_auto] ✅ Timer hooks installed');
})();
`;
}

/**
 * 生成 eval Hook 脚本
 */
function _generateEvalHookScript(): string {
  return `
(function() {
  'use strict';
  const hookId = 'hook_eval_auto';
  ${_generateHookStoreHelpers('hook_eval_auto')}

  const originalEval = window.eval;
  window.eval = function(code) {
    const evalRecord = {
      hookId,
      type: 'eval',
      target: 'window.eval',
      event: 'eval',
      phase: 'before',
      timestamp: Date.now(),
      code: typeof code === 'string' ? code.slice(0, 200) : '[non-string]',
    };
    pushHookRecord(evalRecord);
    console.log('[Eval Hook]', evalRecord);

    try {
      const result = originalEval.call(this, code);
      const resultRecord = {
        hookId,
        type: 'eval',
        target: 'window.eval',
        event: 'eval:result',
        phase: 'success',
        timestamp: Date.now(),
        resultType: typeof result,
      };
      pushHookRecord(resultRecord);
      console.log('[Eval Hook]', resultRecord);
      return result;
    } catch (error) {
      const errorRecord = {
        hookId,
        type: 'eval',
        target: 'window.eval',
        event: 'eval:error',
        phase: 'error',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      };
      pushHookRecord(errorRecord);
      console.log('[Eval Hook]', errorRecord);
      throw error;
    }
  };

  // Hook Function constructor
  const originalFunction = window.Function;
  window.Function = function(...args) {
    if (args.length > 0) {
      const lastArg = args[args.length - 1];
      const functionRecord = {
        hookId,
        type: 'eval',
        target: 'window.Function',
        event: 'Function',
        phase: 'before',
        timestamp: Date.now(),
        code: String(lastArg).slice(0, 200),
      };
      pushHookRecord(functionRecord);
      console.log('[Function Hook]', functionRecord);
    }
    return originalFunction.apply(this, args);
  };

  pushHookRecord({
    hookId,
    type: 'eval',
    target: 'window.eval',
    event: 'installed',
    phase: 'install',
    timestamp: Date.now(),
  });

  console.log('[hook_eval_auto] ✅ Eval/Function hooks installed');
})();
`;
}

/**
 * 生成 Cookie Hook 脚本
 */
function _generateCookieHookScript(): string {
  return `
  (function() {
    'use strict';
    const hookId = 'hook_cookie_auto';
    ${_generateHookStoreHelpers('hook_cookie_auto')}

    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (!cookieDescriptor) {
      pushHookRecord({
        hookId,
        type: 'cookie',
        target: 'Document.cookie',
        event: 'missing',
        phase: 'install',
        timestamp: Date.now(),
      });
      console.log('[hook_cookie_auto] ⚠️ Cannot hook cookie - descriptor not found');
      return;
    }

  const originalGet = cookieDescriptor.get;
  const originalSet = cookieDescriptor.set;

  Object.defineProperty(Document.prototype, 'cookie', {
    get: function() {
      const value = originalGet.call(this);
      const record = {
        hookId,
        type: 'cookie',
        target: 'Document.cookie',
        event: 'get',
        phase: 'after',
        timestamp: Date.now(),
        cookieLength: value?.length || 0,
      };
      pushHookRecord(record);
      console.log('[Cookie Hook]', record);
      return value;
    },
    set: function(value) {
      const record = {
        hookId,
        type: 'cookie',
        target: 'Document.cookie',
        event: 'set',
        phase: 'after',
        timestamp: Date.now(),
        cookie: value?.slice(0, 200) || '',
      };
      pushHookRecord(record);
      console.log('[Cookie Hook]', record);
      return originalSet.call(this, value);
    },
    configurable: true,
    enumerable: true,
  });

  pushHookRecord({
    hookId,
    type: 'cookie',
    target: 'Document.cookie',
    event: 'installed',
    phase: 'install',
    timestamp: Date.now(),
  });

  console.log('[hook_cookie_auto] ✅ Cookie hook installed');
})();
`;
}

/**
 * 检测页面中的加密库（在页面上下文中执行）
 */
async function detectCryptoLibraries(): Promise<CryptoDetectionResult[]> {
  const contextProvider = getRuntime().contextProvider!;
  const selectedPage = contextProvider.getSelectedPage?.() ?? null;
  const frame =
    contextProvider.getSelectedFrame?.() ?? selectedPage?.mainFrame?.() ?? null;

  if (!frame) {
    return [];
  }

  const results = (await frame.evaluate(() => {
    return [
      {
        name: 'CryptoJS',
        detected: typeof (window as any).CryptoJS !== 'undefined',
      },
      {
        name: 'JSEncrypt',
        detected: typeof (window as any).JSEncrypt !== 'undefined',
      },
      {
        name: 'SM-Crypto',
        detected:
          typeof (window as any).sm2 !== 'undefined' ||
          typeof (window as any).sm3 !== 'undefined' ||
          typeof (window as any).sm4 !== 'undefined',
      },
      {
        name: 'forge',
        detected: typeof (window as any).forge !== 'undefined',
      },
      {
        name: 'WebCrypto',
        detected: typeof (window as any).crypto?.subtle !== 'undefined',
      },
    ];
  })) as CryptoDetectionResult[];

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

function buildHookPlans(
  options: AutoHookOptions,
): Array<HookInjectionRecord & {script: string}> {
  const plans: Array<HookInjectionRecord & {script: string}> = [];

  if (options.hookFetch) {
    plans.push({
      hookId: 'hook_fetch_auto',
      type: 'fetch',
      description: 'Hook fetch API - capture requests and responses',
      success: true,
      injected: false,
      script: _generateFetchHookScript(),
    });
  }

  if (options.hookXhr) {
    plans.push({
      hookId: 'hook_xhr_auto',
      type: 'xhr',
      description: 'Hook XMLHttpRequest - capture XHR requests',
      success: true,
      injected: false,
      script: _generateXhrHookScript(),
    });
  }

  if (options.hookTimers) {
    plans.push({
      hookId: 'hook_timers_auto',
      type: 'timer',
      description: 'Hook setTimeout/setInterval',
      success: true,
      injected: false,
      script: _generateTimerHookScript(),
    });
  }

  if (options.hookEval) {
    plans.push({
      hookId: 'hook_eval_auto',
      type: 'eval',
      description: 'Hook eval and Function constructor',
      success: true,
      injected: false,
      script: _generateEvalHookScript(),
    });
  }

  if (options.hookCookie) {
    plans.push({
      hookId: 'hook_cookie_auto',
      type: 'cookie',
      description: 'Hook document.cookie getter/setter',
      success: true,
      injected: false,
      script: _generateCookieHookScript(),
    });
  }

  if (options.hookCrypto) {
    plans.push({
      hookId: 'hook_cryptojs_auto',
      type: 'cryptojs',
      description: 'Hook CryptoJS - AES, DES, MD5, SHA, HMAC',
      success: true,
      injected: false,
      script: _generateCryptoJsHookScript(),
    });
  }

  if (options.hookRsa) {
    plans.push({
      hookId: 'hook_jsencrypt_auto',
      type: 'jsencrypt',
      description: 'Hook JSEncrypt - RSA encryption/decryption',
      success: true,
      injected: false,
      script: _generateJsEncryptHookScript(),
    });
  }

  if (options.hookSmCrypto) {
    plans.push({
      hookId: 'hook_smcrypto_auto',
      type: 'smcrypto',
      description: 'Hook SM-Crypto - SM2, SM3, SM4',
      success: true,
      injected: false,
      script: _generateSmCryptoHookScript(),
    });
  }

  return plans;
}

async function injectHookPlans(
  plans: Array<HookInjectionRecord & {script: string}>,
): Promise<HookInjectionRecord[]> {
  const contextProvider = getRuntime().contextProvider!;
  const selectedPage = contextProvider.getSelectedPage?.() ?? null;
  const frame =
    contextProvider.getSelectedFrame?.() ?? selectedPage?.mainFrame?.() ?? null;

  if (!frame) {
    throw new Error('auto_hook 需要可用的页面/Frame 才能执行 autoInject');
  }

  const injected: HookInjectionRecord[] = [];
  for (const plan of plans) {
    try {
      await frame.evaluate(plan.script);
      injected.push({...plan, success: true, injected: true});
    } catch (error) {
      injected.push({
        ...plan,
        success: false,
        injected: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return injected;
}

/**
 * 自动 Hook 工具 - 注入调试 Hook 和加密库 Hook
 */
export const autoHook = defineTool({
  name: 'auto_hook',
  description: 'Auto-hook: generate and inject debug hooks and crypto library hooks based on preset or custom options',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {
    url: zod.string().optional().describe('Target URL'),
    preset: zod.enum(['none', 'api-signature', 'network-core']).optional().describe('Hook preset'),
    autoInject: zod.boolean().optional().describe('Auto inject hooks into page'),
    waitAfterHookMs: zod.number().optional().describe('Wait time after hook injection in ms'),
    useAI: zod.boolean().optional().describe('Use AI analysis'),
    hookCrypto: zod.boolean().optional().describe('Hook CryptoJS library'),
    hookRsa: zod.boolean().optional().describe('Hook JSEncrypt/RSA library'),
    hookSmCrypto: zod.boolean().optional().describe('Hook SM-Crypto library'),
    hookTimers: zod.boolean().optional().describe('Hook setTimeout/setInterval'),
    hookEval: zod.boolean().optional().describe('Hook eval/Function constructor'),
    hookCookie: zod.boolean().optional().describe('Hook document.cookie'),
    hookXhr: zod.boolean().optional().describe('Hook XMLHttpRequest'),
    hookFetch: zod.boolean().optional().describe('Hook fetch API'),
  },
  handler: async (request, response, context) => {
    const {url, ...rawOptions} = request.params;
    const options = mergePresetConfig(rawOptions as AutoHookOptions);

    logger.info('[AutoHook] Starting with options: ' + JSON.stringify(options));

    let hooksInjected: HookInjectionRecord[] = [];
    let cryptoDetected: CryptoDetectionResult[] = [];

    try {
      const hookPlans = buildHookPlans(options);
      hooksInjected =
        options.autoInject
          ? await injectHookPlans(hookPlans)
          : hookPlans.map(({script: _script, ...plan}) => plan);

      // 在页面上下文中检测加密库（如果存在 frame）
      const frame = context.getSelectedFrame();
      if (frame) {
        try {
          cryptoDetected = await detectCryptoLibraries();
        } catch (detectError) {
          logger.warn(
            '[AutoHook] 页面加密库检测失败: ' +
              (detectError instanceof Error
                ? detectError.message
                : String(detectError)),
          );
          cryptoDetected = [];
        }
      } else {
        logger.warn('[AutoHook] 没有可用的页面 Frame，跳过页面加密库检测');
      }

      const successfulInjections = hooksInjected.filter(h => h.success && h.injected).length;
      const failedInjections = hooksInjected.filter(h => !h.success).length;
      const detectedCryptoCount = cryptoDetected.filter(c => c.detected).length;
      const pageUrl = context.getSelectedPage()?.url?.();

      const data: AutoHookToolData = {
        url: url || pageUrl || 'unknown',
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

      const statusParts: string[] = [];
      if (options.autoInject) {
        statusParts.push(`已注入 ${successfulInjections}/${hooksInjected.length} 个 Hook`);
        if (failedInjections > 0) statusParts.push(`${failedInjections} 个注入失败`);
      } else {
        statusParts.push(`已生成 ${hooksInjected.length} 个 Hook 计划（未注入）`);
      }
      statusParts.push(`检测到 ${detectedCryptoCount} 个加密库`);
      if (!frame) statusParts.push('注意：未找到可用 Frame，加密库检测未执行');

      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: true,
            message: `自动 Hook 完成：${statusParts.join('，')}`,
            tooltype: 'auto_hook',
            data,
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.info('[AutoHook] Failed: ' + errorMessage);

      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            error: errorMessage,
            tooltype: 'auto_hook',
            data: {
              url: url || context.getSelectedPage()?.url?.() || 'unknown',
              hooksInjected,
              cryptoDetected,
            } as AutoHookToolData,
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    }
  },
});
