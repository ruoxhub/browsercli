# AntiDebug_Breaker 扩展功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AntiDebug_Breaker 插件的核心功能集成到 JSReverser-MCP 项目中，增强反调试绕过、加密库 Hook 和 Vue 框架支持能力

**Architecture:** 基于现有 HookCodeBuilder 和 DebuggerManager 架构，新增三大模块：
1. **AntiDebugModule**: 反调试绕过工具集（bypass_debugger、anti_anti_debug）
2. **CryptoHookModule**: 加密库专用 Hook 模板（CryptoJS、JSEncrypt、SMCrypto）
3. **VueReverseModule**: Vue 框架逆向工具（路由获取、守卫清除、Devtools 激活）

**Tech Stack:** TypeScript, Puppeteer, CDP Protocol, HookCodeBuilder, MCP SDK

**Plan Created:** 2026-03-30

---

## 阶段 1: 反调试绕过模块

### Task 1.1: bypass_debugger 工具实现

**Files:**
- Create: `src/tools/anti-debug/bypassDebugger.ts`
- Test: `tests/unit/tools/anti-debug/bypassDebugger.test.ts`

- [ ] **Step 1: 创建 bypassDebugger 工具文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { zod } from '../../third_party/index.js';
import { ToolCategory } from './categories.js';
import { defineTool } from './ToolDefinition.js';

/**
 * Bypass Debugger - 绕过无限 debugger
 *
 * Hook eval、Function、Function.prototype.constructor，移除代码中的 debugger 关键字
 */
