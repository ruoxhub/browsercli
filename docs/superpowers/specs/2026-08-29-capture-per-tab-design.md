# 抓包按 Tab 归属与过滤设计

> 状态：待评审（brainstorming → spec；评审通过后走 writing-plans 出实施计划）
> 关联：`2026-08-29` 在 `docs/superpowers/plans/2026-08-28-unified-capture-view-slice2-wiring.md`（切片 2）之后追加。本设计**不推翻**切片 2，是它的增补切片。

## 1. 背景与目标

切片 2 把「统一抓包视图」接上线后，proxy 页面读的是聚合源（CDP + MITM）。CDP 生产者在 **BrowserContext** 级挂 `response` 监听（`SessionCaptureBridge.attach(context)`），因此把该 context 下**所有 tab** 的流量都收进来，与 Network 面板「只显示选定页」的 per-Page 粒度不一致。

**目标**：用户能在抓包页选中一个 tab，默认只看该 tab 的流量；但所有 tab 的流量仍全量落库，可随时切换回看历史。MITM（代理）那一路因代理层看不见 tab，永远显示、标为「无归属」。

**三个确认过的方向决策**（brainstorming 拍板）：

| # | 决策 | 结论 |
|---|------|------|
| A | 是否给 `CapturedRequestSummary` 加 `pageId` | **是**（否则前端无从过滤，无替代） |
| B | pageId 溯源如何注入 | **注入 resolver 函数**，收窄到 `CollectorContextProvider` 构造器透传，少动一层 |
| C | 「只捕获」= 摄入时丢弃 vs 全量落库 + 前端过滤 | **后者**（否则「切换回看」不成立） |
| D | 「选定 tab」由谁决定 | 抓包页自带 tab 选择器（前端状态），与 worker 侧 selectedPage 解耦 |
| E | MITM 无归属如何对待 | `pageId` 恒 `null`，过滤时豁免（永远显示） |

## 2. 方案总览

```
CDP:  context.on('response') ──▶ SessionCaptureBridge.ingest
        │  response.frame().page() ──▶ resolvePageId(page) = 'page-N'
        ▼
     fromCdpResponse()  → input{pageId:null 占位}
        │  覆盖 input.pageId = 真实 page-N
        ▼
     CaptureEngine.ingestRequest(input)
        ▼
captured_requests.page_id ──▶ WS session.request(摘要含 pageId)
        │                           └─▶ 前端 store 按 selectedPageId 过滤展示
MITM: MitmProxyServer ──▶ MitmRequestAdapter → input{pageId:null} ──▶ 同上（page_id 恒 NULL）
```

- **全量落库**：任何 tab 的流量都写进 `captured_requests`，只是多记一个可空的 `page_id`。
- **展示过滤在前端**：proxy 页新增 tab 下拉，选中后 store 记录 `selectedPageId`，实时事件与历史拉取都按「命中该 tab 或 `page_id IS NULL`（MITM 豁免）」过滤。
- **后端 REST 同样支持 `pageId` 过滤**：供历史分页精确取数，语义与前端过滤同一公式（见 §6）。

## 3. 数据模型变更

### 3.1 迁移（`src/database/DatabaseManager.ts`）

`applyMigrations` 现用 `user_version` 门控（`:86-95`）。新增 `SCHEMA_V2`：

```sql
ALTER TABLE captured_requests ADD COLUMN page_id TEXT;
```

`user_version` 1 → 2。存量行 `page_id` 为 NULL（= 无归属，符合语义：历史数据本就无法补归属）。

### 3.2 类型（`src/modules/session/types.ts`）

- `CapturedRequestRow`（`:39-58`）：新增 `pageId: string | null`。
- `CapturedRequestInput = Omit<CapturedRequestRow, 'id'|'sessionId'|'sequence'>`（`:79-82`）：**自动**带上 `pageId`（非可选）——两个 adapter 都显式填 `null` 占位，CDP 侧由 bridge 覆盖真实值，避免可选字段的歧义。
- `CapturedRequestSummary`（`:88-100`）：新增 `pageId: string | null`。
- `RequestFilter`（`:122-125`）：新增 `pageId?: string`。

### 3.3 投影（`src/modules/session/summary.ts`）

`SummarySource`（`:9-22`）的 `Pick<...>` 与 `toSummary`（`:28`）各补 `pageId`。

### 3.4 Store（`src/modules/session/SqliteSessionStore.ts`）

