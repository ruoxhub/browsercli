# 浏览器运行时基础能力设计

> 状态：已批准 · 日期：2026-08-12 · 浏览器框架：Patchright · 交付方式：一个总设计、三阶段实施 · 参考方式：Clean-room 行为重写

## 1. 摘要

本设计补齐四类相互关联的浏览器运行时能力：

1. Target 级脚本观测：新增 `list_targets` 与 `dump_target_scripts(targetId)`，覆盖 page、iframe、Worker、SharedWorker 和 Service Worker 等 Target。
2. 稳定页面身份：为现有页面返回值增加进程生命周期内稳定的 `pageId`，并让所有真正选择浏览器页面的入口同时接受 `pageId` 与原有索引。
3. Context 级持久 Hook：将 `persistent=true` 的注册归属从单个 Page 提升到当前 `BrowserContext`，覆盖未来创建的页面和文档。
4. CDP 容错与测试补强：集中处理 Target/Session 映射、失败回滚、并发合并、失效对象、脚本去重和可恢复提示。

实现继续使用 Patchright，不切换或混用 Puppeteer。Target 临时会话的兼容复杂度被封装在一个只读深模块中，不改变默认浏览器启动、Cloak、CDP 懒激活或零 JS 注入策略。

交付分为三个阶段：

- 阶段 1：Target 观测与 CDP 容错。
- 阶段 2：稳定 `pageId`。
- 阶段 3：Context 级持久 Hook。

测试和错误处理随各阶段一同交付，不作为第四套平行模块。

## 2. 背景与问题

### 2.1 当前 Worker 脚本收集存在观测盲区

`src/modules/collector/PageScriptCollector.ts` 当前主要通过两种方式收集 Worker 脚本：

- 枚举 Service Worker 注册项后 fetch 主脚本。
- 在运行时替换 `window.Worker` 后记录新创建的 Worker。

这种方式无法可靠覆盖：

- 工具注入前已经创建的 Worker。
- blob URL Worker。
- SharedWorker。
- Worker 内部动态加载或 import 的脚本。
- 无法由页面上下文直接 fetch 的真实已解析源码。

Chromium 的 Target 与 Debugger 协议能够从实际运行 Target 获取 `scriptParsed` 记录及源码，因此适合作为显式、按需、只读的补充观测面。

### 2.2 `pageIdx` 不是稳定身份

`src/worker/context/BrowserContextProvider.ts` 和 `src/tools/navigation/listPages.ts` 以 `context.pages()` 当前顺序作为页面标识。页面关闭、新标签插入或数组重排后，同一个索引可能指向另一个页面。

当前 `_tabContext.pageId` 只是 `String(tabIndex)`，并非稳定 ID。这既可能误导调用方，也无法用于安全地连续操作同一个页面。

### 2.3 持久 Hook 只注册到当前 Page

`src/tools/hook/InjectHook.ts` 在 `persistent=true` 时调用选中 Page 的 `addInitScript()`，因此只覆盖该 Page 的后续文档，不能覆盖以后通过 `context.newPage()` 创建的页面。

同文件的模块级 Map 还存在以下问题：

- 注册表不按 BrowserContext 隔离。
- 注释提到并不存在的 `remove_persistent_hook`。
- `inject_preload_script` 已经存在另一条 Context/Page `addInitScript` 路径，生命周期不统一。
- `HookHeartbeat` 另行监听导航并重复 evaluate，但没有生产调用方。

### 2.4 CDP 容错场景分散且覆盖不足

现有 `CDPErrorMapper` 已能识别 Session、Target、Context、超时和连接错误，但缺少 Target 枚举/附加场景的恢复提示。现有测试也未覆盖临时子会话的失败回滚、并发 attach、脚本回放、Target 消失和来源去重。

## 3. 目标

- 在不更换浏览器框架的前提下，显式列出 Chromium Target。
- 对任意受支持 Target 创建临时只读会话，抓取当前已解析且尚未回收的脚本源码。
- 工具调用结束后释放所有临时 CDP 资源。
- 复用 `CodeFile` 及现有数量、单文件和总响应限制。
- 为 Page 提供进程内稳定、单调、不复用的 `pageId`。
- 保持所有现有 `pageIdx` 输入和响应字段兼容。
- 将持久 Hook 注册到当前 BrowserContext，并对现存 Frame 做一次即时回填。
- 统一 `inject_hook`、`inject_preload_script` 与 `list_persistent_hooks` 的注册表视图。
- 给常见 CDP 失败附加明确、可执行的恢复提示。
- 以真实 Chromium 集成测试证明 Worker 观测和 Context 级 Hook 的关键行为。

## 4. 非目标

本设计明确不包含：

