# 统一抓包视图：CDP + MITM 双链路聚合到 Session 设计规范

- **日期**：2026-08-28
- **设计状态**：已批准（r2.1，2026-08-28）——r2 按源码逐条核实 + graphify 影响分析收敛，r2.1 关闭 D1–D7 并修正 5 处口径，可直接进入 §14 切片 1 实现
- **文档路径**：`docs/superpowers/specs/2026-08-28-unified-capture-view-design.md`
- **目标项目**：Reverser-CLI
- **上游依赖**：`2026-08-26-anything-analyzer-migration-design.md`（Session 体系）、`2026-08-26-mitm-proxy-web-ui-design.md`（proxy 页 UI 契约）、`2026-08-26-anything-analyzer-session-persistence.md`（P1 地基，`emitToWs` 当时明确留作 seam，真实订阅与 UI 消费留给 P2/P3/P4 —— 本文即该切片）

### r2 修订摘要（相对 r1 的变更点）

| #   | 级别 | 变更                                                                                            | 触发原因                                                                                                                           |
| :-- | :--- | :---------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| R1  | P0   | WS 由「推全量 row」改为「推摘要」，并加零订阅者短路                                             | r1 与 `2026-08-26-mitm-proxy-web-ui-design.md:41` 明文相冲突；`WsHub.broadcast` 在遍历订阅者前就 stringify                         |
| R2  | P0   | `/api/session/requests` 改为摘要投影 + limit/cursor，并新增会话内保留配额                       | `getRequests()` 是 `SELECT *` 无 LIMIT，旧链路有 2000 环形上限与分页                                                               |
| R3  | P0   | `CaptureEngine` 摄入增加错误隔离契约（生产者永不被落库异常打断）                                | `appendRequest` 裸调用，表上有 `UNIQUE(session_id, sequence)`，摄入点在事件回调里                                                  |
| R4  | P1   | `Runtime` 扩展改为**可选**访问器 `captureEngine?`，调用侧防御式访问                             | `src/runtime.ts:46-47` 自述不直接加字段；`ConsoleServer.test.ts` 的 mock 会因新增强制调用而 TypeError                              |
| R5  | P1   | CDP 采集点从 `NetworkRequestCollector` 内部**外移**为 context 级 bridge                         | PageCollector 是「按导航分段可清空」语义，与 Session「跨导航 append-only」冲突；仓库已有 `CdpNetworkMonitor` 的超时/截断范式可复用 |
| R6  | P1   | 目标 4 事实纠正：`Network.enable` 早已由 collector 发出                                         | `src/worker/collectors.ts:154`                                                                                                     |
| R7  | P1   | 新增读侧 web DTO（`SessionRequestSummary` / `SessionRequestDetail`），详情 headers 解析成对象   | 前端 headers 用 `Object.entries`，且 `protocol.ts` 只重新导出 `src/web/types.ts`                                                   |
| R8  | P1   | 明确「清空列表」新语义与 MITM-only REST 端点归属                                                | `ProxyControlBar.tsx:83` 清空的是 ProxyStore，切源后按钮不再清空可见列表                                                           |
| R9  | P2   | §5.1 由二进制黑名单改为**文本白名单**判定 + 复用共享分类工具                                    | 仓库已有 3 份内容分类表，r1 会引入第 4 份                                                                                          |
| R10 | P2   | `timestamp` 语义定案（后经 r2.1 再修正为「响应头到达时刻」）；`source_ref`（跨源关联键）列为 v2 | r1 用 `Date.now()` = 响应完成时刻，`durationMs` 恒 0 无法事后纠正                                                                  |
| R11 | P2   | §6 收益描述更正；§12 补「不去重、允许重复行」；§11 补既有断言反转项                             | `session_get_data` 仍走 `requireActiveSession()`；`CaptureEngine.test.ts:130-184` 断言会翻转                                       |
| R12 | —    | 新增 §14 实施切片与回退、§15 影响分析证据                                                       | 变更横跨 10+ 个社区，不宜一次性切换                                                                                                |

**r2.1 复核修正（写实现计划时发现，已定稿）**：① R10 的 `request.timing().startTime` 不可实现（Playwright 该值是相对量、非 epoch），`timestamp` 改定义为「响应头到达时刻，且必须在 `await` 之前取值」，`durationMs` 明确不补；② 摘要投影归 `CaptureEngine`（`toSummary`，领域类型 `CapturedRequestSummary` 放 session 模块），`src/web/types.ts` 只做别名重导出，ConsoleServer 不再二次投影，消除 §3 与 §8 的口径冲突；③ `tests/unit/web-ui/proxy-store.test.ts` 不可运行（根 `tsconfig.json` 排除 `src/web-ui/**`、`vitest.config.ts` 三个 project 均不含该路径），§11 该行改为 `npm run web:typecheck` 门禁；④ 不抽 `isStaticAsset()`——两份 STATIC 表内容不同，合并即行为变更；⑤ D4/D6/D7 由"待定"转为已定（配额 5000 行 / 每 200 次成功落库由引擎触发 trim）。

---

## 1. 目标与背景

Web 控制台的 proxy 页（`src/web-ui/src/routes/proxy.tsx`）目前**只能看到 MITM 代理捕获的请求**，看不到 CDP 浏览器链路捕获的请求。二者是两套互不相通的存储与推送链路：

| 链路       | 存储                                                                                    | 前端可见性     |
| :--------- | :-------------------------------------------------------------------------------------- | :------------- |
| MITM 代理  | `ProxyStore`（内存环形缓冲，上限 2000）→ `proxy.request` WS 频道（摘要）                | proxy 页可见   |
| CDP 浏览器 | `NetworkRequestCollector`（Playwright `page.on('request')`，无 response 阶段、无 body） | proxy 页不可见 |