- `RequestDbRow`（`:34-53`）加 `page_id: string | null`；`toRequest`（`:111`）补映射。
- `RequestSummaryDbRow`（`:56-69`）加 `page_id`；`listRequestSummaries`（`:304-355`）的 `SELECT` 与 `toSummary` 调用补该列。
- `appendRequest`（`:206-236`）INSERT 加 `page_id` 列与占位符。
- `getRequests` / `listRequestSummaries` 的 WHERE 子句支持 `filter.pageId`：
  - `pageId` 缺省 → 不加子句（全量）。
  - `pageId` 非空 → `(page_id = ? OR page_id IS NULL)`（MITM 豁免，见 §5）。

## 4. CDP 溯源链路

### 4.1 溯源函数（`SessionCaptureBridge`）

`patchright` 已核实 `Response.frame(): Frame`（types.d.ts:21415）与 `Frame.page(): Page`（:7436）存在，类型完备无需 `as any`。但响应对象可能已 dispose，`frame()` 可能抛——溯源必须 try/catch。

`SessionCaptureBridge` 构造器新增可选 `resolvePageId?: (page: Page) => string | null`，在 `ingest()` 里：

```ts
const pageId = this.resolvePageId
  ? (tryResolvePageId(response, this.resolvePageId) ?? null)
  : null;
const input = await fromCdpResponse(response, opts);
engine.ingestRequest({...input, pageId});
```

`tryResolvePageId` 内部：`response.frame().page()` 抛错 → `null`；resolver 抛错 → `null`。

### 4.2 注入（决策 B）

`CollectorContextProvider` 构造器（`:49-53`）新增可选第二参 `getPageId?: (page: Page) => string | null`，把它包成 `resolvePageId` 传给 bridge。`ToolContext` 构造 `_collectorContext`（`:53-55`）时补：

```ts
new CollectorContextProvider(
  () => this._serviceLocator.getCaptureEngine(),
  page => {
    try { return this._browserContext.getPageId(page); }
    catch { return null; }
  },
)
```

> 时序安全：`_browserContext` 字段声明先于 `_collectorContext`（ToolContext.ts:51 vs 53），且箭头函数延迟求值。
> `getPageId`（BrowserContextProvider.ts:109）内部会 `ensurePageId(page)` 生成稳定 `page-N` id；Page 不在当前 context 时抛错，被上面的 catch 兜成 null。

### 4.3 Adapter（决策 B 附带）

`cdpResponseToInput`（CdpRequestAdapter.ts:61）返回里 `pageId: null` 占位（pageId 不属于 adapter 的「字段映射」职责，它是 worker 侧上下文数据，由 bridge 覆盖）。

## 5. MITM 侧（`src/modules/session/adapters/MitmRequestAdapter.ts`）

`toCapturedRequestInput`（`:23-43`）返回补 `pageId: null`。代理层看不见 tab，这是事实约束，不是实现能绕开的。前端与后端过滤公式统一豁免 NULL（见 §6/§7）。

## 6. 后端 REST 变更

### 6.1 `GET /api/session/requests` 加 `pageId` 参数

`src/web/routes/session.ts`（`:74-202`）在 filter 组装处（`:113-116`）补：

```ts
const pageId = url.searchParams.get('pageId');
const filter = {
  ...(sources?.length ? {sources} : {}),
  ...(urlFilter ? {urlFilter} : {}),
  ...(pageId && pageId !== 'all' ? {pageId} : {}),
};
```

过滤语义在 `SqliteSessionStore` 落地为 `(page_id = ? OR page_id IS NULL)`——即选中某 tab 时，MITM（NULL）行仍返回。缺省或 `pageId=all` 不过滤。

### 6.2 新增 `GET /api/browser/pages`

挂在 `src/web/routes/config.ts`（该文件已有 `browser/connect`/`browser/disconnect`，`cfg.contextProvider` 是 `ToolContextProvider`，自带 `getPages()`/`getPageId()`）：

```ts
'GET /api/browser/pages',
(_req, res) => {
  const ctx = cfg.contextProvider;
  if (!ctx) { sendError(res, 'BROWSER_UNAVAILABLE', '浏览器未连接', 503); return; }
  try {
    const pages = ctx.getPages().map((p, index) => ({
      id: ctx.getPageId(p),
      index,
      url: (() => { try { return p.url(); } catch { return null; } })(),
    }));
    sendJson(res, {pages});
  } catch (err) { sendUnexpected(res, err); }
},
```

> 只取 `id/index/url`（`page.url()` 同步）。`title()` 是异步的，YAGNI 先不加，需要时再补。