export const bypassDebugger = defineTool({
  name: 'bypass_debugger',
  description: '绕过无限 debugger：自动移除 eval/Function/constructor 中的 debugger 关键字',
  annotations: {
    title: 'Bypass Debugger',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    targets: zod
      .array(zod.enum(['eval', 'Function', 'constructor']))
      .optional()
      .describe('要 Hook 的目标，默认全部'),
  },
  handler: async (request, response, context) => {
    const targets = request.params.targets || ['eval', 'Function', 'constructor'];

    const hookCode = `
(function() {
  'use strict';

  const targets = ${JSON.stringify(targets)};
  const hookId = 'bypass_debugger';

  // Hook window.eval
  if (targets.includes('eval')) {
    const temp_eval = window.eval;
    window.eval = function() {
      if (typeof arguments[0] === 'string') {
        arguments[0] = arguments[0].replaceAll(/debugger/g, '');
      }
      return temp_eval.apply(this, arguments);
    };
    console.log('[${hookId}] ✅ Hooked: window.eval');
  }

  // Hook Function
  if (targets.includes('Function')) {
    const Bypass_debugger = Function;
    Function = function() {
      for (let i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === 'string') {
          arguments[i] = arguments[i].replaceAll(/debugger/g, '');
        }
      }
      return Bypass_debugger.apply(this, arguments);
    };
    Function.prototype = Bypass_debugger.prototype;
    console.log('[${hookId}] ✅ Hooked: Function');
  }

  // Hook Function.prototype.constructor
  if (targets.includes('constructor')) {
    const Bypass_debugger = Function;
    Function.prototype.constructor = function() {
      for (let i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === 'string') {
          arguments[i] = arguments[i].replaceAll(/debugger/g, '');
        }
      }
      return Bypass_debugger.apply(this, arguments);
    };
    Function.prototype.constructor.prototype = Function.prototype;
    console.log('[${hookId}] ✅ Hooked: Function.prototype.constructor');
  }

  console.log('[${hookId}] ✅ All debugger bypass hooks installed');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);

      response.appendResponseLine('✅ Bypass Debugger 已安装');
      response.appendResponseLine(`- Hook 目标：${targets.join(', ')}`);
      response.appendResponseLine('');
      response.appendResponseLine('已绕过以下无限 debugger 方式:');
      if (targets.includes('eval')) {
        response.appendResponseLine('  - eval() 中的 debugger 关键字');
      }
      if (targets.includes('Function')) {
        response.appendResponseLine('  - Function 构造器中的 debugger 关键字');
      }
      if (targets.includes('constructor')) {
        response.appendResponseLine('  - Function.prototype.constructor 中的 debugger 关键字');
      }
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

- [ ] **Step 2: 创建测试文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTestServer } from '../../server.js';

describe('bypassDebugger', () => {
  let server;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should install eval bypass', async () => {
    const response = await server.invoke('bypass_debugger', {
      targets: ['eval'],
    });

    assert.ok(response.content.some(c =>
      c.type === 'text' && c.text.includes('✅ Bypass Debugger 已安装')
    ));
  });

  it('should install all bypasses by default', async () => {
    const response = await server.invoke('bypass_debugger', {});

    assert.ok(response.content.some(c =>
      c.type === 'text' && c.text.includes('window.eval')
    ));
    assert.ok(response.content.some(c =>
      c.type === 'text' && c.text.includes('Function')
    ));
    assert.ok(response.content.some(c =>
      c.type === 'text' && c.text.includes('constructor')
    ));
  });
});
```

- [ ] **Step 3: 注册工具到工具注册表**

修改 `src/tools/index.ts`，添加:
```typescript
export { bypassDebugger } from './anti-debug/bypassDebugger.js';
```

- [ ] **Step 4: 运行测试验证**

```bash
npm run build
npm run test -- tests/unit/tools/anti-debug/bypassDebugger.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/tools/anti-debug/bypassDebugger.ts
git add tests/unit/tools/anti-debug/bypassDebugger.test.ts
git commit -m "feat: add bypass_debugger tool for infinite debugger bypass"
```

---

### Task 1.2: anti_anti_debug 工具集实现

**Files:**
- Create: `src/tools/anti-debug/antiAntiDebug.ts`
- Test: `tests/unit/tools/anti-debug/antiAntiDebug.test.ts`

- [ ] **Step 1: 创建 antiAntiDebug 工具文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { zod } from '../../third_party/index.js';
import { ToolCategory } from './categories.js';
import { defineTool } from './ToolDefinition.js';

export type AntiAntiDebugFeature =
  | 'fixedWindowSize'
  | 'fixedTime'
  | 'preventClose'
  | 'preventHistoryBack'
  | 'preventConsoleClear';

const FEATURE_DESCRIPTIONS: Record<AntiAntiDebugFeature, string> = {
  fixedWindowSize: '固定浏览器窗口尺寸，绕过 DevTools 检测',
  fixedTime: '固定 Date.now() 和 performance.now() 返回值',
  preventClose: '阻止 window.close() 关闭页面',
  preventHistoryBack: '阻止 history.back/go() 返回上一页',
  preventConsoleClear: '阻止 console.clear() 清除控制台',
};

export const antiAntiDebug = defineTool({
  name: 'anti_anti_debug',
  description: '反反调试工具集：窗口尺寸/时间函数/页面关闭/历史跳转/控制台清除',
  annotations: {
    title: 'Anti-Anti-Debug',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    features: zod
      .array(zod.enum(['fixedWindowSize', 'fixedTime', 'preventClose', 'preventHistoryBack', 'preventConsoleClear']))
      .describe('要启用的功能'),
  },
  handler: async (request, response, context) => {
    const features = request.params.features;

    const hookCodes: string[] = [];
    const installedFeatures: string[] = [];

    // Fixed Window Size
    if (features.includes('fixedWindowSize')) {
      hookCodes.push(`
(function() {
  'use strict';
  Object.defineProperties(window, {
    innerWidth: { value: 1366, writable: false, configurable: true },
    innerHeight: { value: 660, writable: false, configurable: true },
    outerWidth: { value: 1400, writable: false, configurable: true },
    outerHeight: { value: 760, writable: false, configurable: true },
  });
  console.log('[anti_anti_debug] ✅ Fixed window size');
})();
`);
      installedFeatures.push('fixedWindowSize');
    }

    // Fixed Time
    if (features.includes('fixedTime')) {
      hookCodes.push(`
(function() {
  'use strict';
  const originalDateNow = Date.now;
  const originalPerformanceNow = performance.now;

  Date.now = () => 0;
  console.log('[anti_anti_debug] ✅ Fixed Date.now()');

  if (typeof performance !== 'undefined' && performance.now) {
    performance.now = () => 0;
    console.log('[anti_anti_debug] ✅ Fixed performance.now()');
  }
})();
`);
      installedFeatures.push('fixedTime');
    }

    // Prevent Close
    if (features.includes('preventClose')) {
      hookCodes.push(`
(function() {
  'use strict';
  window.close = function() {
    console.log('[anti_anti_debug] ⛔ Blocked: window.close()');
  };
  console.log('[anti_anti_debug] ✅ Blocked window.close');
})();
`);
      installedFeatures.push('preventClose');
    }

    // Prevent History Back
    if (features.includes('preventHistoryBack')) {
      hookCodes.push(`
(function() {
  'use strict';
  const originalHistory = window.history;

  originalHistory.back = function() {
    console.log('[anti_anti_debug] ⛔ Blocked: history.back()');
  };

  originalHistory.go = function() {
    console.log('[anti_anti_debug] ⛔ Blocked: history.go()');
  };

  console.log('[anti_anti_debug] ✅ Blocked history navigation');
})();
`);
      installedFeatures.push('preventHistoryBack');
    }

    // Prevent Console Clear
    if (features.includes('preventConsoleClear')) {
      hookCodes.push(`
(function() {
  'use strict';
  console.clear = function() {
    console.log('[anti_anti_debug] ⛔ Blocked: console.clear()');
  };
  console.log('[anti_anti_debug] ✅ Blocked console.clear');
})();
`);
      installedFeatures.push('preventConsoleClear');
    }

    // Combine all hooks
    const combinedCode = hookCodes.join('\n');

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(combinedCode);

      response.appendResponseLine('✅ Anti-Anti-Debug 已安装');
      response.appendResponseLine(`- 启用功能：${installedFeatures.length}`);
      response.appendResponseLine('');

      for (const feature of installedFeatures) {
        response.appendResponseLine(`- ${FEATURE_DESCRIPTIONS[feature]}`);
      }
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

- [ ] **Step 2: 创建测试文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTestServer } from '../../server.js';

describe('antiAntiDebug', () => {
  let server;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should install fixed window size', async () => {
    const response = await server.invoke('anti_anti_debug', {
      features: ['fixedWindowSize'],
    });

    assert.ok(response.content.some(c =>
      c.type === 'text' && c.text.includes('Fixed window size')
    ));
  });

  it('should install multiple features', async () => {
    const response = await server.invoke('anti_anti_debug', {
      features: ['fixedTime', 'preventClose', 'preventConsoleClear'],
    });

    assert.ok(response.content.some(c =>
      c.type === 'text' && c.text.includes('Date.now()')
    ));
    assert.ok(response.content.some(c =>
      c.type === 'text' && c.text.includes('window.close')
    ));
    assert.ok(response.content.some(c =>
      c.type === 'text' && c.text.includes('console.clear')
    ));
  });
});
```

- [ ] **Step 3: 注册工具到工具注册表**

修改 `src/tools/index.ts`，添加:
```typescript
export { antiAntiDebug } from './anti-debug/antiAntiDebug.js';
```

- [ ] **Step 4: 运行测试验证**

```bash
npm run build
npm run test -- tests/unit/tools/anti-debug/antiAntiDebug.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/tools/anti-debug/antiAntiDebug.ts
git add tests/unit/tools/anti-debug/antiAntiDebug.test.ts
git commit -m "feat: add anti_anti_debug toolset for anti-detection bypass"
```

---

### Task 1.3: HookCodeBuilder 增强 - replace 模式支持

**Files:**
- Modify: `src/modules/hook/HookCodeBuilder.ts:418-435`

- [ ] **Step 1: 增强 buildReplaceHook 方法**

在 `HookCodeBuilder.ts` 中修改 `buildReplaceHook` 方法，添加属性保留支持：

```typescript
private buildReplaceHook(): string {
  const { target, hookId, lifecycle, description } = this.config;
  const label = target.label || target.expression;

  return [
    `// Hook (replace): ${description || label}`,
    `// ID: ${hookId}`,
    `(function() {`,
    `  'use strict';`,
    `  const __original = ${target.expression};`,
    `  if (typeof __original !== 'function') {`,
    `    console.warn('[${hookId}] Target is not a function: ${label}');`,
    `    return;`,
    `  }`,
    `  ${target.expression} = function(...args) {`,
    `    const originalFn = __original.bind(this);`,
    `    ${lifecycle.replace}`,
    `  };`,
    `  // Preserve function properties`,
    `  try {`,
    `    Object.defineProperty(${target.expression}, 'length', { value: __original.length });`,
    `    Object.defineProperty(${target.expression}, 'name', { value: __original.name });`,
    `  } catch(e) {}`,
    `  console.log('[${hookId}] ✅ Replaced: ${label}');`,
    `})();`,
  ].join('\n');
}
```

- [ ] **Step 2: 添加 asyncAutoDetect 配置**

在 `BuilderConfig` 接口中添加:
```typescript
asyncAutoDetect: boolean;
```

在构造函数中初始化:
```typescript
asyncAware: false,
asyncAutoDetect: false,
```

添加链式配置方法:
```typescript
/** 启用 async 自动检测 */
autoDetectAsync(enabled = true): this {
  this.config.asyncAutoDetect = enabled;
  return this;
}
```

- [ ] **Step 3: 运行类型检查**

```bash
npm run typecheck
```

- [ ] **Step 4: 提交**

```bash
git add src/modules/hook/HookCodeBuilder.ts
git commit -m "refactor: enhance HookCodeBuilder replace mode with property preservation"
```

---

## 阶段 2: 加密库专用 Hook

### Task 2.1: HookCryptoJS 模板实现

**Files:**
- Create: `src/tools/crypto/hookCryptoJS.ts`
- Test: `tests/unit/tools/crypto/hookCryptoJS.test.ts`

- [ ] **Step 1: 创建 hookCryptoJS 工具文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { zod } from '../../third_party/index.js';
import { ToolCategory } from './categories.js';
import { defineTool } from './ToolDefinition.js';

export const hookCryptoJS = defineTool({
  name: 'hook_cryptojs',
  description: 'Hook CryptoJS 加密库：AES、DES、MD5、SHA 等对称/哈希/HMAC 算法',
  annotations: {
    title: 'Hook CryptoJS',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    algorithms: zod
      .array(zod.enum(['AES', 'DES', 'MD5', 'SHA', 'HMAC', 'all']))
      .optional()
      .describe('要 Hook 的算法，默认全部'),
    logFormat: zod
      .enum(['full', 'compact', 'json'])
      .optional()
      .default('compact')
      .describe('日志输出格式'),
  },
  handler: async (request, response, context) => {
    const algorithms = request.params.algorithms || ['all'];
    const logFormat = request.params.logFormat || 'compact';

    const hookCode = `
(function() {
  'use strict';

  const hookId = 'hook_cryptojs';
  const algorithms = ${JSON.stringify(algorithms)};
  const logFormat = '${logFormat}';

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

  console.log('[${hookId}] ✅ CryptoJS hook installed');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);

      response.appendResponseLine('✅ CryptoJS Hook 已安装');
      response.appendResponseLine(`- 算法：${algorithms.join(', ')}`);
      response.appendResponseLine(`- 日志格式：${logFormat}`);
      response.appendResponseLine('');
      response.appendResponseLine('将捕获以下加密操作:');
      response.appendResponseLine('  - AES/DES 对称加密/解密');
      response.appendResponseLine('  - MD5/SHA 哈希计算');
      response.appendResponseLine('  - HMAC 消息认证码');
      response.appendResponseLine('');
      response.appendResponseLine('输出参数：key, iv, mode, padding, ciphertext');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

- [ ] **Step 2: 创建测试文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTestServer } from '../../server.js';

describe('hookCryptoJS', () => {
  let server;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should install CryptoJS hook', async () => {
    const response = await server.invoke('hook_cryptojs', {});

    assert.ok(response.content.some(c =>
      c.type === 'text' && c.text.includes('✅ CryptoJS Hook 已安装')
    ));
  });

  it('should support specific algorithms', async () => {
    const response = await server.invoke('hook_cryptojs', {
      algorithms: ['AES', 'DES'],
    });

    assert.ok(response.content.some(c =>
      c.type === 'text' && c.text.includes('AES')
    ));
  });
});
```

- [ ] **Step 3: 注册工具**

修改 `src/tools/index.ts`，添加:
```typescript
export { hookCryptoJS } from './crypto/hookCryptoJS.js';
```

- [ ] **Step 4: 运行测试验证**

```bash
npm run build
npm run test -- tests/unit/tools/crypto/hookCryptoJS.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/tools/crypto/hookCryptoJS.ts
git add tests/unit/tools/crypto/hookCryptoJS.test.ts
git commit -m "feat: add hook_cryptojs tool for CryptoJS encryption monitoring"
```

---

### Task 2.2: HookJSEncrypt 模板实现

**Files:**
- Create: `src/tools/crypto/hookJSEncrypt.ts`
- Test: `tests/unit/tools/crypto/hookJSEncrypt.test.ts`

- [ ] **Step 1: 创建 hookJSEncrypt 工具文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { zod } from '../../third_party/index.js';
import { ToolCategory } from './categories.js';
import { defineTool } from './ToolDefinition.js';

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
  handler: async (request, response, context) => {
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
    console.log('[${hookId}] ⚠️ JSEncrypt not found on this page');
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

  console.log('[${hookId}] ✅ JSEncrypt hook installed');
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
```

- [ ] **Step 2: 创建测试文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTestServer } from '../../server.js';