- 切换到 Puppeteer，或在同一进程混用 Puppeteer 与 Patchright。
- 新增第三方依赖。
- 建立持久自动附加或全浏览器 Target 监听框架。
- 默认发送 `Target.setAutoAttach`。
- 在浏览器启动期间 eager-enable `Debugger`、`Runtime` 或 `Console`。
- 对 Worker Target 持久注入 Hook。
- 让 `dump_target_scripts` 自动运行或自动并入 `collect_code`。
- 跨 worker 进程、浏览器重启或多个 BrowserContext 复用 `pageId`。
- 页面别名系统。
- 运行时撤销已经通过 `BrowserContext.addInitScript()` 注册的单个 Hook。
- 伪装 Hook 覆盖或删除成功。
- 真正的 isolated-world 持久 Hook。
- 隐式启用 `StealthScripts2025` 或任何额外 JS stealth 注入。
- 复制或逐行改写 jshookmcp 的 AGPL 源码、类型或测试。

## 5. 关键决策

### 5.1 保留 Patchright

Puppeteer 的 Target/CDPSession 公共接口更直接，但全量切换会影响现有 Patchright/Cloak 反检测基础；混用则会形成两套 Page、BrowserContext 和 Session 生命周期。

稳定 `pageId` 与 Context 级 Hook 也不会因 Puppeteer 获得额外收益。因此，本设计选择：

- 保留 Patchright 作为唯一浏览器控制框架。
- 使用 Patchright 公共的 browser-level `CDPSession`。
- 将非 flat Target 消息路由封装在内部实现中。
- 不访问 Patchright 私有连接对象。
- 为未来切换到 flat 会话或上游新增公共接口保留单一替换点。

### 5.2 一个总设计，三个阶段实施

四项能力共享浏览器生命周期、错误语义和测试基础，但并非同一职责。采用一个总设计可以固定兼容契约，分阶段实施则能让每个高风险变化拥有独立验收门槛。

### 5.3 持久 Hook 随 BrowserContext 生命周期存在

当前锁定的 Patchright 1.59.4 中，`BrowserContext.addInitScript()` 返回可调用
`dispose()` 的内部句柄。注册表可以保留该句柄用于生命周期清理，但不把它放进工具响应，
也不因此增加公开的单 Hook 删除工具。批准的产品语义是：

- 注册成功后持续到当前 BrowserContext 关闭。
- Context 关闭或重建后彻底清除。
- 不提供运行时删除工具；内部句柄不得被工具或列表响应暴露。
- 相同 ID 不允许用不同脚本覆盖。

### 5.4 `pageId` 覆盖全部真实页面选择入口

所有真正用于选择浏览器 Page 的入口都接受稳定 `pageId`，同时保留现有索引。结果分页字段仍保持原语义，不把所有名为 `pageIdx` 的参数误判为页面选择器。

### 5.5 Target dump 直接返回受限 `CodeFile[]`

工具直接返回脚本元数据和受限源码，沿用既有截断与总量保护。不默认写入 artifacts，也不返回无限制完整源码。

## 6. 总体架构

```text
list_targets / dump_target_scripts
  -> BrowserTargetInspector
     -> operation-scoped browser CDP session
        -> temporary target session router

list_pages / select_page / network page selectors
  -> BrowserContextProvider.resolvePage()
     -> internal PageIdentityRegistry state

inject_hook / inject_preload_script / list_persistent_hooks
  -> PersistentHookRegistry
     -> BrowserContext.addInitScript()
     -> best-effort existing-frame backfill when requested
```

### 6.1 模块及职责

| 模块                     | 建议位置                                        | Interface                                                     | 隐藏的 Implementation                                               |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `BrowserTargetInspector` | `src/modules/browser/BrowserTargetInspector.ts` | `listTargets()`、`dumpScripts(targetId)`                      | 根 Session、子会话路由、消息 ID、事件分发、超时、去重、限额、detach |
| 页面身份状态             | `BrowserContextProvider` 内部                   | `getPageId(page)`、`resolvePage(selector)`、现有 `getPages()` | WeakMap/Map、对账、关闭清理、单调 ID                                |
| `PersistentHookRegistry` | `src/modules/hook/PersistentHookRegistry.ts`    | `register()`、`list()`                                        | Context 隔离、哈希、幂等、冲突、回填、关闭清理                      |
| 工具 adapter             | `src/tools/*`                                   | MCP schema 与结构化响应                                       | 参数转换和错误格式化，不持有生命周期状态                            |

### 6.2 所有权

- `BrowserTargetInspector` 由 `ToolContextProvider` 懒创建，构造时只接收 Browser resolver。它可以保留同 Target 的 in-flight Promise，但不长期持有 CDP Session。
- 页面身份继续归 `BrowserContextProvider`，不建立第二个 Tab 管理器。
- `PersistentHookRegistry` 由共享的 Hook 运行时门面持有，使两个注入工具看到同一注册表。
- 工具不直接操作 sessionId Map、Page WeakMap 或 Context Hook Map。

