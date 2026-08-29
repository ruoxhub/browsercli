# 抓包仅捕获选中 Tab + CDP/MITM 筛选设计

> 状态：待评审（brainstorming → spec；评审通过后走 writing-plans 出实施计划）
> 关联：在 `docs/superpowers/plans/2026-08-28-unified-capture-view-slice2-wiring.md`（切片 2）之后追加，是它的增补切片，不推翻切片 2。

## 1. 背景与目标

切片 2 把「统一抓包视图」接上线后，proxy 页读的聚合源（CDP + MITM）里，CDP 生产者在 **BrowserContext** 级挂 `response` 监听（`SessionCaptureBridge.attach(context)`），把该 context 下**所有 tab** 的流量都收进来，与用户直觉「我只框选了一个 tab」不符。

**目标**：

1. **只捕获当前选中的 tab** 的 CDP 流量；非选中 tab 的响应在源头丢弃。
2. **切 tab 不自动清空**——旧 tab 已捕获的数据保留在列表里，由用户手动点「清空」按钮擦除。
3. MITM（代理）流量**始终捕获**、不受 tab 限制；新增 **CDP / MITM 筛选**让用户切换查看。
4. 抓包页新增 **tab 选择器**，复用现有 `list_pages` / `select_page` 工具切换选中页。

## 2. 已拍板决策（brainstorming 收敛结果）

| # | 决策 | 结论 |
|---|------|------|
| A | 捕获范围 | **当前 worker 选中页**（`select_page`/`list_pages` 选的 `selectedPage`） |
| B | 非选中 tab 的 CDP | **源头丢弃**（不落库、不推 WS），不是「落库 + 后端过滤」 |
| C | 切 tab 时历史 CDP | **保留**（不自动清空）；用户手动点「清空」按钮擦除 |
| D | MITM | **始终捕获**，靠 CDP/MITM 筛选切换查看 |
| E | tab 选择器位置 | 抓包页自带 tab 下拉，**复用 `list_pages`/`select_page` 工具**，不造新 tab 身份体系 |

## 3. 方案总览

```
CDP:  context.on('response') ──▶ SessionCaptureBridge.ingest(response)
        │ ① response.frame().page()  → 发起该响应的 tab
        │ ② isSelectedPage(tab) ?     → 否则 return（源头丢弃，决策 B）
        ▼
     fromCdpResponse() ──▶ CaptureEngine.ingestRequest
        ▼
captured_requests(CDP 行, source='cdp') ──▶ WS session.request ──▶ 前端按 source 过滤

MITM: MitmProxyServer ──▶ recordExchange ──▶ fromMitmExchange ──▶ ingestRequest
        （不经过 tab 判断，始终捕获 ── 决策 D）
        ▼
captured_requests(MITM 行, source='proxy') ──▶ WS session.request ──▶ 前端按 source 过滤

切 tab（抓包页 UI）:
  list_pages → 填下拉
  选择 → select_page(pageId) 成功 → 重新拉取 getSessionRequests()
      （不清空 ── 决策 C；旧 tab 数据留在列表，直到用户手动清空）

清空（已有按钮，无需改）:
  DELETE /api/session/requests → 全清（CDP + MITM）
```

- **无 schema 迁移**：不加 `page_id` 列。语义简化为「只捕当前选中 tab」，历史去留交给用户。
- **捕获范围由 `SessionCaptureBridge` 落地**：注入「是否为选中页」判定器，源头过滤。

## 4. CDP 源头过滤（决策 A/B）

### 4.1 `SessionCaptureBridge`

构造器新增可选 `isSelectedPage?: (page: Page) => boolean`。`ingest()` 里**在 await 取体之前**（V1 关键：`fromCdpResponse` 之前）同步判断：

