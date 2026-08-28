# 统一抓包视图：CDP + MITM 双链路聚合到 Session 设计规范

- **日期**：2026-08-28
- **设计状态**：已批准 (Approved)
- **文档路径**：`docs/superpowers/specs/2026-08-28-unified-capture-view-design.md`
- **目标项目**：Reverser-CLI
- **上游依赖**：`2026-08-26-anything-analyzer-migration-design.md`（Session 体系）、`2026-08-26-mitm-proxy-web-ui-design.md`（proxy 页 UI）

---

## 1. 目标与背景

Web 控制台的 proxy 页（`src/web-ui/src/routes/proxy.tsx`）目前**只能看到 MITM 代理捕获的请求**，看不到 CDP 浏览器链路捕获的请求。二者是两套互不相通的存储与推送链路：

| 链路 | 存储 | 前端可见性 |
| :--- | :--- | :--- |
| MITM 代理 | `ProxyStore`（内存环形缓冲）→ `proxy.request` WS 频道 | proxy 页可见 |
| CDP 浏览器 | `NetworkRequestCollector`（Playwright `page.on('request')`，无 response 阶段） | proxy 页不可见 |

本规范在 previous 迁移 spec 已规划但**从未落地激活**的 `CaptureEngine` 骨架上，把两条链路统一汇聚进 Session 体系，并把 proxy 页改造成「CDP + MITM 混排、按 `source` 区分」的统一请求视图。成果对齐 `open-source/anything-analyzer` 的 `CaptureEngine`（`response-captured` 统一契约 + 单表 + `source: 'cdp' | 'proxy'`）。

### 1.1 目标

1. **双链路统一落库**：CDP 与 MITM 请求都经 `CaptureEngine.ingestRequest()` 落 `captured_requests` 表（`source` 区分）。
2. **自动默认会话**：无活动会话时首个 ingest 自动建默认会话，打开 proxy 页即有数据。
3. **统一视图**：proxy 页数据源从 MITM-only 切到 Session（CDP + MITM），列表带 `source` 标签，详情懒加载。
4. **零新增 CDP 域**：CDP 侧复用 Playwright `page.on('response')`，不新增 `Fetch.requestPaused` / `Network.enable`，守仓库反检测分层。

---

## 2. 现状与差距（已核实）

- `CaptureEngine`（`src/modules/session/CaptureEngine.ts`）已写好并导出，但**全仓无任何 `new CaptureEngine` 实例化**；`emitToWs` 回调更是无人接线（构造时一次性注入，当前无注入方）。
- `CaptureSessionManager` 已有 `requireActiveSession()`（无会话时抛错），缺 `ensureActiveSession()`（无会话时自动建）。
- `NetworkRequestCollector`（`src/worker/collectors.ts:60`）只挂 `page.on('request')`（`collectors.ts:125`），无 `response` 阶段捕获，无 body。
- `MitmModule.start()` 中 `new MitmProxyServer(caManager, exchange => this.store.add(exchange))`（`MitmModule.ts:57-59`）：MITM 捕获只进 `ProxyStore`，不进 Session。
- `WsHub` 合法频道无 `session.request`（`src/web/ws/WsHub.ts:49-56`）。
- `Runtime` 接口有 `captureSessionManager`，无 `captureEngine`。

---

## 3. 总体架构与数据流

```
CDP (Patchright)                          MITM (MitmProxyServer)
 page.on('response') 捕获                   onCaptured(exchange) 回调（原有）
        │                                          │
        │ 字段 adapter（JSON 序列化 / 0-1 布尔）     │ 字段 adapter
        ▼                                          ▼
CollectorContextProvider.onCapturedRequest ────▶ CaptureEngine.ingestRequest({source})
（构造注入回调，见 §5）                                │
                                                      ├─ ensureActiveSession()（§6）
                                                      ├─ store.appendRequest(row)（落库）
                                                      └─ emitToWs({type:'session.request', payload:row})
                                                                              │
                                                        ConsoleServer.setEmitToWs(下方晚绑定)
                                                                              │
                                                       WsHub.broadcast('session.request')（新增频道）
                                                                              │
                                                    proxy 页 wsClient.subscribe('session.request')
```

关键：`CaptureEngine` 是**唯一聚合点**，两个 producer 各自写一个轻量 adapter 把自有结构映射成 `CapturedRequestInput`，不再各自维护独立存储与推送。

---

## 4. 组件变更清单