### 6.3 复用现有能力

- `CodeFile` 数据模型。
- `CollectedFileRegistry` 的默认数量与大小限制；Target dump 使用调用级状态，不写入 `CodeCollector` 的全局 URL 缓存。
- `CDPErrorMapper` 与 `ToolError`。
- `BrowserContextProvider` 页面同步逻辑。
- `HookManager` 现有运行时归属。
- ToolRegistry、domain manifest 和结构化响应管线。

## 7. Target 级脚本观测

### 7.1 受支持范围

`list_targets` 返回 `Target.getTargets` 提供的全部 Target。以下脚本型 Target 默认标记 `canDumpScripts=true`：

- `page`
- `iframe`
- `worker`
- `shared_worker`
- `service_worker`

其他类型仍可观察，但不能调用 dump。若 Chromium 版本返回新的 Target type，默认 `canDumpScripts=false`，待显式验证后再加入 allowlist。

Firefox 不支持此 Chromium CDP 能力，工具返回结构化“不支持”错误，不做 fetch 或 Page 枚举降级。

### 7.2 `list_targets` 契约

输入无必填参数。返回：

```typescript
interface TargetSummary {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  browserContextId?: string;
  openerId?: string;
  canDumpScripts: boolean;
}

interface ListTargetsResult {
  targets: TargetSummary[];
}
```

工具属性：

- domain：`collector`
- profile：沿用 `collector` 的 `workflow`
- `readOnlyHint: true`
- 不要求选中 Page，但要求已连接 Chromium Browser

### 7.3 `dump_target_scripts` 契约

输入：

```typescript
interface DumpTargetScriptsParams {
  targetId: string;
}
```

返回：

```typescript
interface ScriptFailure {
  scriptId: string;
  url: string;
  reason: string;
  recoverable: boolean;
}

interface DumpTargetScriptsResult {
  target: TargetSummary;
  scripts: CodeFile[];
  failures: ScriptFailure[];
  stats: {
    observed: number;
    returned: number;
    duplicates: number;
    failed: number;
    truncated: number;
    omitted: number;
    originalBytes: number;
    returnedBytes: number;
  };
  partial: boolean;
  warnings: string[];
}
```

`partial=true` 表示至少一个脚本失败、被截断或因响应限制省略。只要 Target attach、Debugger 启用和至少一次有效观测完成，单个脚本失败不把整个调用改成失败。

`originalBytes` 与 `returnedBytes` 只统计实际尝试读取的源码；未因限额进入读取队列的脚本只计入 `omitted`，不虚构其原始大小。

### 7.4 临时会话时序

一次 dump 严格遵循：

1. 创建 browser-level `CDPSession`。
2. 执行 `Target.getTargets`，确认 `targetId` 仍存在且 `canDumpScripts=true`。
3. 注册根 Session 的 `Target.receivedMessageFromTarget` 与 detach 监听。
4. 调用 `Target.attachToTarget({targetId, flatten:false})`。
5. 建立 `sessionId -> targetId` 与 `targetId -> sessionId` 双向映射。
6. 在子会话路由中先注册 `Debugger.scriptParsed` listener。
7. 发送 `Debugger.enable`；收集其回放的已知、尚未回收脚本。
8. 经过短暂、有上限的事件稳定窗口后冻结脚本清单。
9. 以受限并发发送 `Debugger.getScriptSource`。
10. 转换、去重、截断并生成结果。
11. best-effort 发送 `Debugger.disable`。
12. 在 `finally` 中调用 `Target.detachFromTarget({sessionId})`。
13. 调用根 `CDPSession.detach()`。

任何 attach 之后的失败都必须进入步骤 12 和 13。cleanup 失败只追加 warning，不覆盖更早的主错误。

### 7.5 内部非 flat 消息路由

Patchright 公共 `CDPSession.send()` 无法给 flat 子会话命令添加顶层 `sessionId`。首期使用 CDP 仍支持的非 flat 命令，并把兼容风险限制在 `BrowserTargetInspector` 的内部实现：

```text
Target.attachToTarget(flatten:false)
Target.sendMessageToTarget({sessionId, message: JSON-RPC payload})
Target.receivedMessageFromTarget
Target.detachFromTarget({sessionId})
```

内部路由至少维护：

- 单调消息 ID。
- `messageId -> Promise resolver/rejecter`。
- `sessionId -> targetId` 与反向 Map。
- `sessionId + eventName -> listeners`。
- 每条命令的有界 timeout。
- 子会话 detach 时对所有 pending 命令统一失败。

该路由不是公共模块，不向工具层暴露通用 CDP send。未来 Patchright 暴露正式 flat 子会话接口时，只替换内部实现，工具契约不变。

