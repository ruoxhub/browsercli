# AntiDebug_Breaker 工具迁移实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AntiDebug_Breaker Chrome 扩展中的 17 个未迁移的 hook 脚本转为 JSReverser-MCP MCP tools

**Architecture:** 在 `src/tools/hook/` 目录下创建 14 个 TypeScript 文件（localStorage 和 sessionStorage 各 4 合 1），每个文件遵循 `defineTool()` 模式，通过 `frame.evaluate()` 注入 JS hook 代码。更新 `src/tools/index.ts` 注册所有新工具。

**Tech Stack:** TypeScript, Zod (参数校验), Puppeteer Frame.evaluate, 项目现有 ToolDefinition 模式

---

## 文件总览

### 新增文件（14 个）

| # | 文件 | 任务 |
|---|---|---|
| 1 | `src/tools/hook/hookConsoleLog.ts` | Task 1 |
| 2 | `src/tools/hook/hookConsoleTable.ts` | Task 2 |
| 3 | `src/tools/hook/hookLocationHref.ts` | Task 3 |
| 4 | `src/tools/hook/hookCookie.ts` | Task 4 |
| 5 | `src/tools/hook/hookXhrOpen.ts` | Task 5 |
| 6 | `src/tools/hook/hookXhrSetRequestHeader.ts` | Task 6 |
| 7 | `src/tools/hook/hookFetch.ts` | Task 7 |
| 8 | `src/tools/hook/hookJsonParse.ts` | Task 8 |
| 9 | `src/tools/hook/hookJsonStringify.ts` | Task 9 |
| 10 | `src/tools/hook/hookPromise.ts` | Task 10 |
| 11 | `src/tools/hook/hookRandom.ts` | Task 11 |
| 12 | `src/tools/hook/hookLocalStorage.ts` | Task 12 |
| 13 | `src/tools/hook/hookSessionStorage.ts` | Task 13 |
| 14 | `src/tools/hook/antiAntiHook.ts` | Task 14 |

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `src/tools/index.ts` | 导入 14 个新工具，注册到 `registry.registerMany()` |

---

### Task 1: hookConsoleLog - 防止重写 console.log

**Files:**
- Create: `src/tools/hook/hookConsoleLog.ts`
- Test: `tests/unit/tools/hook-console-log.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';
import {zod} from '../../../src/third_party/index.js';
import {hookConsoleLog} from '../../../src/tools/hook/hookConsoleLog.js';

describe('hook_console_log', () => {
  it('validates schema with defaults', () => {
    const schema = zod.object(hookConsoleLog.schema);
    const result = schema.parse({});
    assert.strictEqual(result.mode, 'proxy');
  });

  it('validates schema with toString mode', () => {
    const schema = zod.object(hookConsoleLog.schema);
    const result = schema.parse({mode: 'toString'});
    assert.strictEqual(result.mode, 'toString');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="hook_console_log"`
Expected: FAIL with module not found