| 组件 | 动作 |
| :--- | :--- |
| `src/runtime/RuntimeServices.ts` | 抽私有 `ensureSessionStore()`（`new SqliteSessionStore(new DatabaseManager())`）；`getCaptureSessionManager()` 改用共享 store；新增 `getCaptureEngine()`（`new CaptureEngine(manager, store)`） |
| `src/runtime.ts` | `Runtime` 接口新增 `captureEngine: CaptureEngine` 访问器（lazy getter，见 §7） |
| `src/modules/session/CaptureEngine.ts` | `emitToWs` 由构造一次性注入改为可晚绑定 `setEmitToWs(fn)`（null 安全） |
| `src/modules/session/CaptureSessionManager.ts` | 新增 `ensureActiveSession()`；`requireActiveSession()` 保留 |
| `src/modules/session/SessionStore.ts` + `SqliteSessionStore.ts` | 新增 `getRequest(id: string)` 单条查询（支持详情懒加载） |
| `src/worker/collectors.ts` | `NetworkRequestCollector` 加 `page.on('response')` 捕获 + body 抓取 + `onCaptured?: (input) => void` 回调 |
| `src/worker/context/CollectorContextProvider.ts` | 构造接受 `onCapturedRequest` 回调，下传 `NetworkRequestCollector` |
| `src/worker/ToolContext.ts` | 组装时把回调指向 `runtime.captureEngine.ingestRequest`（§5） |
| `src/modules/proxy/MitmModule.ts` | `start()` 里 exchange 同时进 `store.add()` + 可选 `onExchange` 水槽（默认指向 captureEngine） |
| `src/modules/proxy/index.ts` | `MitmModule` 构造可选 `onExchange` 参数 |
| `src/web/ws/WsHub.ts` + `src/web/types.ts` | 新增 `'session.request'` StreamChannel + payload 类型 |
| `src/web/ConsoleServer.ts` | `start()` 里 `captureEngine.setEmitToWs(e => wsHub.broadcast(e.type, e.payload))`；WS 订阅改用 session 频道 |
| `src/web/routes/session.ts`（新增） | `GET /api/session/requests`、`GET /api/session/requests/:id`（§9） |
| `src/web-ui/src/routes/proxy.tsx` + `stores/proxy.ts` | 数据源切到 session（§10） |

---

## 5. 字段映射（两 producer → `CapturedRequestInput`）

`CapturedRequestRow` 的约束：`requestHeaders`/`responseHeaders` 是 **JSON 字符串**，`isStreaming`/`isWebSocket`/`truncated` 是 **0/1 数字**。两路都需 adapter：

**MITM（`CapturedExchange` → input）**
- `requestHeaders`（`Record<string,string>`）→ `JSON.stringify`
- `responseHeaders` 同
- `isStreaming`/`isWebSocket`/`truncated` boolean → `0/1`
- `isOptions`/`isStatic` 无对应字段，丢弃
- `durationMs = 0`、`initiator = null`、`statusCode` 直取、`contentType` 直取

**CDP（`Playwright.Response` + `response.request()` → input）**
- `method`/`url` 取 `request.method()`/`request.url()`
- `requestHeaders` 取 `request.headers()`（Record）→ `JSON.stringify`
- `requestBody` 取 `request.postData()` ?? null
- `statusCode` 取 `response.status()`
- `responseHeaders` 取 `response.headers()` → `JSON.stringify`
- `responseBody` 取 `response.text()`（见 §5.1）
- `contentType` 取 header `content-type`
- `source = 'cdp'`；`durationMs = 0`、`initiator = null`、`isWebSocket = 0`（v1 简化）
- `timestamp = Date.now()`

### 5.1 CDP body 抓取

复用 `NetworkModule.getRequest()` 已证实的 `response.text()` 能力，改为**响应到达时主动抓取**：

- content-type 判定：二进制（`image/`、`font/`、`audio/`、`video/`、`application/octet-stream`、`pdf`、`zip`）只记 `contentType`，`responseBody = null`。
- `text/event-stream`（SSE）标 `isStreaming = 1`。
- 超 1 MiB 截断并标 `truncated = 1`。
- 默认开启；保留布尔开关（默认 `true`）供未来关闭。

---

## 6. 默认会话

`CaptureEngine` 三个 ingest 方法顶部由 `requireActiveSession()` 改为 `ensureActiveSession()`：

- 无活动会话时自动 `createSession({name: 'default'})`（进入 `capturing`），返回该会话。
- 已存在活动会话则直接返回。
- 自动建会话**常驻**，直到用户显式 `session_create`（切换新会话）或 worker 重启；v1 不做"自动结束/按 targetUrl 自动新开"策略。

收益：打开 proxy 页即有数据；`session_get_data` 不带 `sessionId` 也总能命中。

---

## 7. `Runtime` 接口边扩展

`Runtime` 是 `@stable` 高扇入接口（57+ 调用方）。新增 `captureEngine` 遵循既有 lazy getter 模式（与 `captureSessionManager` 一致），**不修改任何必选字段**：

```ts
// src/runtime.ts
import type {CaptureEngine} from './modules/session/index.js';
interface Runtime {
  // ...现有字段不变
  captureEngine: CaptureEngine;
}
// getRuntime() 中：
get captureEngine() {
  return services.getCaptureEngine();
}
```

