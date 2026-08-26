# MITM Proxy Web UI 模块实现计划 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建完整的 MITM Proxy 流量捕获与可视化逆向分析 Web UI 模块，包括后端 REST/WS 管道以及前端 React 交互面板。

**Architecture:** 后端扩展 `ProxyStore` 增加 EventEmitter 事件广播机制，`ConsoleServer` 桥接 `WsHub` 实时推送轻量级抓包摘要，并提供 `/api/proxy/*` REST API；前端基于 React 19 + Tailwind + Zustand 构建三栏分屏控制台（控制栏、抓包列表、深度详情面板、证书弹窗）。

**Tech Stack:** TypeScript, Node.js (EventEmitter, HTTP), React 19, Tailwind CSS, Lucide React, Zustand, Vite.

**Spec:** `docs/superpowers/specs/2026-08-26-mitm-proxy-web-ui-design.md`

## Global Constraints

- 遵循项目的 TypeScript ESM 规范与代码风格（Prettier & ESLint）。
- WS 仅广播轻量摘要数据，大体积请求/响应 Body 必须走 REST 懒加载，防止 WS 消息拥塞。
- 前端组件遵循 React Hooks 规则及 Tailwind 主题变量设计规范。
- 所有功能均需包含对应的单元测试或类型检查。

---

### Task 1: 扩展 ProxyStore 事件机制与后端 Web 协议类型

**Files:**
- Modify: `src/modules/proxy/ProxyStore.ts`
- Modify: `src/modules/proxy/MitmModule.ts`
- Modify: `src/web/types.ts`
- Test: `tests/unit/modules/proxy/ProxyStore.test.ts`

**Interfaces:**
- Consumes: `CapturedExchange`, `CapturedRequest` from `src/modules/proxy/types.ts`
- Produces: `ProxyStore.events: EventEmitter`, `proxy.request` (StreamChannel), `proxy.status` (StateChannel), `ProxyRequestSummaryEvent`, `ProxyStatusPayload`

- [ ] **Step 1: Write the failing test for ProxyStore EventEmitter**

```typescript
// tests/unit/modules/proxy/ProxyStore.test.ts (append test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProxyStore } from '../../../../src/modules/proxy/ProxyStore.js';

describe('ProxyStore Events', () => {
  it('should emit capture event when add is called', () => {
    const store = new ProxyStore();
    let captured: any = null;
    store.events.on('capture', record => {
      captured = record;
    });
    const record = store.add({
      requestId: 'req-1',
      method: 'GET',
      url: 'https://example.com/api',
      requestHeaders: {},
      requestBody: null,
      statusCode: 200,
      responseHeaders: {},
      responseBody: '{"ok":true}',
      contentType: 'application/json',
      isOptions: false,
      isStatic: false,
      isStreaming: false,
      isWebSocket: false,
      truncated: false,
      timestamp: Date.now(),
    });
    assert.strictEqual(captured?.id, record.id);
    assert.strictEqual(captured?.url, 'https://example.com/api');
  });

  it('should emit clear event when clear is called', () => {
    const store = new ProxyStore();
    let cleared = false;
    store.events.on('clear', () => {
      cleared = true;
    });
    store.clear();
    assert.strictEqual(cleared, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/modules/proxy/ProxyStore.test.ts`
Expected: FAIL (`store.events is undefined` or similar)

- [ ] **Step 3: Implement EventEmitter in ProxyStore and update web types**

1. In `src/modules/proxy/ProxyStore.ts`:
   - Import `EventEmitter` from `'node:events'`.
   - Add `readonly events = new EventEmitter();` to `ProxyStore`.
   - In `add(exchange)`, call `this.events.emit('capture', record)`.
   - In `clear()`, call `this.events.emit('clear')`.
2. In `src/modules/proxy/MitmModule.ts`:
   - Expose `getStore(): ProxyStore` so `ConsoleServer` can access the store instance.
3. In `src/web/types.ts`:
   - Add `'proxy.request'` and `'proxy.status'` to `Channel` / `StreamChannel` / `StateChannel`.
   - Add `ProxyRequestSummaryEvent` and `ProxyStatusPayload` interfaces.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/unit/modules/proxy/ProxyStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/proxy/ProxyStore.ts src/modules/proxy/MitmModule.ts src/web/types.ts tests/unit/modules/proxy/ProxyStore.test.ts