前端 `api.ts` 新增 `getBrowserPages(): Promise<{pages: Array<{id: string; index: number; url: string | null}>}>` 与 `getSessionRequests({..., pageId})`。

## 7. 前端变更（`src/web-ui/**`）

> **红线**：本方案只**追加**，不删除切片 2 的任何前端切源逻辑。`session.request` 频道、`getSessionRequests`、旧 `proxy.request` 并存全保留。

- `stores/proxy.ts`：新增 `selectedPageId: string | null`（默认 `null` = 全部）+ `setSelectedPageId`。`addRequest` 依然全量收（决策 C：不入库时丢弃）。
- `routes/proxy.tsx`：`useEffect` 里 `getSessionRequests({pageId: selectedPageId})` 拉历史；`getBrowserPages()` 填 tab 下拉。
- `ProxyControlBar.tsx`：新增「标签页」下拉（含「全部」项 + 每个 page 的 `page-N`/url 项）。
- `ProxyRequestList.tsx`：`useMemo` 过滤补一条 `req.pageId === null || req.pageId === selectedPageId`；对 `pageId === null` 的行显示「无 tab」徽标（MITM 那一路的 source 已是 `proxy`，徽标可叠加展示）。

**过滤公式（前后端一字一致，避免两处读路径分叉）**：

```
命中 = selectedPageId 为空（全部）  → 全量
     否则 req.pageId === null       → TRUE（MITM 豁免）
     否则 req.pageId === selectedPageId
```

## 8. 测试

- `tests/unit/modules/session/SqliteSessionStore.test.ts`：`appendRequest`/`getRequests` 带 `pageId` 落值；`listRequestSummaries` 的 `pageId` 过滤 + `OR page_id IS NULL` 豁免语义。
- `tests/unit/modules/session/adapters/MitmRequestAdapter.test.ts`：`pageId: null`。
- `tests/unit/modules/session/adapters/CdpRequestAdapter.test.ts`：`pageId: null` 占位。
- `tests/unit/worker/context/SessionCaptureBridge.test.ts`：有 resolver 时覆盖 pageId；无 resolver / frame() 抛错时降级 `null`。
- `tests/integration/web/session-routes.integration.test.ts`：`pageId` 参数解析 + NULL 豁免。
- `tests/integration/web/`：`/api/browser/pages` 端点（mock contextProvider 返回 page 列表）。

## 9. 兼容与红线

- 不动 `src/tools/**`、`NetworkRequestCollector`、`PageCollector`、`proxy.request` 旧频道、`onProxyCaptureListener`、`src/web/routes/proxy.ts` 的 MITM-only 端点。
- `SessionRequestSummaryEvent = CapturedRequestSummary`（`src/web/types.ts:301` 别名透传）自动带 pageId，`src/web-ui/src/lib/protocol.ts` 整包 `export *` 透传。
- `SessionRequestDetail`（`src/web/types.ts:310`）补 `pageId: string | null`——`createSessionRoutes` 的 detail 是 `{...row, ...}`（`session.ts:172-178`），`row` 带 pageId 会摊开，声明它避免「响应有字段、类型不声明」的隐性不一致。
- 动了 `src/web/types.ts` → 收尾必须跑 `npm run web:typecheck`（前端 strict 域会吞到透明页面的新字段）。

## 10. 已知天花板（ponytail）

- 每个 Page 的 `pageId`（`page-N`）是 `BrowserContextProvider` 进程内自增的，重启/重连浏览器后不复用。它是「本次连接的 tab 身份」，不是跨会话稳定 ID。够用于「本次抓包里区分 tab」，不承诺跨重启关联。
- `page_id IS NULL` 豁免把 MITM 全部行放进任意 tab 视图——若未来 MITM 也要能按某种维度拆分，再引入 `source_ref`（spec §12 已预留）而非硬塞 pageId。
- `/api/browser/pages` 不返回 title（async），需要时再加。

## 11. 实施切分（给 writing-plans 的输入）

1. DB 迁移 + `types.ts` + `summary.ts` + `SqliteSessionStore`（含过滤语义）
2. Adapter 占位 `pageId: null`（CDP + MITM）
3. `SessionCaptureBridge` 溯源 + `CollectorContextProvider`/`ToolContext` 注入
4. `SessionRequestDetail` 补 pageId + `/api/session/requests` 参数 + `/api/browser/pages`
5. 前端 store/route/control/list
6. 收尾验证（typecheck / web:typecheck / 相关单测与集成测试）