---

## 8. WebSocket 通道

- `CaptureEngine.emitToWs` 已产出 `{type:'session.request', payload: row}`。
- `ConsoleServer.start()` 里 `captureEngine.setEmitToWs(e => this.wsHub.broadcast(e.type, e.payload))`（晚绑定，替代现有的 `proxyStore.events.on('capture')` 桥接）。
- `WsHub` 新增 `'session.request'` 到 `VALID_CHANNELS` 与 `StreamChannel` 联合类型。
- 现有 `broadcast` 的 `VALID_CHANNELS` 守卫会丢弃未注册的 `session.hook`/`session.snapshot`（安全），本次只加 `session.request`。

> 迁移说明：`ConsoleServer` 现有 `onProxyCaptureListener`（`ConsoleServer.ts:306-319`）在统一后职责被 `CaptureEngine` 取代，删除该监听及其 `stop()` 里的解绑（`ConsoleServer.ts:348-352`），`proxy.request` 频道随之停用。

---

## 9. REST 路由（`src/web/routes/session.ts` 新增）

| 接口 | 方法 | 说明 |
| :--- | :--- | :--- |
| `/api/session/requests` | GET | 当前活动会话请求列表，支持 `sources`（`cdp`/`proxy` 过滤）、`urlFilter` |
| `/api/session/requests/:id` | GET | 单条详情（full headers + body） |

- 列表返回元素复用 session 的 `CapturedRequestRow`（含 `source`），前端据此渲染来源标签。
- 详情走 `SessionStore.getRequest(id)`（新增）。
- `ConsoleServer` 挂载 `createSessionRoutes(manager, wsHub)`（与 `createProxyRoutes` 同级，`ConsoleServer.ts:165` 附近）。

---

## 10. 前端改造

- `proxy.tsx` 初始加载：`getProxyStatus()`（控制栏 MITM 状态仍用）保留；请求列表改 `getSessionRequests()`；WS 订阅 `session.request`；详情改 `getSessionRequestDetail(id)`。
- `stores/proxy.ts`：`requests` 元素 id 由 `number` 变 `string`（session 用 `${sessionId}-${sequence}`）；`addRequest` 的 `findIndex(r => r.id === req.id)` 去重逻辑不变即兼容；`selectRequest` 的 `id` 形参同步改 `string`。
- 列表/详情加 `source` 标签（`cdp` / `proxy`），其余 UI 沿用现有 `ProxyRequestList`/`ProxyRequestDetail`。

---

## 11. 测试矩阵

镜像目录，`node:test`：

| 目标 | 位置 | 断言要点 |
| :--- | :--- | :--- |
| `ensureActiveSession` | `tests/unit/modules/session/CaptureSessionManager.test.ts` | 无会话自动建、幂等、重复调用不重建 |
| `CaptureEngine.ingestRequest` | `tests/unit/modules/session/CaptureEngine.test.ts`（已存在，扩展） | 落库 + `emitToWs` 触发 + 自动建会话 |
| MITM / CDP adapter 字段映射 | `tests/unit/modules/session/adapter*.test.ts`（新增） | JSON 序列化、0/1 布尔、body 截断、二进制置空 |
| `createSessionRoutes` | `tests/integration/web/session-routes.integration.test.ts` | 列表/详情/`sources` 过滤 |
| proxy store `addRequest` | `tests/unit/web-ui/proxy-store.test.ts`（如已有则扩展） | string id 去重、2000 上限 |

前端类型：`npm run web:typecheck`。

---

## 12. 明确不做（v1 边界）

- 不动 `ProxyStore`，不动 `listMitmRequests`/`getMitmRequest` 等 `src/tools/proxy/` MCP 工具（继续走 ProxyStore，语义不变、零迁移）。
- CDP 的 `initiator`、`durationMs`、WebSocket 帧本版置空/置 0，不新增 `Fetch.requestPaused` CDP 域。
- 不引入 `session.hook`/`session.snapshot` WebSocket 频道（Hook/快照已落库，经 `session_get_data` 可取）。
- 不实现"自动结束/按 targetUrl 自动新开会话"策略。

---

## 13. 待拍板决策项（落地前关闭）

| ID | 决策项 | 现状 | 建议 |
| :-- | :-- | :-- | :-- |
| D1 | 默认会话命名与生命周期 | 已定：`name:'default'` 常驻；显式 `session_create` 才切换 | 落地：`ensureActiveSession()` 单点实现，三 ingest 共用 |
| D2 | MITP MCP 工具与 UI 视图是否分裂 | 已定：保留分裂（工具走 ProxyStore，UI 走 Session） | 落地：不改 `src/tools/proxy/*` |
| D3 | CDP body 主动抓取开关 | 已定：默认开，布尔开关默认 `true` | 落地：`collectors.ts` 常量 + `CaptureEngineOptions` 透传 |