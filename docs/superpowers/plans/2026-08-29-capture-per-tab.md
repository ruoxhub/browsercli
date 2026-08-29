# 抓包仅捕获选中 Tab + CDP/MITM 筛选 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 CDP 抓包只捕获当前选中的 tab、源头丢弃非选中 tab 的流量，并在抓包页新增「标签页」选择器与「CDP / MITM」来源筛选。

**Architecture:** 捕获范围在 `SessionCaptureBridge.ingest()` 落地——注入 `isSelectedPage(page)` 判定器，用 `response.frame().page()` 拿到发起响应的 tab，非选中页在取体前直接 `return` 丢弃。判定器来自 worker 侧 `selectedPage`（`ToolContext` 构造时注入 `page => selectedPage === page`）。切 tab 不清空历史（用户手动清空），MITM 始终捕获；前端 tab 选择器复用既有 `list_pages` / `select_page` 工具，来源筛选是纯前端 `useMemo` 过滤。

**Tech Stack:** TypeScript ESM（Node `^20.19.0 || ^22.12.0 || >=23`）、patchright、zustand、React、`node:test`（经 `npm run build` 后跑 `build/tests/**`）、Prettier + ESLint（平铺配置）。

**Spec:** `docs/superpowers/specs/2026-08-29-capture-per-tab-design.md`（本计划实现其 §4 源头过滤、§6 来源筛选、§7 tab 选择器，对应 §9 测试、§11 实施切分前三项）

---

## Global Constraints

- Node 版本：`^20.19.0 || ^22.12.0 || >=23`（`package.json` engines）。
- Prettier：`singleQuote: true`、`trailingComma: 'all'`、`arrowParens: 'avoid'`、`endOfLine: 'lf'`、`bracketSpacing: false`（`.prettierrc.cjs`）。
- ESLint：导入按字母序分组（`node:` 内置 → 裸包 → 上级 `../../`/`../` → 同级 `./`），组间空一行；类型导入显式 `import type`；同名 import 内 named 成员按字母序（`BrowserContext, Page, Response`）。报 `import/order` 时跑 `npx eslint --fix <file>` 后重跑，**不要手工猜顺序**。
- License 头：`src/worker/**` 用 `Copyright 2026 Browser-CLI`；`src/web-ui/**` 用 `Copyright 2026 Google LLC`；`tests/unit/**` 跟随既有文件头（`tests/unit/worker/context/SessionCaptureBridge.test.ts` 与 `tests/unit/worker/CollectorContextProvider.test.ts` 现有头是 `Copyright 2026 JSReverser-MCP`，本计划只在文件内追加用例、不改头）。
- **红线（不动）**：`src/tools/**`、`src/modules/session/**`（存储 + 类型 + 路由全不动，决策 C 免了 schema 迁移）、`src/modules/collector/**`、`src/web/routes/**`、`src/web/ws/**`、`proxy.request` 旧频道、`onProxyCaptureListener`、`src/modules/network/**`、数据库迁移。
- 每个 Task 收尾必跑：`npm run typecheck`、该 Task 测试；动了 `src/web-ui/**` 必须 `npm run web:typecheck`（前端 strict:true，只有它能抓前端类型错）。文件级门禁用 `npx prettier --check <file>` + `npx eslint <file>`。
- **不要用 `npm run check-format` 当门禁**：`eslint --cache .` 会连 `open-source/` 一起扫 OOM，`prettier --check .` 有 402 个既有 warn。
- 提交信息 Conventional Commits（`feat(worker): ...` / `feat(web-ui): ...`）。
- **工作区卫生**：每个 Task 的 `git add` 只列本 Task 显式文件，禁止 `git add -A`；提交前 `git status --porcelain` 核对。
- 单测运行模板（`<path>` 换成 `build/tests/...` 下路径）：

  ```bash
  npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/<path>.test.js
  ```

- 根 `tsconfig.json` 是松配置（`strict:false`、`noUnusedLocals:false`），漏掉的可选链只能靠测试暴露；动了 `src/web/types.ts` 才需要重跑 `web:typecheck`——本计划**不动** `src/web/types.ts`。

---

## 文件结构

