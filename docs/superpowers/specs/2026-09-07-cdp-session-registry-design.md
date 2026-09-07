# CDP Session Registry（per-agent 会话隔离）设计

日期：2026-09-07
状态：已评审通过设计方向，待实现
范围决策：方案 A——注册表 + 身份贯通，**不含**并发执行改造（daemon 维持现有全局互斥串行）

## 1. 问题与目标

多个 agent（独立 OS 进程）通过 proxycli 连到同一 workspace daemon 时，共享同一
BrowserManager / BrowserContext / `selectedPage`，且约 30 处 `newCDPSession(page)`
散点各自建销会话。已观察到的三类症状：

1. **CDP 域状态互相污染**——两个 agent 共享同一 `DebuggerManager` / `CdpNetworkMonitor`
   的 session，A 下的断点 B 命中、A 开启的域泄漏给 B；
2. **页面被抢占**——全局单值 `selectedPage`，A 选页后 B 的操作打在 A 的页上；
3. **性能与 session 泄漏**——同 agent 重复 attachToTarget 往返；异常路径 detach 失败后
   session 堆积无人回收。

成功标准（验收口径）：

- 同一 agent 对同一 page 的多次工具调用只创建一个 CDP session（可用 mock 计数断言）；
- 不同 agent 对同一 page 各持有独立 session，域 enable / `session.on` 互不可见；
- agent 连接断开或 session 空闲超时后，其全部 CDP session 被 detach（无泄漏）；
- 两个 agent 分别 `selectPage` 后各自 `getSelectedPage()` 返回自己的页；
- 单 agent（现状唯一用户）行为不变：`agentId` 缺省 `"default"`，`npm run test:unit` 全绿。

非目标（明确不做）：

- 不做并发工具执行（`rejectIfBusy` / `WORKER_BUSY` 不动）；
- 不隔离 cookie / 登录态 / UA（那是 per-browser-context 共享，属未来方案 C 的领地）;
- 不引入租借/归还（acquire/release）协议——归属制无需租约。

## 2. 背景事实（调研结论，含证据）

- daemon 按 workspace hash 单例，所有 CLI 进程连同一 daemon
  （`src/ipc/registry.ts:80-97`、`src/cli/app.ts:45-64`）。
- daemon 内单 `ToolContextProvider` + 单 `ToolAdapter`（`src/ipc/daemonServer.ts:43-55`），
  浏览器走 `BrowserManager` 全局单例（`src/modules/browser/browser.ts:250-260`）。
- IPC 帧无调用方身份：`{id, method, params}`（`src/ipc/daemonServer.ts:189-195`）；
  `executeTool(meta, params, sessionId)` 的第 3 参是 **daemon 自己的 session 名**
  （`src/ipc/daemonServer.ts:441`），不是 agent 身份。
- `selectedPage/selectedFrame` 为全局单值（`src/worker/context/BrowserContextProvider.ts:47,205`）。
- `src/modules/browser/SessionManager.ts` 整类（含 `cdpSessions` WeakMap 缓存三方法）
  全仓零调用，页面标签机制无外部调用者——死代码。
- `src/modules/session/CaptureSessionManager.ts` 是抓包会话状态机，与浏览器 CDP 无关，不在本次范围。
- 长生命周期持有者：`DebuggerContextProvider`（per-page WeakMap，两 agent 共享一个
  `DebuggerManager` 是断点互扰根因）、`CdpNetworkMonitor`、`CodeCollector`、`WasmCollector`、
  `worker/collectors.ts`。
- 临时散点：`tools/input/*`、`tools/emulation/*`、`tools/stealth`、`tools/dom/WaitForHelper`、
  `tools/performance/*`、`modules/v8-inspector/*`、`modules/collector/*`、`modules/debugger/*`
  等约 30 处 `newCDPSession + finally detach()`。
- 测试惯例：手写鸭子 mock CDPSession（`send/on/off/detach`），参考
  `tests/unit/modules/collector/CdpNetworkMonitor.test.ts:15-54`。