```ts
private async ingest(response: Response): Promise<void> {
  const engine = this.getEngine();
  if (!engine) return;
  // 源头过滤：非选中 tab 的响应直接丢弃（决策 B）。
  // 必须在 await 取体之前判断——frame()/page() 是同步的，
  // 用「事件到达时刻」的选中页，避免飞行中请求在切 tab 后混入。
  if (this.isSelectedPage) {
    try {
      const page = response.frame().page();
      if (!this.isSelectedPage(page)) return;
    } catch {
      // frame() 抛 = 响应已 dispose，无法归属；保守丢弃，避免全局噪声。
      return;
    }
  }
  try {
    const input = await fromCdpResponse(response, /* opts */);
    engine.ingestRequest(input);
  } catch (error) {
    this.dropped += 1;
    logger.warn(/* ... */);
  }
}
```

已核实 `patchright` 的 `Response.frame(): Frame`（types.d.ts:21415）与 `Frame.page(): Page`（:7436）均存在，类型完备。

### 4.2 注入（收窄到 `CollectorContextProvider`）

`CollectorContextProvider` 构造器（`:49-53`）新增可选第二参 `isSelectedPage?: (page: Page) => boolean`，透传给 `SessionCaptureBridge`。`ToolContext` 构造 `_collectorContext`（`:53-55`）时补：

```ts
new CollectorContextProvider(
  () => this._serviceLocator.getCaptureEngine(),
  page => this._browserContext.getSelectedPage() === page,
)
```

> 时序安全：`_browserContext` 字段声明先于 `_collectorContext`（ToolContext.ts:51 vs 53），箭头函数延迟求值。
> 缺省 `undefined`（测试 / 无选中页语义）时不过滤——与切片 2 的「可选 engine」降级手法一致。

## 5. 切 tab 不清空（决策 C）

**无后端改动**。切 tab 后，旧 tab 已捕获的 CDP 行留在 `captured_requests` 里；用户点抓包页已有的「清空」按钮（`DELETE /api/session/requests`，`session.ts:185-200` 全清）擦除。该按钮与后端路由均已在切片 2 就位，本方案不改。

> 由此**不需要** `clearRequestsBySource`、不需要 `page_id` 列、不需要 `DELETE ?sources=` 扩展——决策 C 把这三样都省了。

## 6. CDP / MITM 筛选（决策 D）

- **后端已具备**：`GET /api/session/requests?sources=`（`session.ts:90-98`）已支持 `sources` 过滤，无需改。
- **前端新增**：
  - `stores/proxy.ts` 加 `sourceFilter: 'all' | 'cdp' | 'proxy'`（默认 `'all'`）+ `setSourceFilter`。
  - `ProxyControlBar.tsx` 增「全部 / CDP / MITM」三态筛选（Segment 或下拉）。
  - `ProxyRequestList.tsx` 的 `useMemo` 补一条 `sourceFilter === 'all' || req.source === sourceFilter`。

## 7. 抓包页 tab 选择器（决策 E）

复用现有工具，不造新端点：

- `stores/proxy.ts` 加：
  - `pages: Array<{pageId: string; index: number; url: string; title: string}>`
  - `selectedPageId: string | null`
  - `loadPages()`：`api.callTool('list_pages', {}).then(r => 解析 r.result.data.pageInfos)`
  - `selectPage(pageId)`：`api.callTool('select_page', {pageId})` 成功后重拉 `getSessionRequests()`（**不清空**，决策 C）。
- `routes/proxy.tsx`：`useEffect` 里 `loadPages()`；`ProxyControlBar.tsx` 加 tab 下拉（`pages` 为源，「全部」位不放这里——tab 选择与 source 筛选是两个正交维度）。

> **`api.callTool` 返回形状实施时核实**：`POST /api/tools/:name` 返回 `{invocationId, traceId, result, durationMs}`，`list_pages` 的 `result` 应含 `data: {pageInfos, selectedIndex, selectedPageId}`（`src/tools/navigation/listPages.ts:82-87`）、`select_page` 含 `data: {selectedPageId}`（`selectPage.ts:73-77`）。实施第一步先实测 `callTool` 链路返回层级，再写解析，不臆造。
>
> **select_page 副作用说明**：它会 `bringPageToFront(page)`（切浏览器前台 tab）。这是工具既有语义，抓包页复用它会顺带切换真实浏览器 tab——符合「框选 tab」直觉，不做 CDP 代理另设。