### 7.6 快照边界

`dump_target_scripts` 是一次性快照，不是后台监听器：

- `Debugger.enable` 前注册 listener，避免丢失回放事件。
- `Debugger.enable` 完成后等待一个短暂 idle window，并设置总等待上限。
- 窗口结束后冻结待读取的 `scriptParsed` 列表。
- 后续新解析脚本不加入本次结果；调用方需要再次 dump。
- 不发送 `Target.setAutoAttach`，不监听未来 Target。

### 7.7 `CodeFile` 映射

不扩展 `CodeFile.type` union，按 Target 类型和 URL 使用现有值：

- `service_worker` -> `service-worker`
- `worker` / `shared_worker` -> `web-worker`
- page / iframe 且 URL 非空 -> `external`
- page / iframe 且 URL 为空 -> `dynamic`

无 URL 脚本使用稳定于本次 Target 生命周期的合成 URL：

```text
target://<targetId>/script/<scriptId>
```

metadata 至少包含：

```typescript
{
  source: 'target-debugger';
  targetId: string;
  targetType: string;
  scriptIds: string[];
  cdpHash?: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  sourceMapURL?: string;
  truncated?: boolean;
  originalSize?: number;
  truncatedSize?: number;
}
```

`size` 和大小统计一律使用 UTF-8 字节数，而不是 JavaScript 字符数。

### 7.8 去重与限额

默认限额与现有 collector 对齐：

- 最多返回 200 个文件。
- 单文件最多 200 KiB。
- 所有源码总响应最多 512 KiB。

去重键为“有效 URL + CDP hash”。缺少 CDP hash 时，在获取源码后使用 Node 标准库计算 SHA-256。相同 URL、不同内容不得合并；同一内容的多个 scriptId 合并进 `metadata.scriptIds`。

源码读取使用受限并发调度器，不对所有脚本执行无界 `Promise.all`。达到数量或总响应上限后停止调度新的源码读取，并增加 `stats.omitted`。

Target dump 使用调用级去重和限制状态，不写入 `CodeCollector` 的共享 `collectedFilesCache` 或 URL 集合，避免一次 Target 快照影响普通 `collect_code`。

### 7.9 并发与生命周期

- 同一 `targetId` 的并发 dump 共享一个 in-flight Promise。
- 不同 Target 可以独立执行。
- Promise 完成或失败后立即删除 in-flight 记录。
- 不复用已经 detach 的 sessionId。
- 根 Session 关闭时，所有子命令立即失败并清空路由状态。
- 即使 `TargetInfo.attached=true`，也使用独立临时 Session，不借用未知所有者的 Session。

## 8. 稳定页面 ID

### 8.1 ID 语义

`pageId` 格式为进程内单调编号：

```text
page-1
page-2
page-3
```

保证：

- 同一个 Patchright `Page` 对象在数组重排后 ID 不变。
- 页面关闭后 ID 失效。
- ID 永不复用。
- BrowserContext/worker 重建后不保证保留。
- ID 不包含 URL、标题、索引或其他可变信息。

### 8.2 内部状态

状态直接收敛到 `BrowserContextProvider`：

```typescript
WeakMap<Page, string>; // Page -> pageId
Map<string, Page>; // pageId -> 当前有效 Page
number; // nextPageId
```

不移植完整 TabRegistry，不提供别名、持久化或跨进程对账。

### 8.3 页面对账

`getPages()`、`syncPages()`、`newPage()` 和 `setPages()` 经过统一 reconcile：

1. 读取当前可见 Page 集合。
2. 为没有 ID 的 Page 分配新 ID。
3. 从反向 Map 删除已关闭或不再属于当前 Context 的 Page。
4. 不降低单调计数器，不复用清理出的 ID。
5. 按现有规则修复失效的 selected Page。

Page 的 `close` 事件可做即时清理，但 reconcile 仍是最终事实来源，避免事件丢失导致脏状态。

### 8.4 统一解析 interface

```typescript
interface PageSelector {
  pageId?: string;
  pageIdx?: number;
  fallbackToSelected?: boolean;
}

interface ResolvedPage {
  page: Page;
  pageId: string;
  pageIdx: number;
}

resolvePage(selector: PageSelector): ResolvedPage;
```

规则：

- 只传 `pageId`：按稳定 ID 解析。
- 只传 `pageIdx`：保持当前索引行为。
- 两者都传：必须指向同一个 Page，否则拒绝执行。
- 两者都不传：只有原本允许当前活动页的入口才设置 `fallbackToSelected=true`。
- 已关闭 ID：提示重新调用 `list_pages`。
- 未知 ID、越界索引和选择器冲突使用不同错误信息。

现有 `getPageByIdx()` 保留并委托 `resolvePage()`，避免旧调用方同时维护另一套边界检查。