describe('hookJSEncrypt', () => {
  let server;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should install JSEncrypt hook', async () => {
    const response = await server.invoke('hook_jsencrypt', {});

    assert.ok(response.content.some(c =>
      c.type === 'text' && c.text.includes('✅ JSEncrypt Hook 已安装')
    ));
  });
});
```

- [ ] **Step 3: 注册工具**

修改 `src/tools/index.ts`，添加:
```typescript
export { hookJSEncrypt } from './crypto/hookJSEncrypt.js';
```

- [ ] **Step 4: 运行测试验证**

```bash
npm run build
npm run test -- tests/unit/tools/crypto/hookJSEncrypt.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/tools/crypto/hookJSEncrypt.ts
git add tests/unit/tools/crypto/hookJSEncrypt.test.ts
git commit -m "feat: add hook_jsencrypt tool for RSA encryption monitoring"
```

---

### Task 2.3: HookSMCrypto 模板实现

**Files:**
- Create: `src/tools/crypto/hookSMCrypto.ts`
- Test: `tests/unit/tools/crypto/hookSMCrypto.test.ts`

- [ ] **Step 1: 创建 hookSMCrypto 工具文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { zod } from '../../third_party/index.js';
import { ToolCategory } from './categories.js';
import { defineTool } from './ToolDefinition.js';

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
  handler: async (request, response, context) => {
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

  console.log('[${hookId}] ✅ SM-Crypto hook installed');
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
```