| 文件 | 责任 | 状态 |
|---|---|---|
| `src/worker/context/SessionCaptureBridge.ts` | CDP 抓包挂载点；新增源头过滤 | Modify |
| `src/worker/context/CollectorContextProvider.ts` | 三个 collector 的 Facade；透传判定器 | Modify |
| `src/worker/ToolContext.ts` | 构造 provider 时注入 `selectedPage` 判定器 | Modify |
| `src/web-ui/src/stores/proxy.ts` | 抓包页状态：加 `sourceFilter` + `pages`/`selectedPageId`/`loadPages`/`selectTab` | Modify |
| `src/web-ui/src/routes/proxy.tsx` | 挂载 `loadPages()` | Modify |
| `src/web-ui/src/components/proxy/ProxyControlBar.tsx` | tab 下拉 + 「全部/CDP/MITM」筛选 | Modify |
| `src/web-ui/src/components/proxy/ProxyRequestList.tsx` | 列表按 `sourceFilter` 过滤 | Modify |
| `tests/unit/worker/context/SessionCaptureBridge.test.ts` | 源头过滤 RED/GREEN | Modify |
| `tests/unit/worker/CollectorContextProvider.test.ts` | 判定器透传 + 过滤行为 | Modify |

---

### Task 1: CDP 源头过滤（只捕选中 tab）

**Files:**
- Modify: `src/worker/context/SessionCaptureBridge.ts`
- Modify: `src/worker/context/CollectorContextProvider.ts`
- Modify: `src/worker/ToolContext.ts`
- Test: `tests/unit/worker/context/SessionCaptureBridge.test.ts`
- Test: `tests/unit/worker/CollectorContextProvider.test.ts`

**Interfaces:**
- Consumes:
  - `patchright` 的 `Response.frame(): Frame`（types.d.ts:21415）与 `Frame.page(): Page`（:7436），已核实类型完备。
  - `BrowserContextProvider.getSelectedPage(): Page | null`（`src/worker/context/BrowserContextProvider.ts:205`）。
- Produces:
  - `SessionCaptureBridge` 构造器新增第三参 `isSelectedPage?: (page: Page) => boolean`（可选，缺省不过滤）。
  - `CollectorContextProvider` 构造器新增第二参 `isSelectedPage?: (page: Page) => boolean`，透传给 bridge。
  - `ToolContext` 用 `page => this._browserContext.getSelectedPage() === page` 注入。

- [ ] **Step 1: 写失败测试（SessionCaptureBridge 源头过滤）**

在 `tests/unit/worker/context/SessionCaptureBridge.test.ts` 顶部补 import：把 `import type {BrowserContext, Response} from 'patchright';` 改成 `import type {BrowserContext, Page, Response} from 'patchright';`。

扩展现有 `makeResponse`（`:50-67`）与新增 `makePage` 辅助：

```ts
function makePage(id: string): Page {
  return {id} as unknown as Page;
}

function makeResponse(
  overrides: Partial<{url: string; body: string; page: Page}> = {},
): Response {
  const headers = {'content-type': 'application/json'};
  const request = {
    method: () => 'GET',
    url: () => overrides.url ?? 'https://a.dev/api/sign',
    headers: () => ({cookie: 'x=1'}),
    postData: () => null,
  };
  return {
    status: () => 200,
    headers: () => headers,
    request: () => request,
    url: () => overrides.url ?? 'https://a.dev/api/sign',
    frame: () => ({page: () => overrides.page}),
    text: async () => overrides.body ?? '{"ok":true}',
  } as unknown as Response;
}
```

在 `describe('SessionCaptureBridge', ...)` 末尾（最后的 `});` 之前）追加三个用例：