### 8.5 工具契约

#### `list_pages`

每个条目新增 `pageId`，并新增 `selectedPageId`：

```typescript
{
  pageInfos: Array<{
    index: number;
    pageId: string;
    url: string;
    title: string;
  }>;
  selectedIndex: number;
  selectedPageId: string | null;
}
```

保留现有 `index` 与 `selectedIndex`。

#### `new_page`

返回新增页面的 `pageId`，保留 `index`。

#### `select_page`

输入的 `pageId`、`pageIdx` 均为可选，但至少提供一个。返回：

```typescript
{
  selectedPageId: string;
  selectedIndex: number;
  url: string;
  title: string;
}
```

#### `list_network_requests`

新增 `targetPageId`，与现有 `targetPageIdx` 配对。原有 `pageIdx` 始终只表示结果分页页码。

响应保留 `targetPageIdx`，同时新增最终解析出的 `targetPageId`。

#### `clear_network_requests`

新增 `targetPageId`，并在响应中同时返回 `targetPageId` 和 `targetPageIdx`。

#### `_tabContext`

`ToolContextProvider.getContextMeta()` 返回真实稳定 ID，不再使用 `String(tabIndex)`。

### 8.6 实际影响面

当前代码中大量 `pageIdx` 表示结果分页，而不是浏览器页面。实施时只修改真实页面选择入口：

- `select_page.pageIdx`
- `list_network_requests.targetPageIdx`
- `clear_network_requests.targetPageIdx`
- 相关 Context/Network 内部解析

console 与 WebSocket 工具的分页 `pageIdx` 不增加 `pageId`，也不改变语义。

## 9. Context 级持久 Hook

### 9.1 生命周期语义

`persistent=true` 的作用域是当前 BrowserContext：

- 覆盖该 Context 的未来新页面和未来新文档。
- 注册时可对当前 Context 已存在的 Page/Frame 做一次即时回填。
- Context 关闭或重建后清除。
- 不跨 worker 进程。
- 不支持单条运行时删除。

### 9.2 注册表状态

```typescript
interface PersistentHookEntry {
  hookId: string;
  scriptHash: string;
  scriptSize: number;
  scriptPreview: string;
  registeredAt: number;
  source: 'inject_hook' | 'inject_preload_script';
  requestedWorld: 'main' | 'isolated';
  effectiveWorld: 'main';
  applyMode: 'existing-and-future' | 'future-only';
}

WeakMap<BrowserContext, Map<string, PersistentHookEntry>>;
```

`scriptSize` 使用 UTF-8 字节数，`scriptPreview` 最多保留 200 个字符。注册表不保留第二份完整脚本；幂等比较使用完整 SHA-256。不得在响应中返回无限制脚本内容。

### 9.3 `register` interface

```typescript
interface RegisterPersistentHookRequest {
  context: BrowserContext;
  hookId: string;
  script: string;
  source: PersistentHookEntry['source'];
  requestedWorld: PersistentHookEntry['requestedWorld'];
  applyMode: PersistentHookEntry['applyMode'];
}

interface RegisterPersistentHookResult {
  entry: PersistentHookEntry;
  registered: boolean;
  idempotent: boolean;
  appliedFrames: number;
  failedFrames: Array<{pageId?: string; frameUrl: string; reason: string}>;
  partial: boolean;
  warnings: string[];
}
```

### 9.4 注册时序

`existing-and-future` 模式严格按以下顺序：

1. 验证 BrowserContext 存在且未关闭。
2. 计算脚本 SHA-256。
3. 检查当前 Context 下相同 hookId。
4. 调用 `BrowserContext.addInitScript(script)`。
5. 成功后写入注册表。
6. 枚举当前 Context 的 Page 和 Frame，逐个 best-effort evaluate。
7. 汇总回填结果。

先注册 init script、后回填现有 Frame，可以缩小注册期间新文档漏注入的窗口。

`future-only` 模式在步骤 5 后结束，不回填当前 Frame。

### 9.5 重复与冲突

- 相同 Context、相同 hookId、相同脚本哈希：幂等返回，不再次 `addInitScript`，不再次回填。
- 相同 Context、相同 hookId、不同脚本哈希：拒绝，提示使用新 hookId 或重建 Context。
- 不同 hookId：允许，即使脚本内容相同。
- 不同 BrowserContext：完全隔离。

注册必须按 `(BrowserContext, hookId)` 串行化：同一 ID 的并发同脚本请求合并为一个 in-flight
Promise，不得重复调用 `addInitScript`；并发不同脚本必须在产生浏览器副作用前拒绝。
绝不实现“set 覆盖 Map 但旧脚本仍在运行”的伪更新。

### 9.6 回填语义

