# Crypto Hook Functions 提取实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 `src/tools/crypto/` 提取 3 个加密库 Hook 工具的核心逻辑为独立纯函数，放置于 `src/functions/crypto/`，与原工具并存。

**Architecture:** 新函数接收 Puppeteer `Frame` 对象和参数，内部生成 Hook JS 代码字符串，通过 `frame.evaluate()` 注入，返回 `{ success, message, algorithms?, logFormat? }` 结构化对象。不依赖 MCP Tool 框架。

**Tech Stack:** TypeScript (ESM), Puppeteer Frame, Node.js test runner

---

## File Structure

```
新建:
  src/functions/crypto/types.ts         # 共享类型 (HookResult, LogFormat, CryptoJSAlgorithm, SMAlgorithm)
  src/functions/crypto/hookCryptoJS.ts  # CryptoJS Hook 纯函数
  src/functions/crypto/hookJSEncrypt.ts # JSEncrypt Hook 纯函数
  src/functions/crypto/hookSMCrypto.ts  # SM-crypto Hook 纯函数
  src/functions/crypto/index.ts          # Barrel export

测试:
  tests/unit/functions/crypto.test.ts   # 3 个函数的单元测试

不变更:
  src/tools/crypto/*                    # 原工具保留不动
```

依赖关系:
- `src/functions/crypto/*` → `src/third_party/index.js` (仅 Frame 类型)
- `src/functions/crypto/*` ✗ `src/tools/ToolDefinition.ts`
- `src/functions/crypto/*` ✗ `src/tools/crypto/*`

---

### Task 1: 创建共享类型文件

**Files:**
- Create: `src/functions/crypto/types.ts`

- [ ] **Step 1: 创建 types.ts**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

/**
 * Hook 函数统一返回结构。
 *
 * 成功时 success=true，message 包含安装确认；
 * 失败时 success=false，message 包含错误描述。
 */
export interface HookResult {
  success: boolean;
  message: string;
  /** 已 Hook 的算法列表（hookCryptoJS / hookSMCrypto 返回） */
  algorithms?: string[];
  /** 使用的日志格式 */
  logFormat?: string;
}

/** 日志输出格式 */
export type LogFormat = 'full' | 'compact' | 'json';

/** CryptoJS 支持的算法类型 */
export type CryptoJSAlgorithm = 'AES' | 'DES' | 'MD5' | 'SHA' | 'HMAC' | 'all';

/** SM-crypto 支持的算法类型 */
export type SMAlgorithm = 'SM2' | 'SM3' | 'SM4' | 'all';

/** 重新导出 Frame 类型，方便调用方导入 */
export type {Frame};
```

- [ ] **Step 2: 验证类型编译通过**

Run: `npx tsc --noEmit src/functions/crypto/types.ts`
Expected: 无错误输出

---

### Task 2: 实现 hookCryptoJS 纯函数

**Files:**
- Create: `src/functions/crypto/hookCryptoJS.ts`

- [ ] **Step 1: 创建 hookCryptoJS.ts**

从 `src/tools/crypto/hookCryptoJS.ts` 提取核心逻辑，移除 `defineTool` 包装层，改为接收 `Frame` + 参数直接返回结构化对象。

```typescript
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
      algorithms: algos,
      logFormat: format,
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit src/functions/crypto/hookCryptoJS.ts`
Expected: 无错误

---

### Task 3: 实现 hookJSEncrypt 纯函数

**Files:**
- Create: `src/functions/crypto/hookJSEncrypt.ts`

- [ ] **Step 1: 创建 hookJSEncrypt.ts**

从 `src/tools/crypto/hookJSEncrypt.ts` 提取核心逻辑。

```typescript
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
      logFormat: format,
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit src/functions/crypto/hookJSEncrypt.ts`
Expected: 无错误

---

### Task 4: 实现 hookSMCrypto 纯函数

**Files:**
- Create: `src/functions/crypto/hookSMCrypto.ts`

- [ ] **Step 1: 创建 hookSMCrypto.ts**

从 `src/tools/crypto/hookSMCrypto.ts` 提取核心逻辑。

```typescript
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
      algorithms: algos,
      logFormat: format,
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit src/functions/crypto/hookSMCrypto.ts`
Expected: 无错误

---

### Task 5: 创建 barrel export

**Files:**
- Create: `src/functions/crypto/index.ts`

- [ ] **Step 1: 创建 index.ts**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {hookCryptoJS} from './hookCryptoJS.js';
export {hookJSEncrypt} from './hookJSEncrypt.js';
export {hookSMCrypto} from './hookSMCrypto.js';
export type {
  HookResult,
  LogFormat,
  CryptoJSAlgorithm,
  SMAlgorithm,
  Frame,
} from './types.js';
```