## 3. 架构

```
CLI 进程启动 → agentId = env PROXYCLI_AGENT_ID ?? randomUUID()（进程内稳定）
  ↓ 每个 IPC 请求帧携带 agentId
daemonServer.dispatch → runJob 透传 → ToolAdapter.executeTool(meta, params, { agentId })
  ↓ pipeline 执行前
ToolContextProvider.setActiveAgent(agentId)
  ↓ 工具 handler 通过 context 访问
CdpSessionRegistry：key (agentId, page) → 专属 CDPSession（懒建 get-or-create）
BrowserContextProvider：selectedPage/selectedFrame → Map<agentId, {page, frame}>
```

核心决策：**归属注册表而非资源池**。不设计租借协议的原因是调用方（工具 handler）
是短生命周期的，真正需要隔离粒度的是 agent×page；registry 把生命周期从"每次调用"
提升到"agent 对 page 的占有期"，复用与隔离同时达成。

### 3.1 组件

| 组件 | 文件 | 职责 | 依赖 |
|---|---|---|---|
| CdpSessionRegistry | `src/modules/browser/CdpSessionRegistry.ts`（新） | (agentId, page) → CDPSession 的创建、缓存、失效、记账 | patchright Page/CDPSession |
| agentId 贯通 | `src/cli/`（入口约 5 行）+ `src/ipc/daemonServer.ts` + `src/worker/ToolAdapter.ts` | 请求帧携带身份 → activeAgent | — |
| per-agent 页面选择 | `src/worker/context/BrowserContextProvider.ts` | selectedPage/Frame 按 agentId 路由 | activeAgent |
| 长生命周期持有者改造 | `DebuggerContextProvider`、`CdpNetworkMonitor`、`CodeCollector`、`WasmCollector`、`collectors.ts` | 从 registry 取 session，不再自建 | registry |
| 临时散点收敛 | ~30 处调用点 | `context.getCdpSession(page)` 替换 `newCDPSession + finally detach` | registry |

### 3.2 CdpSessionRegistry 接口

```ts
export interface CdpSessionRegistry {
  /** get-or-create；命中缓存时刷新 lastUsedAt。 */
  getOrCreate(agentId: string, page: Page): Promise<CDPSession>;
  /** 显式失效并 detach 某 (agentId, page) 的 session（如 debugger dispose）。 */
  release(agentId: string, page: Page): Promise<void>;
  /** detach 某 agent 的全部 session（连接断开 / agent 退出）。 */
  closeAgent(agentId: string): Promise<void>;
  /** daemon shutdown：detach 全部并停定时器。 */
  closeAll(): Promise<void>;
}
```

实现要点：

- 内部 `Map<string, Map<Page, Entry>>`，外层键 agentId，内层用 `Map`（Page 为对象键，
  需要可迭代以支持 TTL 扫描；ponytail 注释说明）。
- 每个 Entry 挂 `page.on('close', ...)`：page 关闭时删条目并 best-effort detach。
- `lastUsedAt` + 空闲 TTL：60s 间隔 `unref()` 定时器扫描，detach 并删除空闲
  **超过 5 分钟**的 session。防 agent 进程被 kill 后孤儿 session 堆积。
- detach 失败一律 `catch(() => undefined)` + debug log，沿用现有惯例。
- `getOrCreate` 并发安全：同 (agentId, page) 的在途创建共享同一 Promise（简单
  pending map），避免双 attach。
- registry 是 daemon 进程内单例，挂在 `ToolContextProvider`（或 ServiceLocator）上，
  与 `BrowserManager` 生命周期对齐：`setBrowserManager`/断连时 `closeAll()`。

> `ponytail:` TTL 单定时器 + 全局扫描，颗粒度足够 daemon 单浏览器规模；若未来做
> per-agent 并发执行，再升级为引用计数。

### 3.3 agentId 贯通