- 回填目标是注册时快照中的所有未关闭 Page 的所有 Frame。
- 单 Frame 失败不回滚已经注册的 init script。
- Frame detach、导航竞态和 Context 关闭映射为 `failedFrames` 或可恢复错误；失败项只返回
  `frameUrl` 与 `reason`，不让注册表额外依赖页面身份模块。
- `partial=true` 表示至少一个 Frame 回填失败。
- 不额外包裹用户脚本，不伪造全局幂等标记。
- 导航竞态下存在极小概率同一文档同时被 init script 和回填执行；持久 Hook 脚本必须自行保证幂等。

### 9.7 工具调整

#### `inject_hook`

- `persistent=false`：保持只 evaluate 当前选中 Frame。
- `persistent=true`：要求当前 BrowserContext，使用 `existing-and-future`。
- `addInitScript` 失败时整个持久注册失败，不降级成单次 evaluate。
- `world='isolated'` 继续接受，但返回 `effectiveWorld='main'` 与 warning。

#### `inject_preload_script`

- 委托同一个注册表。
- 使用 `future-only`。
- 脚本哈希生成稳定的内部 registration ID，例如 `preload-<sha256>`。
- 重复提交同一脚本幂等。
- 不再维护 Context/Page 两级隐式降级；没有 BrowserContext 时明确失败。

#### `list_persistent_hooks`

- 只列出当前 BrowserContext 的注册项。
- 返回 `source`、哈希、大小、注册时间、作用模式与 world。
- 每项返回 `removable:false`。
- 响应说明关闭或重建 BrowserContext 才能清除。
- 删除关于不存在的 `remove_persistent_hook` 的文档和注释。

### 9.8 `HookHeartbeat`

实施前再次进行生产调用方检查。确认仍无生产调用后：

- 删除 `src/modules/hook/HookHeartbeat.ts`。
- 删除其专属单元测试。
- 不把导航监听、debounce、timer 或重复 evaluate 接入新注册表。

Context 原生 init script 已覆盖所需的未来文档生命周期，保留 Heartbeat 只会产生平行状态和重复执行。

## 10. 错误模型与恢复提示

### 10.1 扩展现有 mapper

继续使用 `CDPErrorMapper` 与 `ToolError`，不建立新错误体系。映射后的 context 可以增加：

```typescript
{
  originalMessage: string;
  recoveryHint?: string;
  targetId?: string;
  sessionId?: string;
}
```

不修改既有必填字段；新字段均为可选。

### 10.2 分类

| 场景                        | 行为                     | 恢复提示                                   |
| --------------------------- | ------------------------ | ------------------------------------------ |
| Target 已关闭或 ID 不存在   | 调用失败，可恢复         | 重新执行 `list_targets` 并使用新 targetId  |
| Session 已关闭/分离         | 调用失败，可恢复         | 重新执行完整 dump，不复用 sessionId        |
| Browser 连接关闭            | 调用失败，可恢复         | 重新连接或启动浏览器                       |
| Target type 不支持 Debugger | 校验失败                 | 选择 `canDumpScripts=true` 的 Target       |
| attach 被权限或协议拒绝     | 调用失败，不自动循环重试 | 检查浏览器通道、远程调试权限与 Target 类型 |
| 单个 scriptId 已回收/不存在 | 记录 `ScriptFailure`     | 重新 dump 可能获得新的 scriptId            |
| Frame 导航或分离            | Hook 回填部分失败        | Hook 对未来文档仍有效；必要时刷新后验证    |
| cleanup 失败                | warning                  | 根 Session 关闭作为第二层清理              |

`Target not found` 这类瞬时错误必须保持可恢复语义，不能仅因使用 `NOT_FOUND` code 而被默认标成不可恢复。

恢复提示必须对 HTTP/proxycli 调用方可见：除写入 `ToolError.context.recoveryHint` 外，
映射后的稳定 `Error.message` 必须包含短提示。本阶段不扩展传输 DTO，避免提示只留在 worker
内部 context。

### 10.3 重试规则

- 模块内部不做无限重试。
- Target 枚举和 attach 之间的竞态不透明重试，以免意外附加到调用方没有选择的新 Target。
- 单个脚本读取失败不重试整个 dump。
- 调用方依据 `recoveryHint` 决定重新 list/dump。

## 11. 分阶段实施

### 11.1 阶段 1：Target 观测与 CDP 容错

交付：

- `BrowserTargetInspector`
- 内部临时 Target 消息路由
- `list_targets`
- `dump_target_scripts`
- `CDPErrorMapper` 补充
- collector manifest 注册

进入下一阶段的门槛：真实 Chromium 集成测试证明可以抓取工具调用前已经创建的 Worker 脚本。

### 11.2 阶段 2：稳定 `pageId`

交付：