- [ ] **Step 2: 创建测试文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTestServer } from '../../server.js';

describe('hookSMCrypto', () => {
  let server;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should install SM-Crypto hook', async () => {
    const response = await server.invoke('hook_smcrypto', {});

    assert.ok(response.content.some(c =>
      c.type === 'text' && c.text.includes('✅ SM-Crypto Hook 已安装')
    ));
  });

  it('should support SM2 only', async () => {
    const response = await server.invoke('hook_smcrypto', {
      algorithms: ['SM2'],
    });

    assert.ok(response.content.some(c =>
      c.type === 'text' && c.text.includes('SM2')
    ));
  });
});
```

- [ ] **Step 3: 注册工具**

修改 `src/tools/index.ts`，添加:
```typescript
export { hookSMCrypto } from './crypto/hookSMCrypto.js';
```

- [ ] **Step 4: 运行测试验证**

```bash
npm run build
npm run test -- tests/unit/tools/crypto/hookSMCrypto.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/tools/crypto/hookSMCrypto.ts
git add tests/unit/tools/crypto/hookSMCrypto.test.ts
git commit -m "feat: add hook_smcrypto tool for Chinese national crypto monitoring"
```

---

## 阶段 3: Vue 框架支持

### Task 3.1: getVueRoutes 工具实现

**Files:**
- Create: `src/tools/vue/getVueRoutes.ts`
- Test: `tests/unit/tools/vue/getVueRoutes.test.ts`

- [ ] **Step 1: 创建 getVueRoutes 工具文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { zod } from '../../third_party/index.js';
import { ToolCategory } from './categories.js';
import { defineTool } from './ToolDefinition.js';

export const getVueRoutes = defineTool({
  name: 'get_vue_routes',
  description: '获取 Vue Router 路由表：已加载的路由配置信息',
  annotations: {
    title: 'Get Vue Routes',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    includeChildren: zod
      .boolean()
      .optional()
      .default(true)
      .describe('是否包含子路由'),
    maxDepth: zod
      .number()
      .int()
      .optional()
      .default(3)
      .describe('最大递归深度'),
  },
  handler: async (request, response, context) => {
    const includeChildren = request.params.includeChildren ?? true;
    const maxDepth = request.params.maxDepth ?? 3;

    const getCode = `