```ts
  it('drops responses from pages other than the selected one', async () => {
    const {engine, manager} = makeEngine();
    const {context, emit} = makeContext();
    const selected = makePage('page-selected');
    const other = makePage('page-other');
    const bridge = new SessionCaptureBridge(
      () => engine,
      {},
      page => page === selected,
    );

    bridge.attach(context);
    emit(makeResponse({page: other}));
    await flush();

    assert.strictEqual(manager.getActiveSession(), null, '非选中页不落库、不建会话');
    assert.strictEqual(bridge.getDroppedCount(), 0, '源头过滤不是故障，不计 dropped');
  });

  it('ingests responses from the selected page', async () => {
    const {engine, manager} = makeEngine();
    const {context, emit} = makeContext();
    const selected = makePage('page-selected');
    const bridge = new SessionCaptureBridge(
      () => engine,
      {},
      page => page === selected,
    );

    bridge.attach(context);
    emit(makeResponse({page: selected}));
    await flush();

    const session = manager.getActiveSession();
    assert.ok(session, '选中页必须正常落库');
    assert.strictEqual(manager.getRequests(session.id).length, 1);
  });

  it('drops the response when frame() throws (disposed response)', async () => {
    const {engine, manager} = makeEngine();
    const {context, emit} = makeContext();
    const bridge = new SessionCaptureBridge(() => engine, {}, () => true);
    const response = {
      ...makeResponse(),
      frame: () => {
        throw new Error('response disposed');
      },
    } as unknown as Response;

    bridge.attach(context);
    emit(response);
    await flush();

    assert.strictEqual(manager.getActiveSession(), null);
    assert.strictEqual(bridge.getDroppedCount(), 0);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/worker/context/SessionCaptureBridge.test.js
```

Expected: 新增的 3 个用例失败——`new SessionCaptureBridge(...)` 第三个参数 TS 不报（swc 容忍），但 `isSelectedPage` 字段不存在，非选中页的响应仍会入库 → `manager.getActiveSession()` 不是 `null`，断言 `strictEqual(null)` 红。既有 7 个用例仍 PASS（它们不传第三参，走无过滤路径）。

- [ ] **Step 3: 实现 `SessionCaptureBridge` 源头过滤**

`src/worker/context/SessionCaptureBridge.ts`：

1. 顶部 import 加 `Page`：`import type {BrowserContext, Page, Response} from 'patchright';`
2. 构造器加第三参：

```ts
  constructor(
    private readonly getEngine: () => CaptureEngine | undefined,
    private readonly opts: SessionCaptureBridgeOptions = {},
    private readonly isSelectedPage?: (page: Page) => boolean,
  ) {}
```

3. `ingest()` 在 `try` 之前插入过滤块：

```ts
  private async ingest(response: Response): Promise<void> {
    // 源头过滤（spec §4）：非选中 tab 的响应在取体前直接丢弃。
    // 放 try 之外：这是「有意过滤」不是「摄入故障」，不进 dropped 计数。
    if (this.isSelectedPage) {
      try {
        if (!this.isSelectedPage(response.frame().page())) return;
      } catch {
        // frame()/page() 抛 = 响应已 dispose，无法归属；保守丢弃，避免全局噪声。
        return;
      }
    }
    try {
      const engine = this.getEngine();
      if (!engine) return;
      const input: CapturedRequestInput = await fromCdpResponse(response, {
        ...(this.opts.now ? {now: this.opts.now} : {}),
        ...(this.captureBodyEnabled() ? {} : {readBody: skipBody}),
      });
      engine.ingestRequest(input);
    } catch (error) {
      this.dropped += 1;
      logger.warn(
        `[SessionCaptureBridge] CDP 响应摄入失败，已丢弃第 ${this.dropped} 条`,
        error,
      );
    }
  }
```

> 保留既有 try/catch 与注释一字不动（`getEngine()` 已在 try 内，切片 2 的「engine 获取失败计 dropped」回归保障不受影响）。

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2。

Expected: 10 个用例全 PASS（既有 7 + 新 3）。

- [ ] **Step 5: 透传判定器 —— `CollectorContextProvider`**

`src/worker/context/CollectorContextProvider.ts` 构造器（`:49-53`）：

```ts
  constructor(
    getCaptureEngine: () => CaptureEngine | undefined = () => undefined,
    isSelectedPage?: (page: Page) => boolean,
  ) {
    this._captureBridge = new SessionCaptureBridge(
      getCaptureEngine,
      {},
      isSelectedPage,
    );
  }
```

> `Page` 已在该文件 import 列表内（`:16` `import type {BrowserContext, ConsoleMessage, Page, Request} from 'patchright';`），无需新增。

- [ ] **Step 6: 写失败测试（CollectorContextProvider 透传）**

在 `tests/unit/worker/CollectorContextProvider.test.ts` 顶部补 `Page`（`:10` `import type {BrowserContext, Response} from 'patchright';` → `import type {BrowserContext, Page, Response} from 'patchright';`）。