本规范在上游迁移 spec 已规划但**从未落地激活**的 `CaptureEngine` 骨架上，把两条链路统一汇聚进 Session 体系，并把 proxy 页改造成「CDP + MITM 混排、按 `source` 区分」的统一请求视图。成果对齐 `open-source/anything-analyzer` 的 `CaptureEngine`（`response-captured` 统一契约 + 单表 + `source: 'cdp' | 'proxy'`），**但不照抄其「必须显式 start 会话」的门槛**（见 §6）。

### 1.1 目标

1. **双链路统一落库**：CDP 与 MITM 请求都经 `CaptureEngine.ingestRequest()` 落 `captured_requests` 表（`source` 区分）。
2. **自动默认会话**：无活动会话时首个 ingest 自动建默认会话，一旦有任一捕获即有数据。
3. **统一视图**：proxy 页数据源从 MITM-only 切到 Session（CDP + MITM），列表带 `source` 标签，详情懒加载。
4. **不新增 CDP 域暴露面**：CDP 侧只用 Playwright `page.on('response')` + 既有 Network 域。
   注意事实基线：`NetworkRequestCollector.attachListeners` **已经**在发送 `Network.enable`（`src/worker/collectors.ts:154`），因此本目标约束的是「不新增 `Fetch.requestPaused` / `Debugger` 等**尚未启用**的域」，而不是「默认路径无 Network 域」。反检测分层讨论见 `docs/cloak.md` 与 `AGENTS.md`。
5. **推送轻量、读取有界**：WS 只推摘要，列表只回摘要投影，会话有保留配额（R1/R2）。

---

## 2. 现状与差距（r2 逐条回源核实）

### 2.1 r1 断言核实结果

| r1 断言                                                 | 结论        | 证据                                                                                                         |
| :------------------------------------------------------ | :---------- | :----------------------------------------------------------------------------------------------------------- |
| `CaptureEngine` 已导出但全仓无实例化                    | ✅ 成立     | graphify 入度 4，仅 `session/index.ts` re-export + 单测/集成测试 import；无任何 `new CaptureEngine` 生产调用 |
| `emitToWs` 无人接线                                     | ✅ 成立     | 构造注入唯一入口 `CaptureEngine.ts:24-30`                                                                    |
| `CaptureSessionManager` 缺 `ensureActiveSession()`      | ✅ 成立     | 只有 `requireActiveSession()`（`CaptureSessionManager.ts:54-60`）                                            |
| `NetworkRequestCollector` 只挂 `page.on('request')`     | ✅ 成立     | `src/worker/collectors.ts:125`                                                                               |
| MITM 捕获只进 `ProxyStore`                              | ✅ 成立     | `MitmModule.ts:57-59`                                                                                        |
| `WsHub` 合法频道无 `session.request`                    | ✅ 成立     | `WsHub.ts:49-56`                                                                                             |
| `Runtime` 有 `captureSessionManager` 无 `captureEngine` | ✅ 成立     | `src/runtime.ts:62`                                                                                          |
| 「不新增 `Network.enable`」的表述                       | ❌ 前提失真 | collector 已 eager `Network.enable`（`collectors.ts:154`），R6 已改写目标 4                                  |

### 2.2 r2 新增的必须约束（r1 遗漏）

- **序列化成本**：`WsHub.broadcast` 先 `JSON.stringify(msg)` 再遍历订阅者（`src/web/ws/WsHub.ts:131-137`），零订阅者时同样全额序列化；已有 `getSubscriberCount(channel)`（`:196`）可用于短路。
- **读放大**：`SqliteSessionStore.getRequests()` 是 `SELECT *`（含 `request_body` / `response_body`）且无 LIMIT（`SqliteSessionStore.ts:254-276`）；旧链路有 `ProxyStore` 2000 环形上限（`ProxyStore.ts:22`）与 `pageIdx/pageSize`（`src/web/routes/proxy.ts:152-158`）。
- **落库约束**：`captured_requests` 有 `UNIQUE (session_id, sequence)` + FK（`src/database/DatabaseManager.ts:44-45`），`sequence` 来自内存 Map（`CaptureSessionManager.ts:31/83-87`），`appendRequest` 无 try/catch（`CaptureEngine.ts:41`）。
- **既有同类能力**：`src/modules/collector/CdpNetworkMonitor.ts` 已实现 CDP attach/detach + `Network.responseReceived` + **3s 超时取体**（`:46`、`:125-138`）+ 截断 + 去重；`NetworkModule.getRequest()` 用 `response.text()` 且以 `isTextualContentType()` 白名单判定（`NetworkModule.ts:77/99-101/455-467`）。r1 只引用了后者。
- **内容分类表已存在 3 份**：`MitmProxyServer.ts:33`（扩展名正则）、`TrafficPurifier.ts:10-32`（扩展名 Set，不含 `js`）、`NetworkModule.ts:77`（MIME 白名单）。
- **前端契约**：`src/web-ui/src/lib/protocol.ts:13` 是 `export * from '../../../web/types.js'`，前端类型只能来自 `src/web/types.ts`；`ProxyRequestDetail.tsx:136-137` 以 `Object.entries(headers)` 消费（对象，不是 JSON 字符串）；`ProxyRequestSummaryEvent.id` 是 `number`（`src/web/types.ts:158-166`）。
- **测试现状**：`tests/unit/web/ConsoleServer.test.ts:21-41` 的 `mockRuntime` 只有 `browserManager` / `hookManager`，却在 `before()` 里调用 `server.start()`（`:63`）——这正是 `ConsoleServer.ts:306` 写成 `runtime.mitmModule?.getStore?.()` 的原因。`tests/unit/modules/session/CaptureEngine.test.ts:130-184` 正在断言三个 ingest 无会话时抛 `No active session`。
- **AI 侧已有界**：`TrafficPurifier` 会 cap 条目（`:232`）、`PromptBuilder` 截断 body（`PromptBuilder.ts:134`）；**无界的是 MCP 工具 `session_get_data`**（`src/tools/session/session_get_data.ts:63-74`，全量 row 直出）。