git commit -m "feat(proxy): add EventEmitter to ProxyStore and define WS proxy channels"
```

---

### Task 2: 实现后端 Proxy REST 路由与 WebSocket 事件桥接

**Files:**
- Create: `src/web/routes/proxy.ts`
- Modify: `src/web/ConsoleServer.ts`
- Test: `tests/unit/web/routes/proxy.test.ts`

**Interfaces:**
- Consumes: `MitmModule`, `ProxyStore`, `WsHub`, `sendJson`, `sendError`
- Produces: `createProxyRoutes(mitmModule: MitmModule, wsHub: WsHub): Map<string, RouteHandler>`

- [ ] **Step 1: Write the failing unit tests for Proxy REST routes**

```typescript
// tests/unit/web/routes/proxy.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createProxyRoutes } from '../../../../src/web/routes/proxy.js';
import { MitmModule } from '../../../../src/modules/proxy/MitmModule.js';
import { WsHub } from '../../../../src/web/ws/WsHub.js';

describe('Proxy REST Routes', () => {
  it('should register all expected proxy endpoints', () => {
    const mitmModule = new MitmModule();
    const wsHub = new WsHub();
    const routes = createProxyRoutes(mitmModule, wsHub);

    assert.ok(routes.has('GET /api/proxy/status'));
    assert.ok(routes.has('POST /api/proxy/start'));
    assert.ok(routes.has('POST /api/proxy/stop'));
    assert.ok(routes.has('GET /api/proxy/requests'));
    assert.ok(routes.has('GET /api/proxy/requests/:id'));
    assert.ok(routes.has('DELETE /api/proxy/requests'));
    assert.ok(routes.has('GET /api/proxy/ca/download'));
    assert.ok(routes.has('GET /api/proxy/ips'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/web/routes/proxy.test.ts`
Expected: FAIL (Cannot find module `src/web/routes/proxy.js`)

- [ ] **Step 3: Implement `src/web/routes/proxy.ts` and wire into `ConsoleServer.ts`**

1. Create `src/web/routes/proxy.ts`:
   - Implement `GET /api/proxy/status` (返回运行状态、端口、捕获条数、CA 信息).
   - Implement `POST /api/proxy/start` (调用 `mitmModule.start(port)`，并广播 `proxy.status`).
   - Implement `POST /api/proxy/stop` (调用 `mitmModule.stop()`，并广播 `proxy.status`).
   - Implement `GET /api/proxy/requests` (调用 `mitmModule.listRequests(query)`).
   - Implement `GET /api/proxy/requests/:id` (调用 `mitmModule.getRequest({ id })`).
   - Implement `DELETE /api/proxy/requests` (调用 `mitmModule.clear()`).
   - Implement `GET /api/proxy/ca/download` (流式输出 PEM 或 DER 格式证书).
   - Implement `GET /api/proxy/ips` (获取 `os.networkInterfaces()` 的 IPv4 地址).
2. In `src/web/ConsoleServer.ts`:
   - Mount `createProxyRoutes(this.options.runtime.mitmModule, this.wsHub)`.
   - Subscribe to `runtime.mitmModule.getStore().events` on `'capture'` -> `wsHub.broadcast('proxy.request', summary)`.
   - Clean up event listener on `stop()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/unit/web/routes/proxy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/routes/proxy.ts src/web/ConsoleServer.ts tests/unit/web/routes/proxy.test.ts
git commit -m "feat(web): add proxy REST routes and WS real-time event bridge"
```

---

### Task 3: 前端 API Client 与 Zustand Proxy Store

**Files:**
- Modify: `src/web-ui/src/lib/api.ts`
- Create: `src/web-ui/src/stores/proxy.ts`

**Interfaces:**
- Consumes: `api` HTTP methods, `ProxyRequestSummaryEvent`, `ProxyStatusPayload`
- Produces: `api.getProxyStatus`, `api.startProxy`, `api.stopProxy`, `api.getProxyRequests`, `api.getProxyRequestDetail`, `api.clearProxyRequests`, `api.getProxyLocalIps`, `useProxyStore`

- [ ] **Step 1: Extend `src/web-ui/src/lib/api.ts` with proxy client methods**

Add:
```typescript
getProxyStatus(): Promise<ProxyStatusPayload>;
startProxy(port?: number): Promise<{port: number; caCertPath: string}>;
stopProxy(): Promise<ProxyStatusPayload>;
getProxyRequests(params?: {urlFilter?: string; pageIdx?: number; pageSize?: number}): Promise<ListMitmRequestsData>;
getProxyRequestDetail(id: number): Promise<GetMitmRequestData>;
clearProxyRequests(): Promise<{clearedCount: number}>;
getProxyLocalIps(): Promise<{ips: string[]}>;
```

- [ ] **Step 2: Create `src/web-ui/src/stores/proxy.ts`**

State definition:
```typescript
export interface ProxyStoreState {
  requests: ProxyRequestSummaryEvent[];
  selectedId: number | null;
  selectedDetail: GetMitmRequestData | null;
  detailLoading: boolean;
  status: ProxyStatusPayload | null;
  autoScroll: boolean;
  filter: {
    search: string;
    method: string;
    statusFilter: string;
  };
  setRequests: (requests: ProxyRequestSummaryEvent[]) => void;
  addRequest: (req: ProxyRequestSummaryEvent) => void;
  clearRequests: () => void;
  selectRequest: (id: number | null) => Promise<void>;
  setStatus: (status: ProxyStatusPayload) => void;
  setAutoScroll: (autoScroll: boolean) => void;
  setFilter: (filter: Partial<ProxyStoreState['filter']>) => void;
}
```

- [ ] **Step 3: Run web typecheck**

Run: `npm run web:typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/web-ui/src/lib/api.ts src/web-ui/src/stores/proxy.ts
git commit -m "feat(web-ui): add proxy API client and Zustand store"
```

---

### Task 4: 实现 Proxy 核心前端组件与页面路由

**Files:**
- Create: `src/web-ui/src/components/proxy/ProxyControlBar.tsx`
- Create: `src/web-ui/src/components/proxy/ProxyRequestList.tsx`
- Create: `src/web-ui/src/components/proxy/ProxyRequestDetail.tsx`
- Create: `src/web-ui/src/components/proxy/CaCertModal.tsx`
- Create: `src/web-ui/src/routes/proxy.tsx`
- Modify: `src/web-ui/src/App.tsx`

**Interfaces:**
- Consumes: `useProxyStore`, `wsClient`, `api`, Lucide Icons
- Produces: `<ProxyPage />` on route `/proxy`

- [ ] **Step 1: Implement `CaCertModal.tsx` and `ProxyControlBar.tsx`**

- `CaCertModal.tsx`: 展示本机局域网 IP、下载根证书链接、PC/手机系统配置指引。
- `ProxyControlBar.tsx`: 启停按钮（带动画状态灯）、端口输入、证书按钮、自动滚动、清空按钮、搜索框与 Method 过滤下拉。

- [ ] **Step 2: Implement `ProxyRequestList.tsx`**

- 请求行展示：Method Badge（色彩标签）、Status Code（红绿黄）、Path/Query（单行省略 + Tooltip）、Content-Type 标识、时间戳。
- 键盘上下键交互支持与滚动容器联动。

- [ ] **Step 3: Implement `ProxyRequestDetail.tsx`**

- 选项卡：General, Headers (高亮 Authorization/Cookie/Sign等), Request Body, Response Body (格式化 JSON), 逆向操作 (一键 Copy cURL / Python 代码).

- [ ] **Step 4: Implement `src/web-ui/src/routes/proxy.tsx` and register in `App.tsx`**

- 组装 `ProxyControlBar`, `ProxyRequestList`, `ProxyRequestDetail`, `CaCertModal`。
- 在 `App.tsx` 中增加导航项与 `/proxy` 路由。

- [ ] **Step 5: Verify web build & typecheck**

Run: `npm run web:build`
Expected: PASS with build output in `build/web/`

- [ ] **Step 6: Commit**

```bash
git add src/web-ui/src/components/proxy/ src/web-ui/src/routes/proxy.tsx src/web-ui/src/App.tsx
git commit -m "feat(web-ui): implement Proxy capture page with list, detail tabs and CA modal"
```

---

### Task 5: 全量测试验证与构建闭环

**Files:**
- Test: `tests/unit/web/routes/proxy.test.ts`
- Test: `tests/unit/modules/proxy/ProxyStore.test.ts`

- [ ] **Step 1: Run all unit tests**

Run: `npm run test:unit`
Expected: All unit tests PASS

- [ ] **Step 2: Run full typecheck and build**

Run: `npm run typecheck && npm run web:build`
Expected: PASS

- [ ] **Step 3: Verify formatting**

Run: `npm run check-format`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit --allow-empty -m "chore: complete proxy Web UI implementation and verification"
```