在 `describe` 末尾追加一个用例：

```ts
  it('filters CDP responses by selected page when a guard is provided', async () => {
    const db = new DatabaseManager(':memory:');
    const store = new SqliteSessionStore(db);
    const manager = new CaptureSessionManager(store);
    const engine = new CaptureEngine(manager, store);

    const selected = {id: 'page-sel'} as unknown as Page;
    const listeners = new Set<(response: Response) => void>();
    const context = {
      on: (event: string, handler: (response: Response) => void) => {
        if (event === 'response') listeners.add(handler);
        return context;
      },
      off: (_event: string, handler: (response: Response) => void) => {
        listeners.delete(handler);
        return context;
      },
      pages: () => [],
    } as unknown as BrowserContext;

    const provider = new CollectorContextProvider(
      () => engine,
      p => p === selected,
    );
    provider.start(context);

    const response = {
      status: () => 200,
      headers: () => ({'content-type': 'text/plain'}),
      url: () => 'https://b.dev/probe',
      frame: () => ({page: () => ({id: 'page-other'})}),
      request: () => ({
        method: () => 'GET',
        url: () => 'https://b.dev/probe',
        headers: () => ({}),
        postData: () => null,
      }),
      text: async () => 'pong',
    } as unknown as Response;
    for (const listener of [...listeners]) listener(response);
    await new Promise(resolve => setImmediate(resolve));

    assert.strictEqual(manager.getActiveSession(), null, '非选中页不建会话');
    provider.dispose();
    assert.strictEqual(listeners.size, 0, 'dispose 必须解挂 response 监听');
    db.close();
  });
```

- [ ] **Step 7: 跑测试确认失败**

Run:

```bash
npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/worker/CollectorContextProvider.test.js
```

Expected: 新用例失败——`new CollectorContextProvider(fn, guard)` 第二参当前不存在，TS 编译期会被 swc 放过，但运行期第二参被忽略 → 无过滤 → 响应落库、`getActiveSession()` 非 null，断言红。既有 4 个用例 PASS（第二参缺省 undefined）。

- [ ] **Step 8: 实现已就位（Step 5），跑测试确认通过**

Run: 同 Step 7 + 回归：

```bash
npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/worker/CollectorContextProvider.test.js build/tests/unit/worker/context/SessionCaptureBridge.test.js build/tests/unit/worker/ToolContextProvider.test.js
```

Expected: 全 PASS。`ToolContextProvider.test.js` 是关键回归——它构造真实 provider；若桥在无 runtime 时抛错，这里先红。

- [ ] **Step 9: `ToolContext` 注入判定器**

`src/worker/ToolContext.ts` 的 `_collectorContext` 字段（`:53-55`）：

```ts
  private readonly _collectorContext = new CollectorContextProvider(
    () => this._serviceLocator.getCaptureEngine(),
    page => this._browserContext.getSelectedPage() === page,
  );
```

> `_browserContext`（`:51`）声明先于 `_collectorContext`（`:53`），箭头函数延迟求值，无时序问题。

- [ ] **Step 10: 收尾门禁**

Run:

```bash
npm run typecheck
npx prettier --check src/worker/context/SessionCaptureBridge.ts src/worker/context/CollectorContextProvider.ts src/worker/ToolContext.ts tests/unit/worker/context/SessionCaptureBridge.test.ts tests/unit/worker/CollectorContextProvider.test.ts
npx eslint src/worker/context/SessionCaptureBridge.ts src/worker/context/CollectorContextProvider.ts src/worker/ToolContext.ts tests/unit/worker/context/SessionCaptureBridge.test.ts tests/unit/worker/CollectorContextProvider.test.ts
```

Expected: typecheck 零 error；prettier 零告警；eslint 零 error。

- [ ] **Step 11: 提交**

```bash
git add src/worker/context/SessionCaptureBridge.ts src/worker/context/CollectorContextProvider.ts src/worker/ToolContext.ts tests/unit/worker/context/SessionCaptureBridge.test.ts tests/unit/worker/CollectorContextProvider.test.ts
git commit -m "feat(worker): capture only the selected page's CDP traffic"
```

---

### Task 2: 前端 CDP/MITM 筛选 + tab 选择器