---

## 3. 总体架构与数据流

```
CDP (Patchright)                          MITM (MitmProxyServer)
 context.on('response')  ← 新增 bridge      onCaptured(exchange) 回调（原有）
 （不再塞进 NetworkRequestCollector）                │
        │  CdpRequestAdapter                        │  MitmRequestAdapter
        │  （白名单判定 + 超时取体 + 截断）           │  （JSON 序列化 / 0-1 布尔）
        ▼                                          ▼
   SessionCaptureBridge ─────────┬────────── MitmModule.onExchange 水槽
                                 ▼
                  CaptureEngine.ingestRequest(input)
                       │  try/catch 包裹落库（摄入失败绝不打断生产者）
                       ├─ ensureActiveSession()（§6）
                       ├─ store.appendRequest(row)（落库，失败仅告警计数）
                       └─ emitToWs('session.request', SUMMARY(row))   ← 摘要，非整行
                                       │
                        ConsoleServer：零订阅者直接 return（getSubscriberCount）
                                       ▼
                        WsHub.broadcast('session.request')（新增频道）
                                       ▼
                        proxy 页 subscribe('session.request') → 列表增量
                                       ▼
                        详情按需 GET /api/session/requests/:id  ← body 只走 REST
```

关键不变量：

1. `CaptureEngine` 是**唯一聚合点**，两个 producer 各写一个轻量 adapter 映射成 `CapturedRequestInput`，不再各自维护独立存储与推送。
2. **WS 面只承载摘要**，body/headers 的唯一出口是 REST 详情（避免 R1 的带宽与 CPU 回退）。
3. **落库异常是捕获链路的局部故障**，不得向 Playwright / MITM 回调冒泡（R3）。

---

## 4. 组件变更清单