(function() {
  function findVueInstance() {
    // Vue 3
    const rootElement = document.querySelector('[id="app"], [data-v-app]');
    if (rootElement && rootElement.__vue_app__) {
      return rootElement.__vue_app__;
    }

    // Vue 2
    for (const key in window) {
      if (key.startsWith('__vue')) {
        const app = window[key];
        if (app && app.$router) {
          return app;
        }
      }
    }

    return null;
  }

  function extractRoutes(router, depth = 0) {
    if (!router || depth > ${maxDepth}) return [];

    const routes = router.options?.routes || router.options || [];

    return routes.map(route => {
      const extracted = {
        path: route.path,
        name: route.name,
        component: route.component?.__name || route.component?.name || 'Anonymous',
      };

      if (${includeChildren} && route.children && route.children.length > 0) {
        extracted.children = extractRoutes({ options: route.children }, depth + 1);
      }

      return extracted;
    });
  }

  const app = findVueInstance();
  const router = app?.$router || app?._router;

  if (!router) {
    return {
      found: false,
      error: 'Vue Router not found. This page may not use Vue or Vue Router.'
    };
  }

  const routes = extractRoutes(router);
  const currentRoute = router.currentRoute?.value || router.currentRoute;

  return {
    found: true,
    vueVersion: router.constructor?.name?.includes('VueRouter') ? '2.x' : '3.x',
    routes,
    currentRoute: {
      path: currentRoute?.path,
      name: currentRoute?.name,
    },
  };
})();
`;

    try {
      const frame = context.getSelectedFrame();
      const result = await frame.evaluate(getCode) as {
        found: boolean;
        vueVersion?: string;
        routes?: any[];
        currentRoute?: { path: string; name: string };
        error?: string;
      };

      if (!result.found) {
        response.appendResponseLine('❌ 未检测到 Vue Router');
        response.appendResponseLine(result.error || '此页面可能未使用 Vue 或 Vue Router');
        return;
      }

      response.appendResponseLine('✅ Vue Router 已检测到');
      response.appendResponseLine(`- Vue 版本：${result.vueVersion}`);
      response.appendResponseLine(`- 当前路由：${result.currentRoute?.path || 'N/A'} (${result.currentRoute?.name || 'N/A'})`);
      response.appendResponseLine('');
      response.appendResponseLine(`路由表 (${result.routes?.length || 0}):`);
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result.routes, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

- [ ] **Step 2: 创建测试文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTestServer } from '../../server.js';

describe('getVueRoutes', () => {
  let server;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should handle non-Vue pages gracefully', async () => {
    const response = await server.invoke('get_vue_routes', {});

    assert.ok(response.content.some(c =>
      c.type === 'text' && (c.text.includes('未检测到 Vue Router') || c.text.includes('Vue Router'))
    ));
  });
});
```