- **CLI**：进程入口 `const agentId = process.env.PROXYCLI_AGENT_ID ?? randomUUID()`，
  存入进程级常量；同一逻辑 agent 跨多 CLI 进程共享会话 = 显式设置该环境变量。
- **IPC 帧**：请求消息加可选顶层字段 `agentId?: string`（`src/ipc/types` 或等价位置）。
  缺省（Web 控制台、MCP 直连、旧客户端）→ daemon 侧按 `"default"` 处理，行为与现状一致。
- **daemon**：`dispatch` 读出 `agentId` → 随 job 上下文传入 `runJob` →
  `executeTool(meta, params, { sessionId: deps.sessionName, agentId })`。
  `executeTool` 第 3 参改为 options 对象 `{ sessionId?: string; agentId?: string }`
  （调用方仅 daemonServer 与 ConsoleServer，同步改）。
- **worker**：`ToolContextProvider` 新增 `setActiveAgent/clearActiveAgent/get activeAgent`；
  `executeTool` 在 pipeline 执行前 set、finally clear（与现有 activeSession 同模式）。
  执行仍全局串行，故 activeAgent 单值是安全的——这是不做并发改造的直接收益。

### 3.4 per-agent 页面选择

`BrowserContextProvider`：

- `selectedPage: Page | null` → `selections: Map<string, { page: Page | null; frame: Frame | null }>`；
- `getSelectedPage()/setSelectedPage()/getSelectedFrame()/setSelectedFrame()` 签名不变，
  内部按 `activeAgent() ?? 'default'` 读写对应条目；
- agent 断连（`closeAgent`）时删除其条目；条目内 page 已 close 时视为 null（惰性自愈）；
- `default` agent 条目 = 现状全局行为，单 agent 用户零感知。

诚实边界：cookie/登录态/UA 仍 per-context 共享。registry 以 page 为键，未来多
context（方案 C）时接口不变。

### 3.5 长生命周期持有者改造

| 持有者 | 现状 | 改为 |
|---|---|---|
| `DebuggerContextProvider` | `WeakMap<Page, DebuggerManager>` 全局共享 | `Map<agentId, Map<Page, DebuggerManager>>`；`dispose(page)` 同步清 registry |
| `CdpNetworkMonitor` | attach 时自建 session + `Network.enable` | 构造入参接收 registry 提供的 session；detach 语义改为 release |
| `CodeCollector` / `WasmCollector` / `collectors.ts` | per-call `newCDPSession` + WeakMap | `registry.getOrCreate(activeAgent, page)` |

事件监听器归属规则（解决域污染的关键）：监听器注册在**该 agent 自己的 session** 上，
天然隔离；`release/closeAgent` 时随 session detach 一并失效，无需逐一 off。

### 3.6 临时散点收敛

~30 处 `const client = await page.context().newCDPSession(page); try {...} finally { client.detach() }`
统一替换为 `const client = await context.getCdpSession(page)`（`ToolContextProvider` 上的
门面方法，内部即 `registry.getOrCreate(this.activeAgent ?? 'default', page)`），删除
finally detach。涉及 `tools/input/*`、`tools/emulation/*`、`tools/stealth`、
`tools/dom/WaitForHelper`、`tools/performance/*`、`tools/navigation/navigatePage`、
`modules/collector/Page*`、`modules/debugger/evaluateInPageRuntime` 等。

例外保留（不走 registry）：

- `BrowserTargetInspector` 的 root session（`Target.attachToTarget` 自建拓扑，
  经 `TargetSessionRouter`，生命周期独立于 page session）；
- `DevToolsConnectionAdapter`（DevTools 前端连接，非工具调用路径）；
- `browser.ts:537`（启动期探测，早于任何 agent 身份存在）。