| 组件                                                                                   | 动作                                                                                                                                                                                                                                                 |
| :------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/runtime/RuntimeServices.ts`                                                       | 抽私有 `ensureSessionStore()`（`new SqliteSessionStore(new DatabaseManager())`）；`getCaptureSessionManager()` 改用共享 store；新增 `getCaptureEngine()`（`new CaptureEngine(manager, store)`，lazy）                                                |
| `src/runtime.ts`                                                                       | `Runtime` 接口新增**可选**访问器 `captureEngine?: CaptureEngine` + lazy getter（§7，遵循 `:46-47` 的 @stable 扩展约定）                                                                                                                              |
| `src/modules/session/CaptureEngine.ts`                                                 | ① `emitToWs` 改可晚绑定 `setEmitToWs(fn)`（null 安全）；② 三个 ingest 用 try/catch 包裹落库，失败 `logger.warn` + 暴露 `ingestFailureCount`；③ 新增 `toSummary(row)` 或改由调用方投影（实现取其一，禁止把整行推 WS）                                 |
| `src/modules/session/CaptureSessionManager.ts`                                         | 新增 `ensureActiveSession()`；`requireActiveSession()` 保留                                                                                                                                                                                          |
| `src/modules/session/SessionStore.ts` + `SqliteSessionStore.ts`                        | 新增 `getRequest(id)` 单条查询；新增 `listRequestSummaries(sessionId, filter, {limit, offset})`（显式列，排除 `request_body`/`response_body`，按 `sequence DESC` 取最近 N 条后前端反转）；新增 `trimRequests(sessionId, keepLast)`                   |
| `src/modules/session/adapters/MitmRequestAdapter.ts`（新增）                           | `CapturedExchange → CapturedRequestInput`，纯函数，单测直打                                                                                                                                                                                          |
| `src/modules/session/adapters/CdpRequestAdapter.ts`（新增）                            | `Playwright.Response → CapturedRequestInput`，含白名单判定 + 超时取体 + 截断                                                                                                                                                                         |
| `src/modules/network/contentType.ts` + `constants.ts`（新增，R9）                      | 提取 `isTextualContentType()`（**唯一来源**：`NetworkModule.ts:77/99`，值原样搬移）供新 adapter 与 `NetworkModule` 共用；`MitmProxyServer.ts:33` 与 `TrafficPurifier.ts:10` 两份 STATIC 表**内容不同**，合并即行为变更，本切片不动，仅登记债务       |
| `src/worker/collectors.ts`                                                             | **不改** `NetworkRequestCollector`（R5）；其 `clear()`/导航分段语义与 Session 持久落库解耦                                                                                                                                                           |
| `src/worker/context/SessionCaptureBridge.ts`（新增）                                   | context 级 `browserContext.on('response')` 挂载，调用 `CdpRequestAdapter` → `captureEngine.ingestRequest`；由 `CollectorContextProvider.start(context)`（`:55-60`）与 `ToolContext.setContext()`（`ToolContext.ts:137-140`）驱动，`dispose()` 时解挂 |
| `src/worker/context/CollectorContextProvider.ts`                                       | `start()` 内一并启动 `SessionCaptureBridge`；engine 经 `ServiceLocator.getCaptureEngine()` 获取（沿用 `ServiceLocator.ts:49-57` 的 `getOrCreate` 模式），不新增第二套注入通道                                                                        |
| `src/modules/proxy/MitmModule.ts`                                                      | `start()` 里 exchange 同时进 `store.add()` + 可选 `onExchange` 水槽；水槽内部 try/catch，MITM 主链路不受落库失败影响                                                                                                                                 |
| `src/modules/proxy/index.ts`                                                           | `MitmModule` 构造可选 `onExchange` 参数                                                                                                                                                                                                              |
| `src/web/ws/WsHub.ts` + `src/web/types.ts`                                             | 新增 `'session.request'` StreamChannel；新增 `SessionRequestSummaryEvent` / `SessionRequestSummary` / `SessionRequestDetail` 协议类型（§8/§9 的**唯一**前端可见类型源）                                                                              |
| `src/web/ConsoleServer.ts`                                                             | `start()` 里 `this.options.runtime.captureEngine?.setEmitToWs(...)`（防御式，零订阅者短路）；挂载 `createSessionRoutes(...)`；阶段 3 才删除 `onProxyCaptureListener`（`:306-319`）及其解绑（`:348-352`）                                             |
| `src/web/routes/session.ts`（新增）                                                    | `GET /api/session/requests`、`GET /api/session/requests/:id`（§9）                                                                                                                                                                                   |
| `src/web-ui/src/routes/proxy.tsx` + `stores/proxy.ts` + `lib/api.ts` + 两个 proxy 组件 | 数据源与类型切到 session 摘要/详情（§10）                                                                                                                                                                                                            |

> 不做的事：不改 `NetworkRequestCollector` 的监听集合、不给 MCP `*_mitm_requests` 工具改数据源、不新增 CDP 域。

---

## 5. 字段映射（两 producer → `CapturedRequestInput`）

`CapturedRequestRow` 约束：`requestHeaders`/`responseHeaders` 是 **JSON 字符串**，`isStreaming`/`isWebSocket`/`truncated` 是 **0/1 数字**（`src/modules/session/types.ts:39-58`）。两路都需 adapter。

**MITM（`CapturedExchange` → input，`src/modules/proxy/types.ts:8-24`）**

- `requestHeaders`（`Record<string,string>`）→ `JSON.stringify`；`responseHeaders` 同
- `isStreaming`/`isWebSocket`/`truncated` boolean → `0/1`
- `isOptions`/`isStatic` 无对应列，丢弃（噪声标记丢失的后果与补偿见 §10、§12）
- `requestId`（string）当前无落点：v1 丢弃，v2 用 `source_ref` 列恢复关联（§12、§13-D4）
- `durationMs = 0`、`initiator = null`、`statusCode`/`contentType` 直取、`timestamp` 直取 exchange 原值

**CDP（`Playwright.Response` + `response.request()` → input）**

- `method`/`url` 取 `request.method()`/`request.url()`
- `requestHeaders` 取 `request.headers()` → `JSON.stringify`
- `requestBody` 取 `request.postData() ?? null`
- `statusCode` 取 `response.status()`；`responseHeaders` 取 `response.headers()` → `JSON.stringify`
- `responseBody` 见 §5.1；`contentType` 取 `content-type` header
- `source = 'cdp'`；`isWebSocket = 0`；`durationMs = 0`；`initiator = null`（v1）
- **`timestamp` = 响应头到达时刻**（R10 修正，见 r2.1）：在 `response` 事件回调**入口同步**取 `Date.now()`，**必须早于任何 `await`**（取体之后再取会把延迟算进时间戳）。原 r2 写的"`request.timing().startTime`"**不可实现**：Playwright 的 `timing().startTime` 是相对量（非 epoch），无法与 MITM 行的 epoch 毫秒对齐。
- 语义固定：CDP 行 = 响应头到达；MITM 行 = exchange 完成（`CapturedExchange.timestamp` 原值）。两者不同锚点，故**列表排序一律以 `sequence` 为准**，`timestamp` 仅作展示；`durationMs` 恒 0（v1 不补，见 §12）。

### 5.1 CDP body 抓取（白名单 + 超时 + 截断）

复用 `NetworkModule.getRequest()` 已证实的 `response.text()` 能力（`NetworkModule.ts:455-467`），判定策略对齐仓库既有实现，改为**响应到达时主动抓取**：

- **取体条件用文本白名单**，不用二进制黑名单：`isTextualContentType(contentType)`（`json` / `text` / `javascript`，`NetworkModule.ts:77`）为真才取体。黑名单会漏 `application/wasm`、`application/x-font-woff`、`application/x-protobuf`、gRPC-web 等。
- `text/event-stream`（SSE）：命中白名单，但仍标 `isStreaming = 1`，并**不**调用 `text()`（会挂起），`responseBody = null`。
- **取体必须带超时**：新增常量 `CDP_BODY_TIMEOUT_MS = 3000`，与 `CdpNetworkMonitor.RESPONSE_BODY_TIMEOUT_MS`（`src/modules/collector/CdpNetworkMonitor.ts:46`）同值同语义；`text()` reject（资源被回收 / 导航被打断）时按 `responseBody = null` 处理，只 warn 不抛。
- 超 1 MiB 截断并标 `truncated = 1`；上限常量与 MITM 侧 `MAX_BODY_SIZE`（`MitmProxyServer.ts:23`）同源，统一放 `src/modules/network/constants.ts` 的 `MAX_CAPTURED_BODY_BYTES`（MITM 改引同值常量，零行为变更）。
- 默认开启；保留布尔开关（默认 `true`）供未来关闭。
- 明确代价：`response.text()` 会让 Playwright 侧缓冲整份文本，**截断发生在取体之后**，所以白名单是第一道闸、也是唯一有效的成本控制；这一条必须写进代码注释，避免后来者以为 1MiB 是硬内存上限。

---

## 6. 默认会话

`CaptureEngine` 三个 ingest 方法顶部由 `requireActiveSession()` 改为 `ensureActiveSession()`：

- 无活动会话时自动 `createSession({name: 'default'})`（`SqliteSessionStore.createSession` 直接落 `capturing` 状态，`:152-165`），返回该会话。
- 已存在活动会话则直接返回。
- 自动建会话**常驻**，直到用户显式 `session_create`（切换新会话）或 worker 重启；v1 不做"自动结束/按 targetUrl 自动新开"策略。

**与参考实现的有意分歧**：`anything-analyzer` 的 `CaptureEngine.handleResponseCaptured()` 开头是 `if (!this.sessionId) return`（`capture-engine.ts:41`），即必须显式 start；本设计相反，代价是**无人观察时也持续写库**。该代价由 §9 的保留配额 + 引擎侧 `trimRequests()`（见 §9「保留配额」）兜住，不得无限增长。

**收益更正（R11）**：

- ✅ 「一旦有任一捕获，proxy 页即有数据」成立。
- ❌ 「`session_get_data` 不带 `sessionId` 也总能命中」**不成立**：该工具走 `manager.requireActiveSession()`（`src/tools/session/session_get_data.ts:60`），`ensureActiveSession()` 只在 ingest 路径调用。v1 保持这一行为（读工具不应有创建会话的副作用），文档与工具描述按「无捕获即报 no active session」表述；若产品侧要求"总能命中"，另开决策项，把 ensure 下沉到三个 session 工具的默认会话解析。

---

## 7. `Runtime` 接口边扩展（R4）

`Runtime` 是 `@stable` 高扇入接口。影响分析（graphify，2026-08-28）：`src/runtime.ts` 被 **77 个文件 import**，`getRuntime()` 入度 **127**（r1 写的 "57+" 是接口注释里的旧数字，偏保守）。接口自身注释明确要求「新增服务应通过 `RuntimeServices` lazy getter 暴露，而不是直接添加到此接口；扩展用可选属性，不改必选字段」（`src/runtime.ts:46-47`）。

```ts
// src/runtime.ts
import type {CaptureEngine} from './modules/session/index.js';