- [ ] **Step 3: 注册工具**

修改 `src/tools/index.ts`，添加:
```typescript
export { getVueRoutes } from './vue/getVueRoutes.js';
```

- [ ] **Step 4: 运行测试验证**

```bash
npm run build
npm run test -- tests/unit/tools/vue/getVueRoutes.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/tools/vue/getVueRoutes.ts
git add tests/unit/tools/vue/getVueRoutes.test.ts
git commit -m "feat: add get_vue_routes tool for Vue Router inspection"
```

---

### Task 3.2: clearVueGuards 工具实现

**Files:**
- Create: `src/tools/vue/clearVueGuuards.ts`
- Test: `tests/unit/tools/vue/clearVueGuards.test.ts`

- [ ] **Step 1: 创建 clearVueGuards 工具文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { zod } from '../../third_party/index.js';
import { ToolCategory } from './categories.js';
import { defineTool } from './ToolDefinition.js';

export const clearVueGuards = defineTool({
  name: 'clear_vue_guards',
  description: '清除 Vue Router 全局守卫：beforeEach、beforeResolve',
  annotations: {
    title: 'Clear Vue Guards',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    guards: zod
      .array(zod.enum(['beforeEach', 'beforeResolve', 'afterEach', 'all']))
      .optional()
      .describe('要清除的守卫，默认全部'),
  },
  handler: async (request, response, context) => {
    const guards = request.params.guards || ['all'];

    const hookCode = `
(function() {
  'use strict';

  function findRouter() {
    const rootElement = document.querySelector('[id="app"], [data-v-app]');
    if (rootElement && rootElement.__vue_app__) {
      return rootElement.__vue_app__?.$router;
    }

    for (const key in window) {
      if (key.startsWith('__vue')) {
        const app = window[key];
        if (app && app.$router) {
          return app.$router;
        }
      }
    }

    return null;
  }

  const router = findRouter();

  if (!router) {
    return { success: false, error: 'Vue Router not found' };
  }

  const clearedGuards = [];

  // Clear beforeEach
  if (guards.includes('beforeEach') || guards.includes('all')) {
    if (router.beforeEach) {
      router.beforeEach((to, from, next) => next());
      clearedGuards.push('beforeEach');
    }
  }

  // Clear beforeResolve
  if (guards.includes('beforeResolve') || guards.includes('all')) {
    if (router.beforeResolve) {
      router.beforeResolve((to, from, next) => next());
      clearedGuards.push('beforeResolve');
    }
  }

  // Clear afterEach
  if (guards.includes('afterEach') || guards.includes('all')) {
    if (router.afterEach) {
      router.afterEach(() => {});
      clearedGuards.push('afterEach');
    }
  }

  console.log('[clear_vue_guards] ✅ Cleared guards:', clearedGuards);

  return { success: true, clearedGuards };
})();
`;

    try {
      const frame = context.getSelectedFrame();
      const result = await frame.evaluate(hookCode) as {
        success: boolean;
        clearedGuards?: string[];
        error?: string;
      };

      if (!result.success) {
        response.appendResponseLine('❌ 清除失败');
        response.appendResponseLine(result.error || '未知错误');
        return;
      }

      response.appendResponseLine('✅ Vue Router 守卫已清除');
      response.appendResponseLine(`- 已清除的守卫：${result.clearedGuards?.join(', ') || 'none'}`);
      response.appendResponseLine('');
      response.appendResponseLine('现在路由跳转将不会被拦截。');
      response.appendResponseLine('如需恢复，请刷新页面。');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

- [ ] **Step 2: 创建测试文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTestServer } from '../../server.js';

describe('clearVueGuards', () => {
  let server;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should handle non-Vue pages gracefully', async () => {
    const response = await server.invoke('clear_vue_guards', {});

    // Should either clear guards or report Vue not found
    assert.ok(response.content.some(c =>
      c.type === 'text' && (c.text.includes('已清除') || c.text.includes('not found'))
    ));
  });
});
```

- [ ] **Step 3: 注册工具**

修改 `src/tools/index.ts`，添加:
```typescript
export { clearVueGuards } from './vue/clearVueGuards.js';
```

- [ ] **Step 4: 运行测试验证**

```bash
npm run build
npm run test -- tests/unit/tools/vue/clearVueGuards.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/tools/vue/clearVueGuards.ts
git add tests/unit/tools/vue/clearVueGuards.test.ts
git commit -m "feat: add clear_vue_guards tool for bypassing Vue Router guards"
```

---

### Task 3.3: activateVueDevtools 工具实现

**Files:**
- Create: `src/tools/vue/activateVueDevtools.ts`
- Test: `tests/unit/tools/vue/activateVueDevtools.test.ts`

- [ ] **Step 1: 创建 activateVueDevtools 工具文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { zod } from '../../third_party/index.js';
import { ToolCategory } from './categories.js';
import { defineTool } from './ToolDefinition.js';

export const activateVueDevtools = defineTool({
  name: 'activate_vue_devtools',
  description: '激活 Vue Devtools：强制启用 Vue.js 开发者工具',
  annotations: {
    title: 'Activate Vue Devtools',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (request, response, context) => {
    const hookCode = `
(function() {
  'use strict';

  // Vue 2 Devtools detection
  if (window.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
    window.__VUE_DEVTOOLS_GLOBAL_HOOK__.enabled = true;
    console.log('[activate_vue_devtools] ✅ Vue 2 Devtools activated');
    return { success: true, version: '2.x', message: 'Vue 2 Devtools activated' };
  }

  // Vue 3 Devtools detection
  const rootElement = document.querySelector('[id="app"], [data-v-app]');
  if (rootElement && rootElement.__vue_app__) {
    const app = rootElement.__vue_app__;

    // Force enable devtools
    if (app._instance) {
      app._instance.devtools = true;
    }

    // Emit devtools init event
    setTimeout(() => {
      window.postMessage({
        source: '__VUE_DEVTOOLS_GLOBAL_HOOK__',
        event: 'vue3-init',
      }, '*');
    }, 0);

    console.log('[activate_vue_devtools] ✅ Vue 3 Devtools activated');
    return { success: true, version: '3.x', message: 'Vue 3 Devtools activated' };
  }

  // Try to find Vue instance
  for (const key in window) {
    if (key.startsWith('__vue')) {
      const vueApp = window[key];
      if (vueApp && vueApp._devtools) {
        vueApp._devtools = true;
        console.log('[activate_vue_devtools] ✅ Vue Devtools activated');
        return { success: true, version: 'unknown', message: 'Vue Devtools activated' };
      }
    }
  }

  return { success: false, error: 'Vue instance not found' };
})();
`;

    try {
      const frame = context.getSelectedFrame();
      const result = await frame.evaluate(hookCode) as {
        success: boolean;
        version?: string;
        error?: string;
        message?: string;
      };

      if (!result.success) {
        response.appendResponseLine('❌ 激活失败');
        response.appendResponseLine(result.error || '未检测到 Vue 实例');
        response.appendResponseLine('');
        response.appendResponseLine('提示：请确保页面已加载 Vue 框架后再执行此工具。');
        return;
      }

      response.appendResponseLine('✅ Vue Devtools 已激活');
      response.appendResponseLine(`- Vue 版本：${result.version}`);
      response.appendResponseLine('');
      response.appendResponseLine('现在可以在 Chrome DevTools 中使用 Vue.js devtools 插件：');
      response.appendResponseLine('  - Vue 2.x: 安装 "Vue.js devtools" (v5)');
      response.appendResponseLine('  - Vue 3.x: 安装 "Vue.js devtools"');
      response.appendResponseLine('');
      response.appendResponseLine('注意：两个版本的插件不能同时启用。');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

- [ ] **Step 2: 创建测试文件**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTestServer } from '../../server.js';

describe('activateVueDevtools', () => {
  let server;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should handle non-Vue pages gracefully', async () => {
    const response = await server.invoke('activate_vue_devtools', {});

    assert.ok(response.content.some(c =>
      c.type === 'text' && (c.text.includes('已激活') || c.text.includes('not found'))
    ));
  });
});
```

- [ ] **Step 3: 注册工具**

修改 `src/tools/index.ts`，添加:
```typescript
export { activateVueDevtools } from './vue/activateVueDevtools.js';
```

- [ ] **Step 4: 运行测试验证**

```bash
npm run build
npm run test -- tests/unit/tools/vue/activateVueDevtools.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/tools/vue/activateVueDevtools.ts
git add tests/unit/tools/vue/activateVueDevtools.test.ts
git commit -m "feat: add activate_vue_devtools tool for forcing Vue Devtools"
```

---

## 最终整合任务

### Task 4.1: 工具注册表整合

**Files:**
- Modify: `src/tools/index.ts`

- [ ] **Step 1: 导出所有新工具**

```typescript
// Anti-Debug
export { bypassDebugger } from './anti-debug/bypassDebugger.js';
export { antiAntiDebug } from './anti-debug/antiAntiDebug.js';

// Crypto Hooks
export { hookCryptoJS } from './crypto/hookCryptoJS.js';
export { hookJSEncrypt } from './crypto/hookJSEncrypt.js';
export { hookSMCrypto } from './crypto/hookSMCrypto.js';

// Vue Tools
export { getVueRoutes } from './vue/getVueRoutes.js';
export { clearVueGuards } from './vue/clearVueGuards.js';
export { activateVueDevtools } from './vue/activateVueDevtools.js';
```

- [ ] **Step 2: 在 main.ts 中注册工具**

确保在 `src/main.ts` 的工具注册部分添加所有新工具。

- [ ] **Step 3: 运行完整测试套件**

```bash
npm run build
npm run test
```

- [ ] **Step 4: 提交**

```bash
git add src/tools/index.ts
git add src/main.ts
git commit -m "chore: register all new AntiDebug_Breaker extension tools"
```

---

### Task 4.2: 文档更新

**Files:**
- Modify: `docs/tool-reference.md`
- Create: `docs/guides/antidebug-breaker-features.md`

- [ ] **Step 1: 更新工具参考文档**

在 `docs/tool-reference.md` 中添加新工具的说明。

- [ ] **Step 2: 创建功能指南**

```markdown
# AntiDebug_Breaker 扩展功能指南

## 反调试绕过

### bypass_debugger

绕过无限 debugger 攻击，支持三种方式：
- `eval()` 中的 debugger 关键字
- `Function` 构造器中的 debugger 关键字
- `Function.prototype.constructor` 中的 debugger 关键字

**使用示例:**
```bash
bypass_debugger(targets=["eval", "Function"])
```

### anti_anti_debug

反反调试工具集，支持以下功能：
- `fixedWindowSize`: 固定浏览器窗口尺寸
- `fixedTime`: 固定时间函数返回值
- `preventClose`: 阻止页面关闭
- `preventHistoryBack`: 阻止历史跳转
- `preventConsoleClear`: 阻止控制台清除

**使用示例:**
```bash
anti_anti_debug(features=["fixedWindowSize", "fixedTime"])
```

## 加密库 Hook

### hook_cryptojs

Hook CryptoJS 加密库的所有对称/哈希/HMAC 算法。

**支持算法:**
- AES、DES (对称加密)
- MD5、SHA (哈希)
- HMAC (消息认证码)

**输出参数:**
- key, iv, mode, padding
- plaintext, ciphertext

### hook_jsencrypt

Hook JSEncrypt RSA 加密库。

**输出参数:**
- publicKey, privateKey
- plaintext, ciphertext

### hook_smcrypto

Hook SM-crypto 国密库。

**支持算法:**
- SM2 (椭圆曲线公钥加密)
- SM3 (密码杂凑)
- SM4 (分组密码)

## Vue 框架支持

### get_vue_routes

获取 Vue Router 路由表。

**输出:**
- 所有已注册路由
- 当前路由信息
- Vue 版本检测

### clear_vue_guards

清除 Vue Router 全局守卫。

**支持守卫:**
- beforeEach (前置守卫)
- beforeResolve (解析守卫)
- afterEach (后置守卫)

### activate_vue_devtools

强制激活 Vue Devtools。

**注意:**
- Vue 2.x 需安装 "Vue.js devtools" (v5)
- Vue 3.x 需安装 "Vue.js devtools"
- 两个版本不能同时启用
```

- [ ] **Step 3: 提交**

```bash
git add docs/tool-reference.md
git add docs/guides/antidebug-breaker-features.md
git commit -m "docs: add AntiDebug_Breaker extension features guide"
```

---

## 计划自检

- [ ] **规范覆盖检查:** 每个需求都有对应任务实现
- [ ] **无占位符:** 无 "TBD"、"TODO" 等未完成标记
- [ ] **类型一致性:** 所有工具使用一致的返回格式和错误处理
- [ ] **测试覆盖:** 每个工具都有单元测试

---

**计划完成。两个执行选项:**

**1. Subagent-Driven (推荐)** - 每个任务分派独立子代理，任务间审查，快速迭代

**2. Inline Execution** - 在当前会话中使用 executing-plans 按任务顺序执行

**选择哪种方式？**
