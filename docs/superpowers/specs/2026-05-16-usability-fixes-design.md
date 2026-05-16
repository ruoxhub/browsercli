# JSReverser-CLI 使用问题修复设计

日期: 2026-05-16
状态: 已批准

## 概述

修复 js-reverse 在实际逆向工作流中暴露的 8 个使用问题，涵盖浏览器生命周期管理、Worker 状态检测、参数命名、文件参数、代码格式化、预加载 Hook、离线搜索、URL 参数分析。

## 修改分组

按依赖关系和风险等级分为 3 组，建议按顺序实施。

---

## 第一组：CLI 层改进（低风险）

### 问题 3：hook_fetch 参数命名歧义

**现状**: `url` 参数实际用 `url.includes(urlFilter)` 做子串匹配，但参数名暗示精确匹配。

**方案**:
1. `src/cli/tool-aliases.ts` 的 `TOOL_ALIASES` 中为 `hook_fetch` 添加 `urlPattern → url` 别名
2. `src/tools/hook/Fetch.ts:29` 更新 schema description 为 `'URL 子串过滤 — 只 hook URL 包含此字符串的 fetch 请求（子串匹配，非精确匹配）'`

**影响范围**: 零破坏性，纯文档/别名变更。

### 问题 4：--file 支持 JS 文件 + --stdin 模式

**现状**: `src/cli/commands/shared/tool-args.ts:52-59` 的 `readArgsFromFile` 只做 `JSON.parse`，`.js` 文件直接报错。

**方案**:
1. `readArgsFromFile` 检测文件扩展名：
   - `.json` → 保持原有 JSON.parse 行为
   - `.js`/`.mjs`/`.ts` → 读取文件内容作为 `{ function: fileContent }` 返回（适用于 evaluate_script）
2. `tool-dispatcher.ts` 的 help 文本补充 `--stdin` 说明
3. `buildToolArgs` 函数开头增加 stdin 检测：当 `parsed.flags['stdin']` 为 true 且 `!process.stdin.isTTY` 时，从 stdin 读取 JSON 并作为最低优先级参数源

**影响范围**: `tool-args.ts` 和 `tool-dispatcher.ts`，不影响 Worker 端。

---

## 第二组：工具层增强（中等风险）

### 问题 5：get_script_source 增加 prettyPrint

**现状**: `src/tools/debugger/index.ts:536` 的 `getScriptSource` 工具无格式化能力，但 `PackerDeobfuscator.beautify()` 已存在。

**方案**:
1. schema 增加 `prettyPrint?: boolean`，description: `'是否对返回的源码进行格式化（适用于压缩文件）'`
2. handler 中当 `prettyPrint === true` 时，对 source 调用格式化：
   - 优先使用 `PackerDeobfuscator.beautify(source)`（`src/modules/deobfuscator/PackerDeobfuscator.ts:235`）
   - 该方法内部使用 AST 解析 + 重新生成，对压缩代码效果好
3. 格式化失败时 fallback 返回原始源码 + warning

**影响范围**: `src/tools/debugger/index.ts`，新增对 `PackerDeobfuscator` 的导入。

### 问题 6：inject_preload_script 增加 preset + new_page 增加 preloadHook

**现状**: `inject_preload_script`（`src/tools/script/script.ts:426`）只接受原始 script 字符串，无预设模板。`new_page`（`src/tools/navigation/newPage.ts`）无预加载 hook 参数。

**方案**:

A) `inject_preload_script` 增加 `preset` 参数：
```typescript
preset: zod.enum([
  'capture-all-fetch',
  'capture-all-xhr', 
  'capture-all-requests',
  'log-cookies',
]).optional().describe('预设 hook 模板，与 script 参数互斥')
```
- 内置模板定义在 `src/tools/script/preload-presets.ts`（新文件）
- 当 `preset` 有值时忽略 `script` 参数，使用预设模板

B) `new_page` 增加 `preloadHook` 参数：
```typescript
preloadHook: zod.string().optional().describe('在页面加载前注入的 hook 脚本')
preloadPreset: zod.enum([...]).optional().describe('预设 hook 模板')
```
- 在 `context.newPage()` 之后、`page.goto()` 之前调用 `page.addInitScript(hookCode)`

**影响范围**: `script.ts`、`newPage.ts`，新建 `preload-presets.ts`。

### 问题 7：search_in_sources 接入 CodeCache 离线搜索

**现状**: `search_in_sources`（`src/tools/debugger/index.ts:690`）只走 `debuggerContext.searchInScripts()`，需要活跃 CDP 会话。`CodeCache`（`src/modules/collector/CodeCache.ts`）有本地文件缓存但未被 search 工具使用。

**方案**:
1. schema 增加 `source?: 'live' | 'cache' | 'auto'`，默认 `'auto'`
2. handler 逻辑：
   - `'live'` → 只走 CDP（当前行为）
   - `'cache'` → 只走 CodeCache 本地搜索
   - `'auto'` → 先尝试 CDP，失败（无活跃会话）时 fallback 到 CodeCache
3. CodeCache 搜索实现：遍历缓存目录中的 `.js` 文件，逐文件做字符串/正则匹配
4. 返回结果格式与 CDP 搜索保持一致（scriptId 用文件路径替代）