**Files:**
- Modify: `src/web-ui/src/stores/proxy.ts`
- Modify: `src/web-ui/src/routes/proxy.tsx`
- Modify: `src/web-ui/src/components/proxy/ProxyControlBar.tsx`
- Modify: `src/web-ui/src/components/proxy/ProxyRequestList.tsx`

**Interfaces:**
- Consumes:
  - `api.callTool(name, args)`（`src/web-ui/src/lib/api.ts:106`，返回 `CallToolResult {invocationId, traceId, result, durationMs}`）。
  - `list_pages` 工具（`src/tools/navigation/listPages.ts`）经管线返回 `result.structuredContent.data = {pageInfos: [{index, pageId, url, title}], selectedIndex, selectedPageId}`。
  - `select_page` 工具（`src/tools/navigation/selectPage.ts`）`data = {selectedIndex, selectedPageId, url, title}`，副作用是 `bringPageToFront` + 切 worker 选中页。
  - `api.getSessionRequests()`（无参返回全部 items，`sourceFilter` 是客户端过滤）。
- Produces:
  - store 新增：`sourceFilter: 'all' | 'cdp' | 'proxy'`、`pages: PageInfo[]`、`selectedPageId: string | null`、`setSourceFilter`、`loadPages`、`selectTab`。
  - `PageInfo = {pageId: string; index: number; url: string; title: string}`。

> **`callTool` 返回解析形状已核实**：`ToolExecutionRouter` 走 `defineTool` 分支 → `ToolResponseAccumulator.toJSON()` 返回 `{structuredContent: {...}}`（`src/worker/ToolResponse.ts:95-100`），`list_pages` 的 `data` 在 `structuredContent.data.pageInfos`（`src/tools/navigation/listPages.ts:82-87`）。`enrichResponse`（`ToolCallContextGuard.ts:53`）只在对象上追加字段、不替换 `data`。前端解析用 `res.result.structuredContent.data`，实施时若与实测不符，以 `console.log(res)` 实测为准，不要臆造层级。

- [ ] **Step 1: 扩展 store**

在 `src/web-ui/src/stores/proxy.ts` 里扩展 `ProxyState` 接口与实现。先补 `PageInfo` 接口（放在 `ProxyState` 之上）：

```ts
export interface PageInfo {
  pageId: string;
  index: number;
  url: string;
  title: string;
}
```

`ProxyState` 增加字段与方法：

```ts
export interface ProxyState {
  requests: SessionRequestSummaryEvent[];
  selectedId: string | null;
  selectedDetail: SessionRequestDetail | null;
  detailLoading: boolean;
  status: ProxyStatusPayload | null;
  autoScroll: boolean;
  filter: {
    search: string;
    method: string;
    statusFilter: string;
  };
  sourceFilter: 'all' | 'cdp' | 'proxy';
  pages: PageInfo[];
  selectedPageId: string | null;
  setRequests: (requests: SessionRequestSummaryEvent[]) => void;
  addRequest: (req: SessionRequestSummaryEvent) => void;
  clearRequests: () => void;
  selectRequest: (id: string | null) => Promise<void>;
  setStatus: (status: ProxyStatusPayload) => void;
  setAutoScroll: (autoScroll: boolean) => void;
  setFilter: (filter: Partial<ProxyState['filter']>) => void;
  setSourceFilter: (sourceFilter: 'all' | 'cdp' | 'proxy') => void;
  loadPages: () => Promise<void>;
  selectTab: (pageId: string) => Promise<void>;
}
```

`useProxyStore` 实现里初始化新字段，并在 `setFilter` 之后追加三个 action：

```ts
  sourceFilter: 'all',
  pages: [],
  selectedPageId: null,
```