interface Runtime {
  // ...现有字段不变
  /** 可选：遵循 @stable 扩展约定，不新增强制字段（§7 / R4）。 */
  captureEngine?: CaptureEngine;
}

// getRuntime() 中（与 captureSessionManager 同一 lazy getter 模式）：
get captureEngine() {
  return services.getCaptureEngine();
}
```

约束：

1. **调用侧一律防御式访问**：`runtime.captureEngine?.ingestRequest(...)`、`runtime.captureEngine?.setEmitToWs(...)`。这不是妥协——`tests/unit/web/ConsoleServer.test.ts:21-41` 的 mock 就是真实场景（r1 写法会让它在 `server.start()` 直接 TypeError）。
2. 不新增第二套服务定位通道：worker 侧统一经 `ServiceLocator.getCaptureEngine()`（沿用 `getOrCreate` 模式，`src/worker/ServiceLocator.ts:49-57`）。
3. `SqliteSessionStore` 与 `CaptureSessionManager` 必须共享同一 `DatabaseManager` 实例（否则两个 store 各自开句柄，且 `close()` 互相踩）——这就是 §4 里 `ensureSessionStore()` 的唯一理由。

---

## 8. WebSocket 通道（R1）

- **摘要在引擎侧产出，桥接侧只转发**（避免两处投影逻辑）：`CaptureEngine.ingestRequest` 落库成功后 `emitToWs({type:'session.request', payload: toSummary(row)})`；投影函数与领域类型放 session 模块，`src/web/types.ts` 只做别名重新导出（`src/web-ui/src/lib/protocol.ts:13` 会整体透传给前端）。

```ts
// src/modules/session/types.ts —— 领域类型（切片 1 落地）
export interface CapturedRequestSummary {
  id: string; // `${sessionId}-${sequence}`
  sessionId: string;
  sequence: number;
  timestamp: number; // 响应头到达（§5 / r2.1）
  method: string;
  url: string;
  statusCode: number;
  contentType: string | null;
  source: CaptureSource;
  truncated: number; // 0/1，让列表能标 "截断"
  isStreaming: number; // 0/1
}

// src/modules/session/CaptureEngine.ts —— export function toSummary(...)
// src/web/types.ts —— 切片 2 落地，仅别名
export type {CapturedRequestSummary as SessionRequestSummaryEvent} from '../modules/session/types.js';
```

- `ConsoleServer.start()` 里晚绑定 + 零订阅者短路（不再二次投影）：

```ts
this.options.runtime.captureEngine?.setEmitToWs(e => {
  if (e.type !== 'session.request') return; // 未注册频道显式忽略（见下）
  if (this.wsHub.getSubscriberCount('session.request') === 0) return;
  this.wsHub.broadcast('session.request', e.payload);
});
```

- `WsHub` 新增 `'session.request'` 到 `VALID_CHANNELS`（`WsHub.ts:49-56`）与 `StreamChannel` 联合类型（`src/web/types.ts:38-43`）。
- **静默丢弃要显式化**（原 r1 §8 把它写成"安全"）：`session.hook` / `session.snapshot` 未注册频道，靠 `VALID_CHANNELS` 守卫丢掉是隐式契约。改为 emitToWs 顶部按**已注册频道白名单**转发，非白名单走 `logger.debug`；将来有人接 `ingestHook` 时不会遇到"事件凭空消失"。
- **迁移分两步，不一次切**（§14）：阶段 2 期间 `proxy.request` 与 `session.request` **并存**（ProxyStore 桥接保留，前端仍订 `proxy.request`），使新链路有可观测的回退；阶段 3 才删除 `onProxyCaptureListener`（`ConsoleServer.ts:306-319`）与 `stop()` 解绑（`:348-352`），并从 `StreamChannel` / `VALID_CHANNELS` 移除 `proxy.request`。已知消费方只有 `src/web-ui/src/routes/proxy.tsx:53` 一处（graphify 交叉核实），删除是封闭变更。

---

## 9. REST 路由（`src/web/routes/session.ts` 新增）

| 接口                        | 方法 | 说明                                                                                                                                   |
| :-------------------------- | :--- | :------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/session/requests`     | GET  | 活动会话请求**摘要**列表；参数 `sources`（`cdp`/`proxy`，逗号分隔）、`urlFilter`、`limit`（默认 500，硬上限 2000）、`offset`（默认 0） |
| `/api/session/requests/:id` | GET  | 单条详情（headers 已解析为对象 + body）                                                                                                |

