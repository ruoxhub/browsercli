# AntiDebug_Breaker 工具迁移设计文档

> **状态：** 已审核 · **日期：** 2026-04-10

## 背景

将 Chrome 扩展 AntiDebug_Breaker（30+ JS hook 脚本）中的工具全部迁移到 JSReverser-MCP 项目，作为独立的 MCP tools。

## 重叠分析

AntiDebug_Breaker 的 30 个脚本中，13 个功能已在当前项目中存在：

| AntiDebug_Breaker 脚本 | 当前项目工具 |
|---|---|
| `Bypass_Debugger.js` | `bypassDebugger.ts` |
| `Fixed_window_size.js` | `antiAntiDebug.ts` (fixedWindowSize) |
| `Hook_Date_now.js` / `hook_performance_now.js` | `antiAntiDebug.ts` (fixedTime) |
| `hook_close.js` | `antiAntiDebug.ts` (preventClose) |
| `hook_history.js` | `antiAntiDebug.ts` (preventHistoryBack) |
| `hook_clear.js` | `antiAntiDebug.ts` (preventConsoleClear) |
| `Hook_CryptoJS.js` | `hookCryptoJS.ts` |
| `Hook_JSEncrypt.js` | `hookJSEncrypt.ts` |
| `Hook_SMcrypto.js` | `hookSMCrypto.ts` |
| `Get_Vue_0.js` | `getVueRoutes.ts` |
| `Get_Vue_1.js` | `clearVueGuards.ts` |
| `Clear_vue_Navigation_Guards.js` | `clearVueGuards.ts` |
| `detectorExec.js` | `activateVueDevtools.ts` |

## 需要新增的 17 个工具

### 反调试类（2 个）

| # | 工具名 | 源脚本 | 功能 |
|---|---|---|---|
| 1 | `hook_console_table` | `hook_table.js` | 绕过时间差检测反调试，置空 console.table |
| 2 | `hook_location_href` | `location_href.js` | 阻断页面跳转，触发 debugger 定位跳转代码 |

### Hook 类（14 个）

| # | 工具名 | 源脚本 | 功能 |
|---|---|---|---|
| 3 | `hook_console_log` | `hook_log.js` + `hook_log v0.2.js` | 防止重写 console.log 等方法 |
| 4 | `hook_cookie` | `Hook_cookie.js` | 监控 document.cookie 读写 |
| 5 | `hook_xhr_open` | `hook_xhr_open.js` | 监控 XHR 请求初始化 |
| 6 | `hook_xhr_set_request_header` | `hook_xhr_setRequestHeader.js` | 监控 XHR 请求头设置 |
| 7 | `hook_fetch` | `hook_fetch.js` | 监控 fetch API 调用 |
| 8 | `hook_json_parse` | `hook_json_parse.js` | 监控 JSON.parse |
| 9 | `hook_json_stringify` | `hook_json_stringify.js` | 监控 JSON.stringify |
| 10 | `hook_promise` | `hook_Promise.js` | 监控 Promise resolve |
| 11 | `hook_random` | `hook_random.js` | 固定 Math.random 返回值 |
| 12 | `hook_local_storage` | `hook_localStorage_*.js` (4 合并为 1) | 监控 localStorage 全部操作 |
| 13 | `hook_session_storage` | `hook_sessionStorage_*.js` (4 合并为 1) | 监控 sessionStorage 全部操作 |

### 安全保护类（1 个）

| # | 工具名 | 源脚本 | 功能 |
|---|---|---|---|
| 14 | `anti_anti_hook` | `AntiAnti_Hook.js` | 反 Hook 检测，保护 Function.prototype.toString |

## 架构设计

### 文件结构

```
src/tools/
├── hook/                          # 新增目录
│   ├── hookConsoleLog.ts          # hook_log + hook_log v0.2
│   ├── hookConsoleTable.ts        # hook_table
│   ├── hookLocationHref.ts        # location_href
│   ├── hookCookie.ts              # Hook_cookie
│   ├── hookXhrOpen.ts             # hook_xhr_open
│   ├── hookXhrSetRequestHeader.ts # hook_xhr_setRequestHeader
│   ├── hookFetch.ts               # hook_fetch
│   ├── hookJsonParse.ts           # hook_json_parse
│   ├── hookJsonStringify.ts       # hook_json_stringify
│   ├── hookPromise.ts             # hook_Promise
│   ├── hookRandom.ts              # hook_random
│   ├── hookLocalStorage.ts        # 4 脚本合并
│   ├── hookSessionStorage.ts      # 4 脚本合并
│   └── antiAntiHook.ts            # AntiAnti_Hook
└── index.ts                       # 更新导入和注册
```

### 统一参数设计

所有 hook 工具共享以下参数模式：

```typescript
// 所有工具通用
schema: {
  showStack: zod.boolean().optional().default(false)
    .describe('是否打印调用栈'),
  triggerDebugger: zod.boolean().optional().default(false)
    .describe('触发时是否暂停（debugger）'),
}

// 带过滤器的工具额外参数
filterKeys: zod.array(zod.string()).optional()
  .describe('过滤键列表，只捕获匹配的键'),

// 固定值工具额外参数
fixedValue: zod.number().optional().default(0)
  .describe('固定返回值'),

// localStorage/sessionStorage 合并工具的 actions 参数
actions: zod.array(zod.enum(['setItem', 'getItem', 'removeItem', 'clear']))
  .optional().describe('要监控的操作类型，默认全部')
```

### 每个工具的实现模式

```typescript
// 1. 用 defineTool 定义
// 2. Zod schema 定义参数
// 3. 根据参数生成 hookCode 字符串
// 4. context.getSelectedFrame().evaluate(hookCode) 注入
// 5. response.appendResponseLine() 返回结果
```

### Hook JS 代码模式

所有注入的 hook 代码遵循统一结构：
- 立即执行函数 `(function(){ ... })()`
- `'use strict'` 模式
- 保存原始方法引用
- 覆写方法并调用原始方法
- console.log 输出标识信息