- `BrowserContextProvider` 内部页面身份状态
- `resolvePage`
- navigation/network 工具兼容升级
- `_tabContext` 修正
- 浏览器断开时清空 Context、selected Page、反向 pageId 映射；`BrowserConnectionManager`
  必须纳入实现和测试。

进入下一阶段的门槛：所有旧索引测试保持通过，新测试证明页面重排不改变 ID、关闭后 ID 不复用。

### 11.3 阶段 3：Context 级持久 Hook

交付：

- `PersistentHookRegistry`
- 三个现有工具统一生命周期
- 移除闲置 `HookHeartbeat`

完成门槛：真实 Chromium 验证当前页面即时生效、未来新页面继承、Context 重建后清除。

## 12. 测试设计

### 12.1 Target 单元测试

- `Target.getTargets` 结果映射和 `canDumpScripts` allowlist。
- attach 成功后建立双向映射。
- attach 成功、路由初始化失败时执行 detach 回滚。
- 同 Target 并发 dump 合并。
- 不同 Target 不错误合并。
- `Debugger.enable` 回放 `scriptParsed`。
- `getScriptSource` 成功、协议错误和脚本回收。
- URL/hash 去重；同 URL 不同 hash 保留。
- 无 URL 合成标识。
- 文件数量、单文件、总响应限制。
- detach 失败保留主错误并写 warning。
- 根 Session 关闭使 pending 命令失败。
- 命令日志断言不发送 `Target.setAutoAttach`、`Runtime.enable` 或 `Console.enable`。
- Firefox/非 Chromium 返回不支持。

### 12.2 Target Chromium 集成测试

使用本地测试服务器和临时 BrowserContext，至少覆盖：

- 工具调用前创建的普通 Worker。
- blob URL Worker。
- Worker 内部加载的第二段脚本。
- SharedWorker。
- Service Worker 主脚本。
- Target 在 dump 中途关闭。

测试只验证独立构造的 fixture，不复用 jshookmcp 测试代码。

### 12.3 页面身份测试

- 首次对账分配 ID。
- 重复对账保持 ID。
- 页面数组重排保持 ID。
- 页面关闭清理反向 Map。
- 新页面不复用旧 ID。
- 只用 pageId、只用 pageIdx 的解析。
- 双选择器一致时成功、冲突时失败。
- 省略选择器时只在允许的入口回退到 selected Page。
- `list_pages`、`new_page`、`select_page` 新旧字段。
- network 的分页 `pageIdx` 与 `targetPageId/targetPageIdx` 不混淆。
- `_tabContext.pageId` 在索引变化后保持不变。

### 12.4 持久 Hook 单元测试

- `addInitScript` 发生在现有 Frame 回填之前。
- `future-only` 不回填。
- 多 Page、多 Frame 回填。
- 单 Frame 失败返回 partial。
- 同 ID 同脚本幂等。
- 同 ID 不同脚本拒绝。
- 不同 Context 隔离。
- Context 关闭后条目不可见。
- `addInitScript` 失败不登记且不降级。
- preload registration ID 稳定。
- isolated 请求返回 main world warning。
- list 返回 `removable:false`。

### 12.5 持久 Hook Chromium 集成测试

- 当前已打开页面即时执行。
- 注册后的刷新自动执行。
- 注册后创建的新页面自动执行。
- iframe 新文档自动执行。
- Context 关闭并新建后不继承旧注册。

### 12.6 最终检查

每个阶段在最后一次代码修改后运行对应最小测试。完整交付运行：

```text
npm run typecheck
npm run test:unit
npm run test:integration
npm run check-format
```

不得以修改前的通过结果代替最终 diff 验证。

## 13. 安全、反检测与许可证

### 13.1 反检测约束

- `list_targets` 和 `dump_target_scripts` 只在显式调用时创建 CDP Session。
- `Debugger.enable` 只在选定 Target 上短暂启用，并在 finally 中关闭。
- 不在 BrowserManager 启动路径中增加 CDP 域激活。
- 不发送 `Runtime.enable` 或 `Console.enable`。
- 不默认注入 JavaScript。
- Context Hook 注入仅由用户显式调用 `inject_hook` 或 `inject_preload_script` 触发。
- 不改变 viewport、启动参数、profile 目录或 Cloak 隔离。

### 13.2 输入与资源限制

- `targetId` 只传给 CDP，不拼接 shell、路径或 URL。
- 脚本响应受数量和字节限制。
- 所有命令和事件稳定窗口都有 timeout。
- 所有 listener、pending Promise 和 Session 在 finally 中释放。
- 工具不把页面 Cookie、Storage 或脚本自动写盘。

### 13.3 Clean-room