- [ ] **Step 2: 验证整体编译**

Run: `npx tsc --noEmit`
Expected: 无错误

---

### Task 6: 编写单元测试

**Files:**
- Create: `tests/unit/functions/crypto.test.ts`

- [ ] **Step 1: 创建测试文件**

使用 mock Frame 对象验证函数行为。

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {strict as assert} from 'node:assert';
import {describe, it, mock} from 'node:test';

import {
  hookCryptoJS,
  hookJSEncrypt,
  hookSMCrypto,
} from '../../../src/functions/crypto/index.js';
import type {
  CryptoJSAlgorithm,
  SMAlgorithm,
  LogFormat,
} from '../../../src/functions/crypto/types.js';

/**
 * 创建 mock Frame 对象，记录 evaluate 调用参数。
 */
function createMockFrame(evaluateResult: unknown = undefined) {
  const evaluateFn = mock.fn(() => Promise.resolve(evaluateResult));
  return {evaluate: evaluateFn} as unknown as import('puppeteer-core').Frame;
}

describe('crypto hook functions', () => {
  // ── hookCryptoJS ──────────────────────────────────────────

  describe('hookCryptoJS', () => {
    it('应使用默认参数成功注入 Hook', async () => {
      const frame = createMockFrame();
      const result = await hookCryptoJS(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.message, 'CryptoJS Hook 已安装');
      assert.deepStrictEqual(result.algorithms, ['all']);
      assert.strictEqual(result.logFormat, 'compact');

      assert.strictEqual(frame.evaluate.mock.calls.length, 1);
      const hookCode = frame.evaluate.mock.calls[0].arguments[0] as string;
      assert.ok(hookCode.includes('hook_cryptojs'));
      assert.ok(hookCode.includes('"all"'));
      assert.ok(hookCode.includes("'compact'"));
    });

    it('应传递自定义 algorithms 参数', async () => {
      const frame = createMockFrame();
      const algorithms: CryptoJSAlgorithm[] = ['AES', 'SHA'];
      const result = await hookCryptoJS(frame, algorithms);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.algorithms, ['AES', 'SHA']);

      const hookCode = frame.evaluate.mock.calls[0].arguments[0] as string;
      assert.ok(hookCode.includes('"AES"'));
      assert.ok(hookCode.includes('"SHA"'));
    });

    it('应传递自定义 logFormat 参数', async () => {
      const frame = createMockFrame();
      const result = await hookCryptoJS(frame, ['all'], 'json');

      assert.strictEqual(result.logFormat, 'json');

      const hookCode = frame.evaluate.mock.calls[0].arguments[0] as string;
      assert.ok(hookCode.includes("'json'"));
    });

    it('应在注入失败时返回错误结果', async () => {
      const evaluateFn = mock.fn(() => {
        throw new Error('Frame detached');
      });
      const frame = {evaluate: evaluateFn} as unknown as import('puppeteer-core').Frame;

      const result = await hookCryptoJS(frame);

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Frame detached'));
      assert.strictEqual(result.algorithms, undefined);
      assert.strictEqual(result.logFormat, undefined);
    });

    it('应处理非 Error 类型的异常', async () => {
      const evaluateFn = mock.fn(() => {
        throw 'string error';
      });
      const frame = {evaluate: evaluateFn} as unknown as import('puppeteer-core').Frame;

      const result = await hookCryptoJS(frame);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.message, '错误：string error');
    });
  });

  // ── hookJSEncrypt ─────────────────────────────────────────

  describe('hookJSEncrypt', () => {
    it('应使用默认参数成功注入 Hook', async () => {
      const frame = createMockFrame();
      const result = await hookJSEncrypt(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.message, 'JSEncrypt Hook 已安装');
      assert.strictEqual(result.logFormat, 'compact');
      assert.strictEqual(result.algorithms, undefined);

      const hookCode = frame.evaluate.mock.calls[0].arguments[0] as string;
      assert.ok(hookCode.includes('hook_jsencrypt'));
    });

    it('应传递自定义 logFormat 参数', async () => {
      const frame = createMockFrame();
      const result = await hookJSEncrypt(frame, 'full');

      assert.strictEqual(result.logFormat, 'full');

      const hookCode = frame.evaluate.mock.calls[0].arguments[0] as string;
      assert.ok(hookCode.includes("'full'"));
    });

    it('应在注入失败时返回错误结果', async () => {
      const evaluateFn = mock.fn(() => {
        throw new Error('Connection closed');
      });
      const frame = {evaluate: evaluateFn} as unknown as import('puppeteer-core').Frame;

      const result = await hookJSEncrypt(frame);

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Connection closed'));
    });
  });

  // ── hookSMCrypto ───────────────────────────────────────────

  describe('hookSMCrypto', () => {
    it('应使用默认参数成功注入 Hook', async () => {
      const frame = createMockFrame();
      const result = await hookSMCrypto(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.message, 'SM-Crypto Hook 已安装');
      assert.deepStrictEqual(result.algorithms, ['all']);
      assert.strictEqual(result.logFormat, 'compact');

      const hookCode = frame.evaluate.mock.calls[0].arguments[0] as string;
      assert.ok(hookCode.includes('hook_smcrypto'));
    });

    it('应传递自定义 algorithms 参数', async () => {
      const frame = createMockFrame();
      const algorithms: SMAlgorithm[] = ['SM2', 'SM4'];
      const result = await hookSMCrypto(frame, algorithms);

      assert.deepStrictEqual(result.algorithms, ['SM2', 'SM4']);

      const hookCode = frame.evaluate.mock.calls[0].arguments[0] as string;
      assert.ok(hookCode.includes('"SM2"'));
      assert.ok(hookCode.includes('"SM4"'));
    });

    it('应传递自定义 logFormat 参数', async () => {
      const frame = createMockFrame();
      const result = await hookSMCrypto(frame, ['all'], 'json' as LogFormat);

      assert.strictEqual(result.logFormat, 'json');

      const hookCode = frame.evaluate.mock.calls[0].arguments[0] as string;
      assert.ok(hookCode.includes("'json'"));
    });

    it('应在注入失败时返回错误结果', async () => {
      const evaluateFn = mock.fn(() => {
        throw new Error('Target crashed');
      });
      const frame = {evaluate: evaluateFn} as unknown as import('puppeteer-core').Frame;

      const result = await hookSMCrypto(frame);

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Target crashed'));
    });
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `npx tsx --test tests/unit/functions/crypto.test.ts`
Expected: 所有测试通过

- [ ] **Step 3: 提交测试文件**

```bash
git add tests/unit/functions/crypto.test.ts
git commit -m "test: add unit tests for crypto hook functions"
```

---

### Task 7: 构建验证 & 最终提交

**Files:**
- All new files in `src/functions/crypto/`

- [ ] **Step 1: 运行完整构建**

Run: `npm run build`
Expected: 构建成功，`build/src/functions/crypto/` 下生成对应 `.js` 文件

- [ ] **Step 2: 运行全量测试**

Run: `npm test`
Expected: 所有测试通过（包括新增的 crypto 函数测试）

- [ ] **Step 3: 运行类型检查**

Run: `npm run typecheck`
Expected: 无类型错误

- [ ] **Step 4: 提交所有源文件**

```bash
git add src/functions/crypto/
git commit -m "feat: extract crypto hook functions from MCP tools to src/functions/crypto/"
```

---

## Self-Review Checklist

- [x] **Spec coverage**: 每个设计要求都有对应 Task
  - hookCryptoJS → Task 2
  - hookJSEncrypt → Task 3
  - hookSMCrypto → Task 4
  - 共享类型 → Task 1
  - barrel export → Task 5
  - 测试 → Task 6
  - 构建验证 → Task 7
- [x] **Placeholder scan**: 无 TBD/TODO/实现后补充
- [x] **Type consistency**: `HookResult`, `LogFormat`, `CryptoJSAlgorithm`, `SMAlgorithm` 在所有文件中保持一致
- [x] **No unnecessary changes**: 原工具文件 `src/tools/crypto/*` 未被修改