**影响范围**: `src/tools/debugger/index.ts`，新增对 `CodeCache` 的导入和搜索方法。可能需要在 `CodeCache` 类中新增 `searchInCache(query, options)` 方法。

### 问题 8：新增 analyze_url_params 工具

**现状**: 不存在该工具。

**方案**:
1. 新建 `src/tools/hook/AnalyzeUrlParams.ts`
2. 工具名: `analyze_url_params`
3. 功能: 注入 hook 拦截 `URL` 构造函数和 `URLSearchParams`，记录所有 URL 构建过程
4. schema:
```typescript
{
  urlFilter: zod.string().optional().describe('只捕获包含此字符串的 URL'),
  captureStack: zod.boolean().optional().describe('是否记录调用栈'),
}
```
5. 注入的 hook 代码：
   - Proxy `new URL()` 构造函数
   - Proxy `URLSearchParams.prototype.append/set/delete`
   - 记录到 `window.__hookStore.analyze_url_params`
6. 返回格式: `{ params: [{url, searchParams: {key: value}, stack?}] }`
7. 在 `src/cli/tools-meta.ts` 注册

**影响范围**: 新文件 `src/tools/hook/AnalyzeUrlParams.ts`，修改 `tools-meta.ts`。

---

## 第三组：浏览器生命周期（较高风险）

### 问题 1：双模式浏览器管理

**现状**: `browser.ts` 已有 `launchBrowser()` 私有方法（第 763 行）和 `connectToRemoteBrowser()` 私有方法（第 549 行），但没有暴露为工具。`start` 命令只接受 `--browserUrl` 外部连接模式。

**方案**:

A) 新增 `launch_browser` 工具（`src/tools/browser/LaunchBrowser.ts`）：
```typescript
schema: {
  headless: zod.boolean().optional().default(false),
  executablePath: zod.string().optional(),
  channel: zod.enum(['chrome', 'msedge', 'chromium']).optional(),
}
```
- 调用 `BrowserModeManager.ensureBrowser()` 或直接调用已有的 `launchBrowser()` 逻辑
- 返回 `{ browserUrl, wsEndpoint, pid }`

B) 新增 `close_browser` 工具（`src/tools/browser/CloseBrowser.ts`）：
- 关闭当前管理的浏览器实例
- 清理相关状态

C) `start` 命令增加 `--auto-launch` flag：
- 不传 `--browserUrl` 时自动使用内置 Playwright 启动 Chromium
- 保持 `--browserUrl` 外部连接模式完全兼容
- 优先级: `--browserUrl` > `--wsEndpoint` > `--auto-launch`（默认）

**影响范围**: 新建 `src/tools/browser/LaunchBrowser.ts`、`CloseBrowser.ts`，修改 `start.ts`。

### 问题 2：PID 文件误报修复

**现状**: `worker-manager.ts:130` 的 `isRunning()` 读 PID 文件后未验证进程是否真实存活。

**方案**:
1. `isRunning()` 方法中，读取 PID 后用 `process.kill(pid, 0)` 探活（信号 0 不杀进程，只检查是否存在）
2. Windows 兼容: 使用 `tasklist /FI "PID eq ${pid}"` 或 try-catch `process.kill(pid, 0)`
3. 进程不存在时自动清理 PID 文件并返回 `false`
4. 增加 PID 文件写入时间戳，超过 24h 的 PID 文件视为过期

**影响范围**: `src/cli/worker-manager.ts` 的 `isRunning()` 和 `getPid()` 方法。

---

## 文件变更清单

| 文件 | 变更类型 | 涉及问题 |
|------|---------|---------|
| `src/cli/tool-aliases.ts` | 修改 | #3 |
| `src/tools/hook/Fetch.ts` | 修改 | #3 |
| `src/cli/commands/shared/tool-args.ts` | 修改 | #4 |
| `src/cli/commands/tool-dispatcher.ts` | 修改 | #4 |
| `src/tools/debugger/index.ts` | 修改 | #5, #7 |
| `src/tools/script/script.ts` | 修改 | #6 |
| `src/tools/script/preload-presets.ts` | 新建 | #6 |
| `src/tools/navigation/newPage.ts` | 修改 | #6 |
| `src/tools/hook/AnalyzeUrlParams.ts` | 新建 | #8 |
| `src/cli/tools-meta.ts` | 修改 | #8 |
| `src/tools/browser/LaunchBrowser.ts` | 新建 | #1 |
| `src/tools/browser/CloseBrowser.ts` | 新建 | #1 |
| `src/cli/commands/start.ts` | 修改 | #1 |
| `src/cli/worker-manager.ts` | 修改 | #2 |

## 实施顺序

1. 第一组（问题 3、4）→ 独立 PR，零风险
2. 第二组（问题 5、6、7、8）→ 可拆为 2 个 PR（5+7 一个，6+8 一个）
3. 第三组（问题 1、2）→ 独立 PR，需要集成测试

## 测试策略

- 第一组: 手动验证别名解析 + `--file test.js` 能正确传参
- 第二组: 对每个新工具/参数编写单元测试，验证 happy path + error path
- 第三组: 集成测试 — 验证 `js-reverse start`（无 --browserUrl）能自动启动浏览器并连接