- [ ] **Step 3: Write implementation**

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookConsoleLog = defineTool({
  name: 'hook_console_log',
  description:
    'Hook console.log：防止网站重写 console.log 方法，保持日志输出能力',
  annotations: {
    title: 'Hook Console Log',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    mode: zod
      .enum(['proxy', 'toString'])
      .optional()
      .default('proxy')
      .describe(
        '防护模式：proxy=使用 Proxy 阻止重写（推荐），toString=定期检查并恢复',
      ),
  },
  handler: async (
    request: {params: {mode?: 'proxy' | 'toString'}},
    response: Response,
    context: Context,
    runtime,
  ) => {
    const mode = request.params.mode || 'proxy';

    const hookCode =
      mode === 'proxy'
        ? `
(function() {
  'use strict';
  const readonlyProps = ['log', 'trace', 'groupCollapsed', 'groupEnd'];
  const readonlyConsole = new Proxy(console, {
    set(t, k, v, r) {
      if (readonlyProps.includes(k)) {
        console.groupCollapsed('%c有代码试图重写console.' + k + '方法，已阻止', 'color: #ff6348;', v);
        console.trace();
        console.groupEnd();
        return true;
      }
      return Reflect.set(t, k, v, r);
    }
  });
  Object.defineProperty(window, 'console', {
    configurable: true,
    enumerable: false,
    get: function() { return readonlyConsole; },
    set: function(v) {
      console.groupCollapsed('%c有代码试图重写console，已阻止', 'color: #ff6348;', v);
      console.trace();
      console.groupEnd();
    }
  });
  console.log('[hook_console_log] ✅ Console log protection installed (proxy mode)');
})();
`
        : `
(function() {
  'use strict';
  const tempLog = console.log;
  function judgeOverwrite() {
    if (console.log.toString() !== 'function log() { [native code] }') {
      console.log = tempLog;
      console.log('[hook_console_log] ⚠️ console.log was overwritten, restored');
    }
  }
  window.addEventListener('load', () => { judgeOverwrite(); });
  setTimeout(() => { judgeOverwrite(); }, 3000);
  console.log('[hook_console_log] ✅ Console log protection installed (toString mode)');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);

      response.appendResponseLine('✅ Console Log 保护已安装');
      response.appendResponseLine(`- 模式：${mode === 'proxy' ? 'Proxy 实时拦截' : '定期检查恢复'}`);
      response.appendResponseLine('');
      response.appendResponseLine('保护范围：console.log, console.trace, console.groupCollapsed, console.groupEnd');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="hook_console_log"`
Expected: PASS

---

### Task 2: hookConsoleTable - 绕过时间差检测

**Files:**
- Create: `src/tools/hook/hookConsoleTable.ts`
- Test: `tests/unit/tools/hook-console-table.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import assert from 'node:assert';
import {describe, it} from 'node:test';
import {zod} from '../../../src/third_party/index.js';
import {hookConsoleTable} from '../../../src/tools/hook/hookConsoleTable.js';

describe('hook_console_table', () => {
  it('validates schema', () => {
    const schema = zod.object(hookConsoleTable.schema);
    const result = schema.parse({});
    assert.strictEqual(result.enabled, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL with module not found

- [ ] **Step 3: Write implementation**

```typescript
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookConsoleTable = defineTool({
  name: 'hook_console_table',
  description:
    'Hook console.table：绕过通过 console.table 检测运行时间差的反调试',
  annotations: {
    title: 'Hook Console Table',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    enabled: zod
      .boolean()
      .optional()
      .default(true)
      .describe('是否启用'),
  },
  handler: async (
    request: {params: {enabled?: boolean}},
    response: Response,
    context: Context,
    runtime,
  ) => {
    const hookCode = `
(function() {
  'use strict';
  console.table = function() {};
  console.log('[hook_console_table] ✅ console.table neutralized (anti-time-difference-debug)');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ Console Table Hook 已安装');
      response.appendResponseLine('- console.table 已被置空，时间差检测将失效');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

- [ ] **Step 4: Run test**

Expected: PASS

---

### Task 3: hookLocationHref - 阻断页面跳转

**Files:**
- Create: `src/tools/hook/hookLocationHref.ts`

- [ ] **Step 1: Write implementation**

```typescript
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookLocationHref = defineTool({
  name: 'hook_location_href',
  description:
    'Hook location.href：阻断页面跳转，触发 debugger 以定位跳转代码位置',
  annotations: {
    title: 'Hook Location Href',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    triggerDebugger: zod
      .boolean()
      .optional()
      .default(true)
      .describe('跳转时是否触发 debugger 断点'),
  },
  handler: async (
    request: {params: {triggerDebugger?: boolean}},
    response: Response,
    context: Context,
    runtime,
  ) => {
    const triggerDebugger = request.params.triggerDebugger !== false;

    const hookCode = `
(function() {
  'use strict';
  window.onbeforeunload = function() {
    ${triggerDebugger ? 'debugger;' : ''}
    console.log('[hook_location_href] ⛔ Page navigation blocked');
    return false;
  };
  console.log('[hook_location_href] ✅ Navigation blocker installed');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ Location Href Hook 已安装');
      response.appendResponseLine('- 页面跳转将被阻断' + (triggerDebugger ? '，并触发 debugger 断点' : ''));
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

- [ ] **Step 2: Schema validation test**

```typescript
import assert from 'node:assert';
import {describe, it} from 'node:test';
import {zod} from '../../../src/third_party/index.js';
import {hookLocationHref} from '../../../src/tools/hook/hookLocationHref.js';

describe('hook_location_href', () => {
  it('validates schema', () => {
    const schema = zod.object(hookLocationHref.schema);
    const result = schema.parse({});
    assert.strictEqual(result.triggerDebugger, true);
  });
});
```

---

### Task 4: hookCookie - 监控 Cookie 读写

**Files:**
- Create: `src/tools/hook/hookCookie.ts`

- [ ] **Step 1: Write implementation**

```typescript
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookCookie = defineTool({
  name: 'hook_cookie',
  description:
    'Hook document.cookie：监控 Cookie 的读写操作，支持过滤特定 Cookie 名',
  annotations: {
    title: 'Hook Cookie',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    filterKeys: zod
      .array(zod.string())
      .optional()
      .describe('要监控的特定 Cookie 名称列表，为空则监控全部'),
    showStack: zod
      .boolean()
      .optional()
      .default(false)
      .describe('是否打印调用栈'),
    triggerDebugger: zod
      .boolean()
      .optional()
      .default(false)
      .describe('触发时是否暂停'),
  },
  handler: async (
    request: {
      params: {
        filterKeys?: string[];
        showStack?: boolean;
        triggerDebugger?: boolean;
      };
    },
    response: Response,
    context: Context,
    runtime,
  ) => {
    const {filterKeys, showStack, triggerDebugger} = request.params;
    const hasFilter = filterKeys && filterKeys.length > 0;

    const filterKeysJson = JSON.stringify(filterKeys || []);
    const showStackJson = JSON.stringify(!!showStack);
    const triggerDebuggerJson = JSON.stringify(!!triggerDebugger);

    const hookCode = `
(function() {
  'use strict';
  const filterKeys = ${filterKeysJson};
  const showStack = ${showStackJson};
  const triggerDebugger = ${triggerDebuggerJson};
  const hasFilter = filterKeys.length > 0;

  function parseCookieNames(cookieStr) {
    if (!cookieStr || typeof cookieStr !== 'string') return [];
    const attrs = ['expires', 'max-age', 'domain', 'path', 'secure', 'httponly', 'samesite', 'partitioned', 'priority'];
    return cookieStr.split(';').map(p => p.trim()).filter(p => p.includes('=')).map(p => {
      const [name] = p.split('=');
      return decodeURIComponent(name.trim());
    }).filter(name => !attrs.includes(name.toLowerCase()));
  }

  function logAndPause(msg) {
    console.log(msg);
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
  }

  const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  const originalGet = descriptor.get;
  const originalSet = descriptor.set;

  Object.defineProperty(document, 'cookie', {
    get: function() {
      return originalGet.call(document);
    },
    set: function(cookie) {
      if (!hasFilter) {
        logAndPause('设置cookie：\\n' + cookie);
      } else {
        const keys = parseCookieNames(cookie);
        if (keys.length > 0 && filterKeys.some(k => keys[0].includes(k))) {
          logAndPause('捕获到设置cookie ---> ' + keys[0] + '\\n值：' + cookie);
        }
      }
      return originalSet.call(document, cookie);
    }
  });
  console.log('[hook_cookie] ✅ Cookie hook installed' + (hasFilter ? ' (filter: ' + filterKeys.join(', ') + ')' : ' (all)'));
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ Cookie Hook 已安装');
      response.appendResponseLine(
        hasFilter
          ? `- 过滤 Cookie：${filterKeys!.join(', ')}`
          : '- 监控所有 Cookie 操作',
      );
      if (showStack) response.appendResponseLine('- 已启用调用栈打印');
      if (triggerDebugger) response.appendResponseLine('- 已启用 debugger 断点');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

---

### Task 5: hookXhrOpen - 监控 XHR 请求

**Files:**
- Create: `src/tools/hook/hookXhrOpen.ts`

- [ ] **Step 1: Write implementation**

```typescript
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookXhrOpen = defineTool({
  name: 'hook_xhr_open',
  description:
    'Hook XMLHttpRequest.open：监控 XHR 请求初始化，支持过滤特定 URL',
  annotations: {
    title: 'Hook XHR Open',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    filterUrls: zod
      .array(zod.string())
      .optional()
      .describe('要监控的特定 URL 列表，为空则监控全部'),
    showStack: zod.boolean().optional().default(false).describe('是否打印调用栈'),
    triggerDebugger: zod.boolean().optional().default(false).describe('触发时是否暂停'),
  },
  handler: async (
    request: {
      params: {filterUrls?: string[]; showStack?: boolean; triggerDebugger?: boolean};
    },
    response: Response,
    context: Context,
    runtime,
  ) => {
    const {filterUrls, showStack, triggerDebugger} = request.params;
    const hasFilter = filterUrls && filterUrls.length > 0;

    const hookCode = `
(function() {
  'use strict';
  const filterUrls = ${JSON.stringify(filterUrls || [])};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const hasFilter = filterUrls.length > 0;

  function logAndPause(msg) {
    console.log(msg);
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
  }

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function() {
    const method = arguments[0];
    const url = arguments[1];
    if (!hasFilter) {
      logAndPause('初始化xhr请求：method ---> ' + method + ', url ---> ' + url);
    } else if (url && filterUrls.some(item => url.includes(item))) {
      logAndPause('捕获到xhr请求 ---> url: ' + url + ' method: ' + method);
    }
    return origOpen.apply(this, arguments);
  };
  console.log('[hook_xhr_open] ✅ XHR open hook installed' + (hasFilter ? ' (filter: ' + filterUrls.join(', ') + ')' : ' (all)'));
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ XHR Open Hook 已安装');
      response.appendResponseLine(
        hasFilter
          ? `- 过滤 URL：${filterUrls!.join(', ')}`
          : '- 监控所有 XHR 请求初始化',
      );
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

---

### Task 6: hookXhrSetRequestHeader - 监控 XHR 请求头

**Files:**
- Create: `src/tools/hook/hookXhrSetRequestHeader.ts`

- [ ] **Step 1: Write implementation**

```typescript
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookXhrSetRequestHeader = defineTool({
  name: 'hook_xhr_set_request_header',
  description:
    'Hook XMLHttpRequest.setRequestHeader：监控请求头设置，支持过滤特定 Header 名',
  annotations: {
    title: 'Hook XHR Set Request Header',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    filterKeys: zod
      .array(zod.string())
      .optional()
      .describe('要监控的特定 Header 名称'),
    showStack: zod.boolean().optional().default(false).describe('是否打印调用栈'),
    triggerDebugger: zod.boolean().optional().default(false).describe('触发时是否暂停'),
  },
  handler: async (
    request: {
      params: {filterKeys?: string[]; showStack?: boolean; triggerDebugger?: boolean};
    },
    response: Response,
    context: Context,
    runtime,
  ) => {
    const {filterKeys, showStack, triggerDebugger} = request.params;
    const hasFilter = filterKeys && filterKeys.length > 0;

    const hookCode = `
(function() {
  'use strict';
  const filterKeys = ${JSON.stringify(filterKeys || [])};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const hasFilter = filterKeys.length > 0;

  function logAndPause(msg) {
    console.log(msg);
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
  }

  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function() {
    const header = arguments[0];
    const value = arguments[1];
    if (!hasFilter) {
      logAndPause('请求头设置：' + header + ': ' + value);
    } else if (header && filterKeys.some(item => header.includes(item))) {
      logAndPause('捕获到设置请求头 ---> ' + header + '\\n' + header + ': ' + value);
    }
    return origSetHeader.apply(this, arguments);
  };
  console.log('[hook_xhr_set_request_header] ✅ XHR setRequestHeader hook installed');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ XHR SetRequestHeader Hook 已安装');
      response.appendResponseLine(
        hasFilter
          ? `- 过滤 Header：${filterKeys!.join(', ')}`
          : '- 监控所有请求头设置',
      );
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

---

### Task 7: hookFetch - 监控 Fetch API

**Files:**
- Create: `src/tools/hook/hookFetch.ts`

- [ ] **Step 1: Write implementation**

```typescript
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookFetch = defineTool({
  name: 'hook_fetch',
  description: 'Hook window.fetch：监控 fetch API 调用，打印请求参数和堆栈',
  annotations: {
    title: 'Hook Fetch',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    showStack: zod.boolean().optional().default(false).describe('是否打印调用栈'),
    triggerDebugger: zod.boolean().optional().default(false).describe('触发时是否暂停'),
  },
  handler: async (
    request: {params: {showStack?: boolean; triggerDebugger?: boolean}},
    response: Response,
    context: Context,
    runtime,
  ) => {
    const {showStack, triggerDebugger} = request.params;

    const hookCode = `
(function() {
  'use strict';
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const origFetch = window.fetch;

  window.fetch = function() {
    console.log('捕获到fetch请求：');
    for (let i = 0; i < arguments.length; i++) {
      console.log(arguments[i]);
    }
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
    return origFetch.apply(this, arguments);
  };
  window.fetch.__proto__ = origFetch.__proto__;
  console.log('[hook_fetch] ✅ Fetch hook installed');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ Fetch Hook 已安装');
      response.appendResponseLine('- 所有 fetch 调用将被打印');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

---

### Task 8: hookJsonParse - 监控 JSON.parse

**Files:**
- Create: `src/tools/hook/hookJsonParse.ts`

- [ ] **Step 1: Write implementation**

```typescript
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookJsonParse = defineTool({
  name: 'hook_json_parse',
  description:
    'Hook JSON.parse：监控 JSON 解析操作，支持过滤特定字符串',
  annotations: {
    title: 'Hook JSON Parse',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    filterKeys: zod
      .array(zod.string())
      .optional()
      .describe('要过滤的特定 JSON 字符串内容'),
    showStack: zod.boolean().optional().default(false).describe('是否打印调用栈'),
    triggerDebugger: zod.boolean().optional().default(false).describe('触发时是否暂停'),
  },
  handler: async (
    request: {
      params: {filterKeys?: string[]; showStack?: boolean; triggerDebugger?: boolean};
    },
    response: Response,
    context: Context,
    runtime,
  ) => {
    const {filterKeys, showStack, triggerDebugger} = request.params;
    const hasFilter = filterKeys && filterKeys.length > 0;

    const hookCode = `
(function() {
  'use strict';
  const filterKeys = ${JSON.stringify(filterKeys || [])};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const hasFilter = filterKeys.length > 0;
  const origParse = JSON.parse;

  JSON.parse = function() {
    if (!hasFilter) {
      console.log('调用JSON.parse ---> ', arguments[0]);
    } else if (arguments[0] && typeof arguments[0] === 'string' && filterKeys.some(item => arguments[0].includes(item))) {
      console.log('捕获到JSON.parse指定字符串 ---> ', arguments[0]);
    } else {
      return origParse.apply(this, arguments);
    }
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
    return origParse.apply(this, arguments);
  };
  console.log('[hook_json_parse] ✅ JSON.parse hook installed');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ JSON Parse Hook 已安装');
      response.appendResponseLine(
        hasFilter
          ? `- 过滤字符串：${filterKeys!.join(', ')}`
          : '- 监控所有 JSON.parse 调用',
      );
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

---

### Task 9: hookJsonStringify - 监控 JSON.stringify

**Files:**
- Create: `src/tools/hook/hookJsonStringify.ts`

- [ ] **Step 1: Write implementation**

```typescript
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookJsonStringify = defineTool({
  name: 'hook_json_stringify',
  description:
    'Hook JSON.stringify：监控 JSON 序列化操作',
  annotations: {
    title: 'Hook JSON Stringify',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    showStack: zod.boolean().optional().default(false).describe('是否打印调用栈'),
    triggerDebugger: zod.boolean().optional().default(false).describe('触发时是否暂停'),
  },
  handler: async (
    request: {params: {showStack?: boolean; triggerDebugger?: boolean}},
    response: Response,
    context: Context,
    runtime,
  ) => {
    const {showStack, triggerDebugger} = request.params;

    const hookCode = `
(function() {
  'use strict';
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const origStringify = JSON.stringify;

  JSON.stringify = function() {
    console.log('调用JSON.stringify，参数：\\n', ...arguments);
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
    return origStringify.apply(this, arguments);
  };
  console.log('[hook_json_stringify] ✅ JSON.stringify hook installed');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ JSON Stringify Hook 已安装');
      response.appendResponseLine('- 所有 JSON.stringify 调用将被打印');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

---

### Task 10: hookPromise - 监控 Promise resolve

**Files:**
- Create: `src/tools/hook/hookPromise.ts`

- [ ] **Step 1: Write implementation**

```typescript
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookPromise = defineTool({
  name: 'hook_promise',
  description:
    'Hook Promise：监控 Promise resolve，打印 resolve 参数和调用栈，快速定位异步回调位置',
  annotations: {
    title: 'Hook Promise',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    showStack: zod.boolean().optional().default(false).describe('是否打印调用栈'),
    triggerDebugger: zod.boolean().optional().default(false).describe('触发时是否暂停'),
  },
  handler: async (
    request: {params: {showStack?: boolean; triggerDebugger?: boolean}},
    response: Response,
    context: Context,
    runtime,
  ) => {
    const {showStack, triggerDebugger} = request.params;

    const hookCode = `
(function() {
  'use strict';
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const __Promise = Promise;

  Promise = function Promise(callback) {
    if (!callback) {
      return new __Promise(callback);
    }
    const originCallback = callback;
    callback = function(resolve, reject) {
      const originResolve = resolve;
      resolve = function(result) {
        if (result && !(result instanceof Promise)) {
          console.groupCollapsed(result);
          console.trace();
          console.groupEnd();
          if (triggerDebugger) debugger;
          if (showStack) console.log(new Error().stack);
        }
        return originResolve.apply(this, arguments);
      };
      return originCallback(resolve, reject);
    };
    return new __Promise(callback);
  };
  Promise.prototype = __Promise.prototype;
  Object.defineProperties(Promise, Object.getOwnPropertyDescriptors(__Promise));
  console.log('[hook_promise] ✅ Promise hook installed');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ Promise Hook 已安装');
      response.appendResponseLine('- Promise resolve 参数将被打印到控制台');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

---

### Task 11: hookRandom - 固定 Math.random 返回值

**Files:**
- Create: `src/tools/hook/hookRandom.ts`

- [ ] **Step 1: Write implementation**

```typescript
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookRandom = defineTool({
  name: 'hook_random',
  description:
    'Hook Math.random：固定 Math.random 的返回值',
  annotations: {
    title: 'Hook Random',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    fixedValue: zod
      .number()
      .optional()
      .default(0)
      .describe('固定的返回值'),
    showStack: zod.boolean().optional().default(false).describe('是否打印调用栈'),
    triggerDebugger: zod.boolean().optional().default(false).describe('触发时是否暂停'),
  },
  handler: async (
    request: {
      params: {fixedValue?: number; showStack?: boolean; triggerDebugger?: boolean};
    },
    response: Response,
    context: Context,
    runtime,
  ) => {
    const {fixedValue, showStack, triggerDebugger} = request.params;

    const hookCode = `
(function() {
  'use strict';
  const fixedValue = ${fixedValue};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};

  Math.random = function() {
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
    return fixedValue;
  };
  console.log('[hook_random] ✅ Math.random fixed to ' + fixedValue);
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ Math.random Hook 已安装');
      response.appendResponseLine(`- 固定返回值：${fixedValue}`);
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

---

### Task 12: hookLocalStorage - 监控 LocalStorage 全部操作

**Files:**
- Create: `src/tools/hook/hookLocalStorage.ts`

- [ ] **Step 1: Write implementation**

```typescript
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookLocalStorage = defineTool({
  name: 'hook_local_storage',
  description:
    'Hook localStorage：监控 setItem/getItem/removeItem/clear 操作，支持过滤特定键',
  annotations: {
    title: 'Hook Local Storage',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    actions: zod
      .array(zod.enum(['setItem', 'getItem', 'removeItem', 'clear']))
      .optional()
      .describe('要监控的操作类型，默认全部'),
    filterKeys: zod
      .array(zod.string())
      .optional()
      .describe('要过滤的特定键名'),
    showStack: zod.boolean().optional().default(false).describe('是否打印调用栈'),
    triggerDebugger: zod.boolean().optional().default(false).describe('触发时是否暂停'),
  },
  handler: async (
    request: {
      params: {
        actions?: Array<'setItem' | 'getItem' | 'removeItem' | 'clear'>;
        filterKeys?: string[];
        showStack?: boolean;
        triggerDebugger?: boolean;
      };
    },
    response: Response,
    context: Context,
    runtime,
  ) => {
    const {actions, filterKeys, showStack, triggerDebugger} = request.params;
    const enabledActions = actions || ['setItem', 'getItem', 'removeItem', 'clear'];
    const hasFilter = filterKeys && filterKeys.length > 0;

    const hookCode = `
(function() {
  'use strict';
  const actions = ${JSON.stringify(enabledActions)};
  const filterKeys = ${JSON.stringify(filterKeys || [])};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const hasFilter = filterKeys.length > 0;

  function logAndPause(msg) {
    console.log(msg);
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
  }

  function matchesFilter(key) {
    if (!hasFilter) return true;
    return filterKeys.some(k => key.includes(k));
  }

  if (actions.includes('setItem')) {
    const orig = localStorage.setItem;
    localStorage.setItem = function(key, value) {
      if (!hasFilter || matchesFilter(key)) {
        logAndPause('设置localStorage，键 ---> ' + key + ' 值 ---> ' + value);
      }
      return orig.call(this, key, value);
    };
  }

  if (actions.includes('getItem')) {
    const orig = localStorage.getItem;
    localStorage.getItem = function(key) {
      if (!hasFilter || matchesFilter(key)) {
        logAndPause('读取localStorage，键 ---> ' + key);
      }
      return orig.call(this, key);
    };
  }

  if (actions.includes('removeItem')) {
    const orig = localStorage.removeItem;
    localStorage.removeItem = function(key) {
      if (!hasFilter || matchesFilter(key)) {
        logAndPause('移除localStorage，键 ---> ' + key);
      }
      return orig.call(this, key);
    };
  }

  if (actions.includes('clear')) {
    const orig = localStorage.clear;
    localStorage.clear = function() {
      logAndPause('清空localStorage');
      return orig.call(this);
    };
  }

  console.log('[hook_local_storage] ✅ LocalStorage hook installed (actions: ' + actions.join(', ') + ')');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ LocalStorage Hook 已安装');
      response.appendResponseLine(`- 监控操作：${enabledActions.join(', ')}`);
      if (hasFilter) {
        response.appendResponseLine(`- 过滤键：${filterKeys!.join(', ')}`);
      }
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

---

### Task 13: hookSessionStorage - 监控 SessionStorage 全部操作

**Files:**
- Create: `src/tools/hook/hookSessionStorage.ts`

- [ ] **Step 1: Write implementation**

```typescript
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookSessionStorage = defineTool({
  name: 'hook_session_storage',
  description:
    'Hook sessionStorage：监控 setItem/getItem/removeItem/clear 操作',
  annotations: {
    title: 'Hook Session Storage',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    actions: zod
      .array(zod.enum(['setItem', 'getItem', 'removeItem', 'clear']))
      .optional()
      .describe('要监控的操作类型，默认全部'),
    filterKeys: zod
      .array(zod.string())
      .optional()
      .describe('要过滤的特定键名'),
    showStack: zod.boolean().optional().default(false).describe('是否打印调用栈'),
    triggerDebugger: zod.boolean().optional().default(false).describe('触发时是否暂停'),
  },
  handler: async (
    request: {
      params: {
        actions?: Array<'setItem' | 'getItem' | 'removeItem' | 'clear'>;
        filterKeys?: string[];
        showStack?: boolean;
        triggerDebugger?: boolean;
      };
    },
    response: Response,
    context: Context,
    runtime,
  ) => {
    const {actions, filterKeys, showStack, triggerDebugger} = request.params;
    const enabledActions = actions || ['setItem', 'getItem', 'removeItem', 'clear'];
    const hasFilter = filterKeys && filterKeys.length > 0;

    const hookCode = `
(function() {
  'use strict';
  const actions = ${JSON.stringify(enabledActions)};
  const filterKeys = ${JSON.stringify(filterKeys || [])};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const hasFilter = filterKeys.length > 0;

  function logAndPause(msg) {
    console.log(msg);
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
  }

  function matchesFilter(key) {
    if (!hasFilter) return true;
    return filterKeys.some(k => key.includes(k));
  }

  if (actions.includes('setItem')) {
    const orig = sessionStorage.setItem;
    sessionStorage.setItem = function(key, value) {
      if (!hasFilter || matchesFilter(key)) {
        logAndPause('设置sessionStorage，键 ---> ' + key + ' 值 ---> ' + value);
      }
      return orig.call(this, key, value);
    };
  }

  if (actions.includes('getItem')) {
    const orig = sessionStorage.getItem;
    sessionStorage.getItem = function(key) {
      if (!hasFilter || matchesFilter(key)) {
        logAndPause('读取sessionStorage，键 ---> ' + key);
      }
      return orig.call(this, key);
    };
  }

  if (actions.includes('removeItem')) {
    const orig = sessionStorage.removeItem;
    sessionStorage.removeItem = function(key) {
      if (!hasFilter || matchesFilter(key)) {
        logAndPause('移除sessionStorage，键 ---> ' + key);
      }
      return orig.call(this, key);
    };
  }

  if (actions.includes('clear')) {
    const orig = sessionStorage.clear;
    sessionStorage.clear = function() {
      logAndPause('清空sessionStorage');
      return orig.call(this);
    };
  }

  console.log('[hook_session_storage] ✅ SessionStorage hook installed');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ SessionStorage Hook 已安装');
      response.appendResponseLine(`- 监控操作：${enabledActions.join(', ')}`);
      if (hasFilter) {
        response.appendResponseLine(`- 过滤键：${filterKeys!.join(', ')}`);
      }
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

---

### Task 14: antiAntiHook - 反 Hook 检测

**Files:**
- Create: `src/tools/hook/antiAntiHook.ts`

- [ ] **Step 1: Write implementation**

```typescript
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const antiAntiHook = defineTool({
  name: 'anti_anti_hook',
  description:
    '反 Hook 检测：保护 Function.prototype.toString，使被 Hook 的方法看起来像原生代码',
  annotations: {
    title: 'Anti-Anti-Hook',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    hookedMethods: zod
      .array(zod.string())
      .optional()
      .describe(
        '已被 Hook 的方法路径列表，如 ["console.table", "localStorage.setItem"]',
      ),
  },
  handler: async (
    request: {params: {hookedMethods?: string[]}},
    response: Response,
    context: Context,
    runtime,
  ) => {
    const hookedMethods = request.params.hookedMethods || [];

    const hookCode = `
(function() {
  'use strict';
  const hookedMethods = ${JSON.stringify(hookedMethods)};
  const hookedFunctions = new Map();

  // 尝试收集已被hook的函数引用
  for (let methodPath of hookedMethods) {
    let ref = window;
    let parts = methodPath.split('.');
    try {
      for (let i = 0; i < parts.length - 1; i++) {
        ref = ref[parts[i]];
        if (!ref) break;
      }
      if (ref) {
        const fn = ref[parts[parts.length - 1]];
        if (typeof fn === 'function') {
          hookedFunctions.set(fn, parts[parts.length - 1]);
        }
      }
    } catch (e) {}
  }

  const temp_toString = Function.prototype.toString;

  Function.prototype.toString = function() {
    if (this === Function.prototype.toString) {
      return 'function toString() { [native code] }';
    } else if (hookedFunctions.has(this)) {
      const funcName = hookedFunctions.get(this);
      return 'function ' + funcName + '() { [native code] }';
    }
    return temp_toString.apply(this, arguments);
  };

  // 保护 iframe 中的 Function.prototype.toString
  const propertyAccessor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  const getAccessor = propertyAccessor.get;

  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    get: function() {
      const iframeWindow = getAccessor.apply(this);
      return new Proxy(iframeWindow, {
        get(target, property) {
          if (property === 'Function') {
            const fn = Reflect.get(target, property, target);
            if (fn && fn.prototype) {
              fn.prototype.toString = Function.prototype.toString;
            }
            return fn;
          }
          const value = Reflect.get(target, property, target);
          if (typeof value === 'function') {
            return value.bind(target);
          }
          return value;
        }
      });
    }
  });

  console.log('[anti_anti_hook] ✅ Anti-hook detection protection installed' +
    (hookedMethods.length > 0 ? ' (' + hookedMethods.length + ' methods)' : ''));
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ Anti-Anti-Hook 已安装');
      response.appendResponseLine(
        hookedMethods.length > 0
          ? `- 保护方法数：${hookedMethods.length}`
          : '- 基础 Function.prototype.toString 保护已启用',
      );
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

---

### Task 15: 注册所有工具到 index.ts

**Files:**
- Modify: `src/tools/index.ts`

- [ ] **Step 1: Add imports and register all tools**

在 `src/tools/index.ts` 中：

1. 在 imports 区域添加：
```typescript
import {hookConsoleLog} from './hook/hookConsoleLog.js';
import {hookConsoleTable} from './hook/hookConsoleTable.js';
import {hookLocationHref} from './hook/hookLocationHref.js';
import {hookCookie} from './hook/hookCookie.js';
import {hookXhrOpen} from './hook/hookXhrOpen.js';
import {hookXhrSetRequestHeader} from './hook/hookXhrSetRequestHeader.js';
import {hookFetch} from './hook/hookFetch.js';
import {hookJsonParse} from './hook/hookJsonParse.js';
import {hookJsonStringify} from './hook/hookJsonStringify.js';
import {hookPromise} from './hook/hookPromise.js';
import {hookRandom} from './hook/hookRandom.js';
import {hookLocalStorage} from './hook/hookLocalStorage.js';
import {hookSessionStorage} from './hook/hookSessionStorage.js';
import {antiAntiHook} from './hook/antiAntiHook.js';
```

2. 在 `registry.registerMany([...])` 数组末尾添加：
```typescript
    // Hook 工具 (AntiDebug_Breaker 迁移)
    hookConsoleLog,
    hookConsoleTable,
    hookLocationHref,
    hookCookie,
    hookXhrOpen,
    hookXhrSetRequestHeader,
    hookFetch,
    hookJsonParse,
    hookJsonStringify,
    hookPromise,
    hookRandom,
    hookLocalStorage,
    hookSessionStorage,
    antiAntiHook,
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

---

## 验证清单

- [ ] `npm run build` 成功
- [ ] `npm test` 全部通过
- [ ] 14 个新工具全部注册到 `getToolRegistry().values()` 中
- [ ] 每个工具的 schema 验证通过（Zod）
- [ ] 每个工具的 handler 函数签名符合 `ToolDefinition` 接口