`v8-inspector/*` 的 `createCDPSession(From)` 工厂保留原样（模块独立可复用），但
worker 工具路径上的调用改走 registry——即 JITInspector 等类的 `getPage` 注入点不变，
由调用方传入 registry 包装的 session。若改动侵入过深，v8-inspector 内部单例缓存
（对象内 get-or-create）视为已满足隔离要求（这些对象本身 per-tool-call 创建），
只删外层散点不重构内部。**实现时取后者：v8-inspector 内部不动。**

### 3.7 死代码清理

- 删除 `src/modules/browser/SessionManager.ts` 与 `src/modules/browser/index.ts`
  中其导出、`src/modules/browser/browser.ts:47` 的 `@see` 引用。
- `src/utils/ToolExecutionScheduler.ts`（零调用）不在本次范围，不删。

## 4. 错误处理

- `getOrCreate` 建 session 失败（page 已关/target crashed）：透传错误，不缓存失败态；
- TTL/断连清理时 detach 失败：log debug，条目照删（浏览器侧随连接回收兜底）；
- `activeAgent` 未 set（非工具路径，如 WsHub 广播）：按 `"default"` 回退；
- 旧帧无 `agentId`：同上，等价现状。

## 5. 测试

单元（`node:test`，镜像目录）：

1. `tests/unit/modules/browser/CdpSessionRegistry.test.ts` —— mock session 工厂
   （仿 CdpNetworkMonitor.test.ts）：
   - 同 agent 同 page 两次 getOrCreate → `newCDPSession` 仅调用 1 次，返回同一对象；
   - 不同 agent 同 page → 各 1 次，互不相同；
   - page close 事件 → 条目清除、detach 被调；
   - `release` / `closeAgent` / `closeAll` → 对应 detach；
   - TTL：注入假时钟，空闲超阈值被 detach，活跃中被刷新保活；
   - 并发 getOrCreate 同键 → 共享在途 Promise，仅 1 次 attach。
2. `tests/unit/worker/ToolAdapter.test.ts` 扩展 —— options.agentId →
   `setActiveAgent/clearActiveAgent`；缺省不清不误伤。
3. `tests/unit/ipc/daemonServer.test.ts` 扩展 —— 帧带/不带 agentId 透传至 executeTool。
4. `tests/unit/worker/context/BrowserContextProvider.test.ts` —— 两 agent 各
   setSelectedPage 互不覆盖；default 回退。
5. 回归：现有 `DebuggerContextProvider.test.ts`、`CdpNetworkMonitor.test.ts` 适配新构造
   入参后全绿。

最终验证闭环：`npm run typecheck`、`npm run test:unit`、`npm run check-format`。

## 6. 改动清单

新建：`CdpSessionRegistry.ts` + 其测试。
修改（约 15–20 文件）：`cli` 入口、`ipc/daemonServer.ts`（+帧类型）、
`worker/ToolAdapter.ts`、`worker/ToolContext.ts`、`worker/context/BrowserContextProvider.ts`、
`worker/context/DebuggerContextProvider.ts`、`worker/collectors.ts`、
`modules/collector/CdpNetworkMonitor.ts`、`CodeCollector.ts`、`Page*`、
`modules/debugger/evaluateInPageRuntime.ts`、`tools/input|emulation|stealth|dom|performance|navigation`
散点、`modules/browser/index.ts`、`RuntimeServices`/`ServiceLocator`（registry 挂载点）。
删除：`modules/browser/SessionManager.ts`。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 复用的 session 携带上一工具残留的域状态（同 agent 内） | 与现状比是改善（现状同 agent 连续调用也在建新 session 但没清理逻辑）；域 enable 幂等；跨 agent 已物理隔离 |
| `executeTool` 第 3 参签名变更牵连调用方 | 全仓调用方仅 daemonServer + ConsoleServer，一并改；grep 确认 |
| TTL 误杀长间隔交互（agent 思考 6 分钟再操作） | 下次 getOrCreate 自动重建，透明；5 分钟阈值可常量调 |
| 散点替换遗漏一处 | 实施完成后 `grep newCDPSession src/` 白名单核对（仅 registry 内部 + 3 处例外保留） |