- **禁止**直接返回 `CapturedRequestRow`（R2）。列表走 `listRequestSummaries()`，SQL 显式列、不含 body（排序与分页见下「保留配额」条）。服务端不截断 `url` 长度（前端已有 truncate）。
- 详情走 `SessionStore.getRequest(id)`（新增），返回 `SessionRequestDetail`：`requestHeaders`/`responseHeaders` 用 `JSON.parse` 成 `Record<string,string>`（**解析失败降级为 `{}` + `headersParseError: true`**，不让脏数据打穿 UI），body 原样带 `truncated`。
- 响应形状与 `routes/proxy.ts` 保持同一风格（`Map<'METHOD /path', handler>`，`RestRouter.mount`，参照 `createProxyRoutes` 挂载点 `ConsoleServer.ts:165-167`）。`createSessionRoutes(store, manager)` **不需要 `wsHub`**（无广播职责），r1 签名里的 `wsHub` 去掉。
- **保留配额（D4 已定）**：`CaptureEngine` 是唯一写入方，配额逻辑归它。每次**成功落库**后 `ingestsSinceTrim++`，达到 `TRIM_EVERY_INGESTS = 200` 时归零并调 `store.trimRequests(session.id, DEFAULT_SESSION_KEEP)`，`DEFAULT_SESSION_KEEP = 5000`；trim 自身异常只 `logger.warn`，不得冒泡。两个常量与 `LIST_DEFAULT_LIMIT = 500`、`LIST_MAX_LIMIT = 2000`、`DEFAULT_SESSION_NAME = 'default'` 一起放 `src/modules/session/constants.ts`（会话侧配额）；`CDP_BODY_TIMEOUT_MS = 3000`、`MAX_CAPTURED_BODY_BYTES = 1 MiB`、`CDP_BODY_CAPTURE_ENABLED = true` 放 `src/modules/network/constants.ts`（传输侧，MITM 侧 `MAX_BODY_SIZE` 改引同值常量）。淘汰顺序：按 `sequence` 最旧优先删除；不足配额时 trim 为空操作。
- **REST 列表默认倒序取最近 N 条**：`ORDER BY sequence DESC LIMIT ? OFFSET ?`，响应内再反转成时间正序，保证首屏只拉摘要。
- **MITM-only 端点归属（R8）**：`GET /api/proxy/requests`（`src/web/routes/proxy.ts:148-195`）在 §10 切源后失去唯一前端消费方。决定：**保留**为 MITM 专用调试/兼容端点（MCP 工具 `list_mitm_requests` 直连 `MitmModule`，不经 REST，语义不变），并在路由注释标注「UI 已改走 `/api/session/requests`」。不删除，避免与 §12「不动 proxy MCP 工具」的边界混淆。

---

## 10. 前端改造（R7/R8）

- `proxy.tsx`：初始加载 `getProxyStatus()`（控制栏 MITM 状态仍用）保留；请求列表改 `api.getSessionRequests({limit})`；WS 订阅 `session.request`；详情改 `api.getSessionRequestDetail(id)`。
- `stores/proxy.ts`：
  - `requests: SessionRequestSummaryEvent[]`，`selectedId: string | null`（session id 形如 `${sessionId}-${sequence}`）；
  - `addRequest` 的 `findIndex(r => r.id === req.id)` 去重对 string id 天然兼容，保留；
  - `selectRequest(id: string | null)` 同步改签名；
  - 2000 上限（`:65`）保留为**客户端**内存闸，与服务端 `limit` 双重兜底。
- `lib/api.ts`：新增 `getSessionRequests` / `getSessionRequestDetail`；`clearProxyRequests()` 保留（§10.1）。
- **`source` 标签**：列表行与详情头部都渲染 `cdp` / `proxy` 徽标；控制栏新增来源筛选（复用 `sources` 查询参数），因为混排后 CDP 一次导航可产出上百行。
- **详情组件**：`ProxyRequestDetail.tsx:136-137` 的 `Object.entries(...)` 现在拿到的是 `SessionRequestDetail` 已解析对象，无需改逻辑；`isStatic` 徽标（`:296`）在 CDP 行不存在 → 改为按 `contentType` 推导「静态」展示，或直接移除该徽标（择一写死，勿留半改状态）。
- **空态文案**：`ProxyRequestList.tsx:168`「启动代理并在被测客户端或设备配置 HTTP 代理后，流量将实时显示在此列表。」在混排视图下已失真 → 改为「连接浏览器（CDP）或启动 MITM 代理后，流量将显示在此列表」。
- **10.1 清空语义（R8）**：`ProxyControlBar.tsx:83` 现调 `api.clearProxyRequests()`，清空的是 `ProxyStore`，切源后**不再清空可见列表**。定为：
  - 按钮改名「清空视图」→ 只做前端 `clearRequests()`（本地清，不动库）；
  - MITM 记录清空能力保留在 MCP 工具 `clear_mitm_requests`（`src/tools/proxy/clearMitmRequests.ts`），不在 UI 暴露；
  - 若产品要求"清库"，另开 `DELETE /api/session/requests`（v1 不做，见 §12）。

---

## 11. 测试矩阵

镜像目录，`node:test`：