- jshookmcp 仅用于确认外部行为、边界和测试场景。
- 实现人员依据本规格、当前项目接口和 Chromium/Patchright 协议类型独立编码。
- 不复制外部 `BrowserTargetSessionManager`、`TabRegistry`、flat session helper 或测试 fixture。
- 新源码保持当前项目 Apache-2.0 license header。

## 14. 兼容性

- 所有现有 MCP 工具名保持不变。
- 所有现有 `pageIdx`、`targetPageIdx`、`index`、`selectedIndex` 响应字段保留。
- 新的页面身份字段为增量字段。
- 旧客户端无需理解 `pageId` 即可继续工作。
- Target 工具是新增能力，不改变 `collect_code` 默认行为。
- `persistent=false` 的 `inject_hook` 保持现有单次 evaluate 行为。
- `persistent=true` 不再静默降级为单次执行，这是有意的正确性收紧。
- `inject_preload_script` 从隐式 Context/Page fallback 收敛为明确的 Context 生命周期。
- `inject_hook` 保留现有 `hookId`、`persisted`、`ranOnCurrentFrame`、`world`、
  `persistentStrategy` 字段；`list_persistent_hooks` 保留 ISO `registeredAt` 与 `world`，
  新字段只做增量添加。
- 删除 `HookHeartbeat` 不影响公开工具，因为它没有生产调用方。

## 15. 风险与缓解

| 风险                                                         | 影响                               | 缓解                                                                                       |
| ------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| 非 flat `Target.sendMessageToTarget` 已被 CDP 标记为未来弃用 | 上游 Chromium 最终可能移除         | 完全封装在单一内部实现；加入真实 Chromium smoke test；不泄漏到工具 interface               |
| `Debugger.enable` 是可观测协议行为                           | 强反爬场景可能检测                 | 只在显式 dump 时短暂启用；默认路径不激活；文档提示调用代价                                 |
| 页面关闭事件丢失                                             | 反向 pageId Map 可能暂时残留       | 所有读取前 reconcile；关闭 listener 只是加速清理                                           |
| Hook 注册与 Frame 回填竞态                                   | 极小概率重复执行                   | 先注册 init script；按 Context+hookId 串行化；明确要求持久 Hook 自身幂等；结果报告 partial |
| Context init script 无单条删除                               | 伪删除会导致状态与真实浏览器不一致 | 生命周期固定为 Context；不提供 remove/overwrite                                            |
| Target 脚本数量巨大                                          | 内存或 MCP 响应失控                | 有界并发、文件数、单文件和总字节限制                                                       |
| URL 去重误伤动态版本                                         | 同 URL 不同脚本丢失                | 去重键加入 CDP hash/SHA-256                                                                |

## 16. 验收标准

### 16.1 Target 观测

- `list_targets` 能列出当前 Chromium 中的 page、Worker、SharedWorker 和 Service Worker Target；
  iframe 仅在其实际形成 `Target.getTargets` 条目的 OOPIF 场景断言，不把同进程 iframe 误当作独立 Target。
- `dump_target_scripts` 能获取调用前已创建 Worker 的已解析源码。
- 工具结束后没有遗留 Target 子会话或根 Session listener。
- 单脚本失败产生 partial 结果，不丢失其他脚本。
- 输出严格遵守 200 文件、200 KiB 单文件、512 KiB 总源码上限。
- 默认浏览器启动路径不增加任何 CDP 激活。

### 16.2 页面身份

- 同一 Page 在数组重排后 `pageId` 不变。
- 页面关闭后旧 ID 不再解析，新页面不复用旧 ID。
- 所有真实浏览器页面选择入口支持 `pageId` 和旧索引。
- 双选择器冲突时拒绝执行。
- 旧索引调用和旧响应字段保持兼容。

### 16.3 持久 Hook

- 持久 Hook 对当前 Context 的现存 Frame 尽力即时生效。
- 未来导航和新页面继承 Hook。
- 相同 ID 同脚本幂等（包括并发请求），相同 ID 不同脚本拒绝且不产生第二次浏览器注册。
- Context 重建后旧 Hook 消失。
- 工具和文档不再宣称支持运行时删除。
- `HookHeartbeat` 在确认无生产调用后删除。

### 16.4 项目约束

- 不新增依赖。
- 不引入 Puppeteer。
- 不访问 Patchright 私有 API。
- 不复制 AGPL 源码或测试。
- `npm run typecheck`、`npm run test:unit`、`npm run test:integration`、`npm run check-format` 在最终 diff 上通过。

## 17. 后续工作边界

本设计批准后只授权编写实施计划，不自动授权以下扩展：

- flat CDP WebSocket 客户端。
- Target 自动附加与持续观测。
- Worker 持久 Hook。
- pageId 别名或跨重启持久化。
- 可撤销 Hook bootloader。
- Puppeteer 迁移。

这些能力如出现真实需求，必须重新进行差距分析和设计审批。