## 8. 改动文件清单

| 层 | 文件 | 改动 |
|---|---|---|
| 铁 | `src/worker/context/SessionCaptureBridge.ts` | 加 `isSelectedPage` 注入 + ingest 源头过滤 |
| 铁 | `src/worker/context/CollectorContextProvider.ts` | 构造器透传 `isSelectedPage` |
| 铁 | `src/worker/ToolContext.ts` | 构造 `_collectorContext` 注入判定器 |
| FO | `src/web-ui/src/stores/proxy.ts` | `sourceFilter` + `pages`/`selectedPageId`/`loadPages`/`selectPage` |
| FO | `src/web-ui/src/routes/proxy.tsx` | `loadPages()` 挂载 |
| FO | `src/web-ui/src/components/proxy/ProxyControlBar.tsx` | tab 下拉 + CDP/MITM 筛选 |
| FO | `src/web-ui/src/components/proxy/ProxyRequestList.tsx` | source 过滤 |

> 「铁」= CDP 捕获链路；「FO」= 前端 UI。
> **红线（不动）**：`src/tools/**`、`NetworkRequestCollector`、`PageCollector`、`proxy.request` 旧频道、`onProxyCaptureListener`、`src/web/routes/proxy.ts`、`src/modules/session`（存储 schema、`SessionStore` 接口、`sqliteSessionStore`、`session.ts` 路由均不动）、`SessionRequestSummaryEvent`/`SessionRequestDetail` 协议类型、数据库迁移。

## 9. 测试

- `tests/unit/worker/context/SessionCaptureBridge.test.ts`：注入 `isSelectedPage` 后，非选中页响应不落库（`getRequests` 空 / `dropped` 不增）；无判定器时全量（护栏，沿用既有用例）；`frame()` 抛错时丢弃且不抛。
- `tests/unit/worker/CollectorContextProvider.test.ts`：`start` 时透传判定器（可选，缺省静默）。

## 10. 已知天花板（ponytail）

- **历史跨 tab 混排**：切 tab 不清空（决策 C）意味着不同 tab 捕获的 CDP 行在列表里混在一起、无法区分来源 tab（无 `page_id` 维度）。这是「简单」的代价，用户按需手动清空。若日后要按 tab 回看，再引入 `page_id` 列（上一版 spec 曾设计过，被决策 C 取代）。
- **capturedCount 语义不变**：MITM 的 `status().capturedCount` 仍只反映 `ProxyStore`（旧链路）计数的 MITM 条数，与 session 库的 CDP 行无关。本方案不改它。
- **源头过滤的边界**：`isSelectedPage` 判定发生在「响应事件到达」时刻；若用户在取体期间（`await fromCdpResponse`）切 tab，该条仍按到达时刻的选中页判定。极小竞态（同一 tick 内切 tab）可忽略。
- **MITM 无 tab 维度**：切到任意 tab，MITM 行始终可见（决策 D）——它本来就不属于任何 tab。想只看 CDP 或只看 MITM 时用新增筛选。
- **`list_pages` 的 title 取 async**：tab 下拉显示 title + url；若页面标题读取超时，工具自身降级为 `[unavailable]`（`listPages.ts:51`），前端无需额外处理。

## 11. 实施切分（给 writing-plans 的输入）

1. CDP 源头过滤（SessionCaptureBridge + CollectorContextProvider + ToolContext + 单测）
2. 前端 CDP/MITM 筛选 + tab 选择器（store + route + control + list）
3. 收尾验证（typecheck / web:typecheck / 相关单测 / 手工：开两个 tab 切页验证只捕当前 tab、MITM 始终在、手动清空可用）