```ts
  setSourceFilter: sourceFilter => set({sourceFilter}),

  loadPages: async () => {
    try {
      const res = (await api.callTool('list_pages', {})) as {
        result?: {
          structuredContent?: {
            data?: {
              pageInfos?: PageInfo[];
              selectedPageId?: string | null;
            };
          };
        };
      };
      const data = res?.result?.structuredContent?.data;
      const pageInfos = (data?.pageInfos ?? []) as PageInfo[];
      set({
        pages: pageInfos.map(p => ({
          pageId: p.pageId,
          index: p.index,
          url: p.url,
          title: p.title,
        })),
        selectedPageId: data?.selectedPageId ?? null,
      });
    } catch (err) {
      // 浏览器未连接时 list_pages 会抛；静默降级，不打断页面
      console.error('加载页面列表失败:', err);
    }
  },

  selectTab: async pageId => {
    try {
      // 复用 select_page 工具：bringPageToFront + 切 worker 选中页（spec §7）
      await api.callTool('select_page', {pageId});
      set({selectedPageId: pageId});
      // 切 tab 不清空（决策 C）：只重拉历史刷新列表，旧 tab 数据保留
      const res = await api.getSessionRequests();
      set({requests: res.items});
    } catch (err) {
      console.error('切换页面失败:', err);
    }
  },
```

> `setFilter` 的 `Partial<ProxyState['filter']>` 不受影响——`sourceFilter` 是独立顶层字段，不进 `filter` 对象。

- [ ] **Step 2: `routes/proxy.tsx` 挂载 `loadPages`**

`src/web-ui/src/routes/proxy.tsx` 顶部解构加 `loadPages`：

```tsx
  const {setRequests, setStatus, addRequest, loadPages} = useProxyStore();
```

在 `useEffect` 里、订阅之后加一次调用（放「Initial load」区块末尾、订阅之前）：

```tsx
    // 4. Load the initial page list for the tab selector
    void loadPages();
```

`useEffect` 的依赖数组加 `loadPages`：

```tsx
  }, [setRequests, setStatus, addRequest, loadPages]);
```

- [ ] **Step 3: `ProxyControlBar.tsx` 加 tab 下拉 + 来源筛选**

`src/web-ui/src/components/proxy/ProxyControlBar.tsx`：

1. 解构加字段：

```tsx
  const {
    status,
    autoScroll,
    filter,
    sourceFilter,
    pages,
    selectedPageId,
    setStatus,
    setAutoScroll,
    setFilter,
    setSourceFilter,
    selectTab,
    clearRequests,
  } = useProxyStore();
```

2. 顶部 action row（`:95` 起的「Left: Start/Stop + Port + Status」区块内、端口输入「Port Input」之前）插入 tab 下拉：

```tsx
          {/* Tab Selector */}
          <div className="flex items-center gap-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] px-2.5 py-1.5 rounded-xl">
            <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
              标签页:
            </span>
            <select
              value={selectedPageId ?? ''}
              onChange={e => {
                const id = e.target.value;
                if (id) void selectTab(id);
              }}
              className="bg-transparent text-xs font-mono text-[var(--color-text-primary)] focus:outline-none"
            >
              <option
                value=""
                disabled
              >
                选择页面…
              </option>
              {pages.map(p => (
                <option
                  key={p.pageId}
                  value={p.pageId}
                  className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
                >
                  {`#${p.index} ${p.title}`}
                </option>
              ))}
            </select>
          </div>
```

3. 底部 filter row（`:202` 起、「Method Filter Dropdown」之前）插入来源筛选下拉：

```tsx
        {/* Source Filter */}
        <div className="relative">
          <select
            value={sourceFilter}
            onChange={e =>
              setSourceFilter(e.target.value as 'all' | 'cdp' | 'proxy')
            }
            className="appearance-none bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] text-xs font-mono font-bold text-[var(--color-text-primary)] rounded-xl pl-3 pr-8 py-1.5 focus:outline-none focus:border-[var(--color-accent)] cursor-pointer"
          >
            <option
              value="all"
              className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
            >
              全部
            </option>
            <option
              value="cdp"
              className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
            >
              CDP
            </option>
            <option
              value="proxy"
              className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
            >
              MITM
            </option>
          </select>
          <ChevronDown
            size={12}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
          />
        </div>
```

- [ ] **Step 4: `ProxyRequestList.tsx` 按来源过滤**

`src/web-ui/src/components/proxy/ProxyRequestList.tsx`：

1. 解构加 `sourceFilter`：

```tsx
  const {requests, selectedId, autoScroll, filter, sourceFilter, selectRequest} =
    useProxyStore();