| 目标                          | 位置                                                            | 断言要点                                                                                                                                                                                                                      |
| :---------------------------- | :-------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ensureActiveSession`         | `tests/unit/modules/session/CaptureSessionManager.test.ts`      | 无会话自动建、幂等、重复调用不重建、并发 ingest 不产生第二条 default 会话                                                                                                                                                     |
| `CaptureEngine.ingestRequest` | `tests/unit/modules/session/CaptureEngine.test.ts`              | 落库 + **emitToWs 收到摘要而非整行** + 自动建会话                                                                                                                                                                             |
| ⚠️ 既有断言反转               | 同上 `:130-184`                                                 | r1 遗漏：该用例现在断言三个 ingest 抛 `No active session`，§6 改 `ensure` 后**必须重写**（改为断言自动建会话），不是"扩展"                                                                                                    |
| ⚠️ 既有构造签名               | 同上 `:20/:30`                                                  | `emitToWs` 由构造注入改晚绑定后 `setup()` 需同步                                                                                                                                                                              |
| 摄入错误隔离                  | 同上                                                            | store 抛错时 ingest **不抛**、`ingestFailureCount` 递增、后续摄入仍工作                                                                                                                                                       |
| MITM / CDP adapter            | `tests/unit/modules/session/adapters/*.test.ts`（新增）         | JSON 序列化、0/1 布尔、body 截断、**非白名单不取体**、SSE 不调 `text()`、超时降级 `responseBody=null`、`timestamp` 在 `await` 前取值                                                                                          |
| 摘要投影与 trim               | `tests/unit/modules/session/SqliteSessionStore.test.ts`（扩展） | `listRequestSummaries` 不返回 body 列、`limit/offset` 生效、`trimRequests` 按 sequence 淘汰最旧                                                                                                                               |
| `createSessionRoutes`         | `tests/integration/web/session-routes.integration.test.ts`      | 列表摘要形状、`sources` 过滤、详情 headers 是对象、脏 JSON headers 降级不 500                                                                                                                                                 |
| WS 摘要频道                   | `tests/unit/web/ws/WsHub.test.ts`（扩展）                       | `session.request` 可订阅、未注册频道仍拒、零订阅者不序列化（可断言 emitToWs 短路）                                                                                                                                            |
| `ConsoleServer` 桥接          | `tests/unit/web/ConsoleServer.test.ts`                          | mock 缺 `captureEngine` 时 `start()`/`stop()` 不抛（防御式访问回归）                                                                                                                                                          |
| proxy store                   | **不设 node:test 用例**（r2.1 更正）                            | 根 `tsconfig.json` 已 `exclude: ["src/web-ui/**"]`，`vitest.config.ts` 三个 project 也不含 `tests/unit/web-ui/**`；从 `tests/` 反向 import web-ui 源码会把被排除文件拖回主构建。前端改动统一以 `npm run web:typecheck` 为门禁 |
| MITM 路由回归                 | `tests/unit/web/routes/proxy.test.ts`                           | `proxy.request` 桥接删除后既有断言同步（阶段 3）                                                                                                                                                                              |

- **切片 1 全绿即地基完成**：`ensureActiveSession` / 引擎隔离 / adapter / 摘要与 trim 四组用例 + `npm run typecheck` + `npm run check-format`。
- trim 边界必须显式覆盖：插入 `keepLast + 2` 行后 `trimRequests` 恰好剩 `keepLast` 行；行数 ≤ `keepLast` 时为**空操作**（回归 `OFFSET` 语义，见计划 Task 4）。

验证闭环（最后一次代码改动后重跑）：`npm run typecheck`、`npm run test:unit`（**相对开工前基线判断**）、改动文件级 `npx prettier --check` + `npx eslint`；涉及 `src/web-ui` 时再加 `npm run web:typecheck`。

> 门禁现状（2026-08-28 实测，写计划时核实）：`npm run check-format` **不能当通过门禁**——`eslint --cache .` 连 `open-source/**` 一起扫会在默认堆下 OOM，`prettier --check --cache .` 对 402 个文件报 warn（多为 `docs/skills/**`、`docs/CDP/**` 的 vendored 文档，另有 `src/tools/**` 34、`tests/unit/**` 10）；`npm run test:unit` 自身基线是 1531 tests / 1474 pass / **57 fail**（19 个顶层套件，集中在 browser / CodeCollector / formatters / tools / provider，与 Session 链路无关），`npm run test:integration` 在本机 12 分钟未返回（含真实浏览器依赖），只能靠定向集成用例兜底。故本设计验收口径为「**不新增红**」+「本切片涉及文件全绿」+「改动文件零格式/lint 告警」；全量清理与 `eslint` ignores 补 `open-source/**` 另立任务。

---

## 12. 明确不做（v1 边界）

- 不动 `ProxyStore`，不动 `list_mitm_requests` / `get_mitm_request` / `clear_mitm_requests` 等 `src/tools/proxy/` MCP 工具（继续走 ProxyStore，语义不变、零迁移）。
- 不新增尚未启用的 CDP 域（`Fetch.requestPaused` / `Debugger`）；不承诺"默认路径无 Network 域"（事实是已有，见 §1.1 目标 4）。
- CDP 的 `initiator`、`durationMs`、WebSocket 帧本版置空/置 0。
- **不去重**：若外部客户端与 CDP 浏览器同时经同一 MITM 端口，同一请求会以 `cdp` + `proxy` 两行入库，v1 明确接受（`CapturedExchange.requestId` 与 Playwright request 之间无关联键）。
- 不做跨源关联：`source_ref` 列（承载 MITM `requestId` / CDP `request.url()+起始时间`）留 v2，需 `applyMigrations` 升 v2（`src/database/DatabaseManager.ts:86-95`）。
- 不引入 `session.hook` / `session.snapshot` WS 频道（Hook/快照已落库，经 `session_get_data` 可取）；emitToWs 对未注册频道显式 debug 而非静默丢弃（§8）。
- 不实现"自动结束/按 targetUrl 自动新开会话"策略。
- 不做 `DELETE /api/session/requests`（清库）；UI 清空 = 本地清视图（§10.1）。
- 不改 `NetworkRequestCollector` 的监听器与导航分段语义（R5）。
- 三处历史分类表（`MitmProxyServer.ts:33`、`TrafficPurifier.ts:10`、`NetworkModule.ts:77`）的**全量收敛**不在本切片；本切片只把 `isTextualContentType()` 提为单一来源，两份 STATIC 扩展名表因内容不同**不合并**（合并即行为变更），另立债务条目。
- 不为 `src/web-ui` 引入新测试基建（vitest project / tsconfig include），前端改动以 `npm run web:typecheck` 为门禁（r2.1）。
- 不补 CDP `durationMs`：`timestamp` 只有响应到达一个锚点，算不出耗时（r2.1，与 §5 一致）。

---

## 13. 决策项（r2.1 已全部关闭）

| ID  | 决策项                                   | 现状                                                                                                          | 建议                                                                                                                                             |
| :-- | :--------------------------------------- | :------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 默认会话命名与生命周期                   | 已定：`name:'default'` 常驻，显式 `session_create` 才切换；自动建会话持续写库                                 | 落地：`ensureActiveSession()` 单点实现，三 ingest 共用；配额见 D4                                                                                |
| D2  | **MITM** MCP 工具与 UI 视图是否分裂      | 已定：保留分裂（工具走 ProxyStore，UI 走 Session）                                                            | 落地：不改 `src/tools/proxy/*`                                                                                                                   |
| D3  | CDP body 抓取开关与判定                  | 已定：默认开（`CDP_BODY_CAPTURE_ENABLED = true`）、**文本白名单**判定、3s 超时、1MiB 截断                     | 落地：`src/modules/network/constants.ts` + `contentType.ts`；开关由切片 2 的 `SessionCaptureBridge` 读取（采集点已外移，不再放 `collectors.ts`） |
| D4  | 会话保留配额（R2 新增）                  | **已定**：`DEFAULT_SESSION_KEEP = 5000`，`TRIM_EVERY_INGESTS = 200`，trim 由 `CaptureEngine` 在成功落库后触发 | 落地：§9「保留配额」+ 计划 Task 4/5                                                                                                              |
| D5  | 「清空」语义（R8 新增）                  | 已定：UI 清空 = 本地清视图；MITM 清库走 `clear_mitm_requests` 工具                                            | 落地：`ProxyControlBar.tsx` 按钮文案 + §10.1                                                                                                     |
| D6  | `Runtime` 扩展方式（R4 新增）            | **已定**：`captureEngine?: CaptureEngine` 可选 + 调用侧 `?.`（保持 `ConsoleServer.test.ts` mock 可跑）        | 落地：§7 三条约束；不改回必选                                                                                                                    |
| D7  | 读工具是否也 ensure 默认会话（R11 新增） | **已定：否**。读工具不产生创建会话的副作用，`session_get_data` 无捕获时仍报 `No active session`               | 落地：§6「收益更正」；产品侧要"总能命中"再翻案                                                                                                   |

---

## 14. 实施切片与回退（graphify 证据驱动）

本次变更横跨 ≥10 个代码社区（worker/collector、session、proxy、runtime、web/ws、web/routes、web-ui store/route/component），一次性切换不可回退。拆三片，每片独立可验收：

1. **地基（纯后端，零行为变更）**：`ensureSessionStore()` 共享 store、`getCaptureEngine()` + `captureEngine?` 可选访问器、`ensureActiveSession()`、`getRequest` / `listRequestSummaries` / `trimRequests`、emitToWs 晚绑定 + 错误隔离、两个 adapter + 共享 content-type util。验收：§11 前三行 + adapter + 隔离用例全绿；`proxy` 页行为逐位不变。
2. **接线（加法，保留旧链路并存）**：`SessionCaptureBridge`、`MitmModule.onExchange` 水槽、`session.request` 频道 + 摘要投影 + 零订阅者短路、`createSessionRoutes`。验收：集成测试 + 手工一次导航，`captured_requests` 有行、`/api/session/requests` 返回摘要；`proxy.request` 仍在推，UI 仍读旧源 → 随时可回退。
3. **切换（删除类）**：前端切源、source 标签/筛选、空态文案、清空语义、`proxy.request` 频道与 ProxyStore 桥接下线。验收：§11 最后三行 + `npm run web:typecheck`；单 PR 只含删除与前端切换，便于定位回归。

---

## 15. 影响分析证据（graphify 2026-08-28）

- 图谱：`graphify update D:\work\Reverser-CLI` → **13601 nodes / 24697 edges / 819 communities**；1391 个源文件入图。代码侧为 AST 全量重抽；221 个变更文档未做语义重抽取（无 LLM key），如需文档级跨链再跑 `/graphify --update`。
- 关键度量：`src/runtime.ts` 被 77 文件 import、`getRuntime()` 入度 127、`CaptureEngine` 入度 4（仅 barrel + 测试）、`NetworkRequestCollector` 入度 5、`ToolContextProvider` 入度 31、`MitmModule` 入度 10、`WsHub` 入度 12（含 4 个测试文件）。
- 由此定案的三处收敛：§7 可选访问器（高扇入接口不得新增强制字段）、§4 不动 `NetworkRequestCollector`（低入度但生命周期语义冲突）、§8 `proxy.request` 删除是封闭变更（唯一消费方 `proxy.tsx:53`）。