```

2. `filteredRequests` 的 `useMemo`（`:75-94`）在最前面加来源过滤，并补依赖：

```tsx
  const filteredRequests = useMemo(() => {
    return requests.filter(req => {
      if (sourceFilter !== 'all' && req.source !== sourceFilter) {
        return false;
      }
      if (
        filter.method &&
        req.method.toUpperCase() !== filter.method.toUpperCase()
      ) {
        return false;
      }
      if (filter.search) {
        const query = filter.search.toLowerCase();
        const matchesUrl = req.url.toLowerCase().includes(query);
        const matchesMethod = req.method.toLowerCase().includes(query);
        const matchesStatus = String(req.statusCode).includes(query);
        if (!matchesUrl && !matchesMethod && !matchesStatus) {
          return false;
        }
      }
      return true;
    });
  }, [requests, filter, sourceFilter]);
```

- [ ] **Step 5: 收尾门禁**

Run:

```bash
npm run web:typecheck
npm run typecheck
npx prettier --check src/web-ui/src/stores/proxy.ts src/web-ui/src/routes/proxy.tsx src/web-ui/src/components/proxy/ProxyControlBar.tsx src/web-ui/src/components/proxy/ProxyRequestList.tsx
npx eslint src/web-ui/src/stores/proxy.ts src/web-ui/src/routes/proxy.tsx src/web-ui/src/components/proxy/ProxyControlBar.tsx src/web-ui/src/components/proxy/ProxyRequestList.tsx
```

Expected: `web:typecheck` 零 error（这是前端唯一门禁，strict:true 会抓 `sourceFilter`/`pages`/`selectedPageId` 类型不一致）；prettier 零告警；eslint 零 error。

- [ ] **Step 6: 提交**

```bash
git add src/web-ui/src/stores/proxy.ts src/web-ui/src/routes/proxy.tsx src/web-ui/src/components/proxy/ProxyControlBar.tsx src/web-ui/src/components/proxy/ProxyRequestList.tsx
git commit -m "feat(web-ui): add tab selector and CDP/MITM source filter to proxy view"
```

---

### Task 3: 收尾验证

**Files:** 只读

- [ ] **Step 1: 全量相关单测对比**

Run（与 Task 1/2 同命令，确认没有回归）：

```bash
npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/worker/context/SessionCaptureBridge.test.js build/tests/unit/worker/CollectorContextProvider.test.js build/tests/unit/worker/ToolContextProvider.test.js
```

Expected: 全 PASS。

- [ ] **Step 2: 类型门禁**

Run: `npm run typecheck && npm run web:typecheck`

Expected: 双通过。

- [ ] **Step 3: 范围核对**

Run: `git diff --name-only HEAD~2..HEAD`

Expected: 恰好下列文件（两个 commit 合计）：

```
src/worker/context/SessionCaptureBridge.ts
src/worker/context/CollectorContextProvider.ts
src/worker/ToolContext.ts
src/web-ui/src/stores/proxy.ts
src/web-ui/src/routes/proxy.tsx
src/web-ui/src/components/proxy/ProxyControlBar.tsx
src/web-ui/src/components/proxy/ProxyRequestList.tsx
tests/unit/worker/context/SessionCaptureBridge.test.ts
tests/unit/worker/CollectorContextProvider.test.ts
```

若出现越界文件，`git diff HEAD~2..HEAD -- <越界文件>` 看清楚回退，不顺手修无关文件。

- [ ] **Step 4: 手工验证（不可跳过）**

1. `npm run build && npm run start` 起服务。
2. 开两个 tab（A、B），在 worker 里 `select_page` 选 A。
3. 在 A 触发几个请求，B 也触发几个请求。
   Expected: 抓包列表/`GET /api/session/requests` 只有 A 的 CDP 请求 + 若有 MITM 流量则含 MITM；B 的 CDP 请求**不出现**。
4. `select_page` 切到 B 再触发请求。
   Expected: B 的新请求出现，A 之前的数据仍在（切 tab 不清空）。
5. 前端点「MITM」筛选 → 只剩 `source=proxy` 行；点「CDP」→ 只剩 cdp 行；点「全部」→ 都有。
6. 点「清空」→ 列表清空。
7. 点 tab 下拉选择 B → 浏览器前台切到 B（`select_page` 副作用）。

Expected: 3/4/5/6/7 全成立。

- [ ] **Step 5: 收尾**

Run: `git status --porcelain`

Expected: 干净。若有输出，按 Task 归属补提交（只列对应文件，不要 `git add -A`）。