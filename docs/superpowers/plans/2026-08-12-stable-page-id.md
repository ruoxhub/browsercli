# 稳定 pageId Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个进程内存活的 Patchright `Page` 分配不随页面数组重排变化的 `pageId`，同时保留全部旧 `pageIdx`/`targetPageIdx` 输入和 `index`/`selectedIndex` 输出，并让所有真实页面选择入口支持双选择器一致性校验。

**Architecture:** 页面身份状态只存在于 `BrowserContextProvider`。一个纯类型文件定义 `PageSelector`/`ResolvedPage`，所有外部页面选择都委托 `resolvePage()`；导航工具通过内部 `Context` 使用它，网络模块解析后直接持有 `Page` 对象读取 collector，避免异步等待期间索引变化导致串页。

**Tech Stack:** TypeScript ESM、Patchright `Page`/`BrowserContext`、Node.js `node:test`、Zod。

## Global Constraints

- 本计划是三阶段交付的第 2 阶段；开始前必须完成 [Target 级脚本观测计划](./2026-08-12-target-script-observation.md) 的真实 Chromium 门禁。完成本计划后再执行 [Context 持久 Hook 计划](./2026-08-12-context-persistent-hooks.md)。
- 规范来源是 [浏览器运行时基础能力设计](../specs/2026-08-12-browser-runtime-foundations-design.md)。
- `pageId` 格式固定为 `page-<单调正整数>`；同一 `Page` 对象 ID 不变，关闭后失效，编号永不复用。
- ID 只保证当前 worker 进程内稳定，不跨 BrowserContext/worker 重建持久化，不包含 URL、标题或索引。
- 不移植 TabRegistry、别名、持久化或跨进程对账。
- `pageId` 是增量字段；保留所有现有 `pageIdx`、`targetPageIdx`、`index`、`selectedIndex`。
- 两个选择器同时提供时必须解析为同一 `Page`，否则在执行副作用前失败。
- `list_network_requests.pageIdx`、console/WebSocket 的 `pageIdx` 继续只表示结果分页，不得改名或混入页面身份语义。
- 网络模块解析出 `Page` 后直接按该对象访问缓存；不得在 `await waitForRequest` 之后继续依赖一个可能已经漂移的数组索引来选择页面。
- 不新增依赖，不修改浏览器启动、反检测、Cloak、viewport 或 profile 行为。
- 工作区已有用户改动。每次提交只暂存本计划列出的文件，不格式化、还原或提交无关文件。

---

## File Map

### 新建源码

- `src/modules/browser/PageIdentity.ts`：稳定页面选择的纯类型契约，不持有状态。

### 新建测试

- `tests/unit/tools/navigation/pageIdentityTools.test.ts`：`list_pages`、`new_page`、`select_page` 的新旧字段与双选择器行为。

### 修改现有源码

- `src/worker/context/BrowserContextProvider.ts`：WeakMap、反向 Map、单调计数器、统一 reconcile 与 `resolvePage()`。
- `src/worker/ToolContext.ts`：暴露身份解析、真实 `_tabContext.pageId` 和按 `Page` 读取网络缓存的窄方法。
- `src/tools/ToolDefinition.ts`：向内部工具 Context 增加 `getPageId()` 与 `resolvePage()`。
- `src/worker/DefineToolContextFactory.ts`：映射新增 Context 方法。
- `src/tools/navigation/listPages.ts`
- `src/tools/navigation/newPage.ts`
- `src/tools/navigation/selectPage.ts`
- `src/tools/navigation/types.ts`
- `src/modules/network/NetworkTypes.ts`
- `src/modules/network/NetworkModule.ts`
- `src/tools/network/listNetworkRequests.ts`
- `src/tools/network/clearNetworkRequests.ts`

### 修改现有测试

- `tests/unit/worker/BrowserContextProvider.test.ts`
- `tests/unit/worker/ToolContextProvider.test.ts`
- `tests/unit/worker/verify_list_pages.test.ts`
- `tests/unit/tools/network/listNetworkRequests.test.ts`
- `tests/unit/tools/network/clearNetworkRequests.test.ts`

### 明确不改

- console 工具的分页 `pageIdx`
- WebSocket 工具的分页 `pageIdx`
- `src/modules/browser/SessionManager.ts`
- `src/modules/collector/CollectorContextProvider.ts` 内部稳定请求 ID 逻辑
- 所有 MCP 工具名

---

### Task 1: 用 TDD 建立 PageIdentity 契约和 Provider 唯一状态源

**Files:**

- Create: `src/modules/browser/PageIdentity.ts`
- Modify: `src/worker/context/BrowserContextProvider.ts`
- Modify: `tests/unit/worker/BrowserContextProvider.test.ts`

**Interfaces:**

```typescript
export interface PageSelector {
  pageId?: string;
  pageIdx?: number;
  fallbackToSelected?: boolean;
}

export interface ResolvedPage {
  page: Page;
  pageId: string;
  pageIdx: number;
}
```

`BrowserContextProvider` 新增：

```typescript
getPageId(page: Page): string;
resolvePage(selector: PageSelector): ResolvedPage;
getSelectedPageIndex(): number | null;
```

- [ ] **Step 1: 先写 ID 生命周期失败测试**

在 `BrowserContextProvider.test.ts` 建立可切换 `closed` 状态的 Page fake，并增加：

```typescript
it('keeps page IDs stable across reconciliation and reordering', () => {
  const provider = new BrowserContextProvider();
  const first = createPage('first');
  const second = createPage('second');

  provider.setPages([first.page, second.page] as never[]);
  const firstId = provider.getPageId(first.page as never);
  const secondId = provider.getPageId(second.page as never);

  provider.setPages([second.page, first.page] as never[]);

  assert.equal(provider.getPageId(first.page as never), firstId);
  assert.equal(provider.getPageId(second.page as never), secondId);
  assert.deepStrictEqual([firstId, secondId], ['page-1', 'page-2']);
});

it('invalidates a closed page ID and never reuses it', () => {
  const provider = new BrowserContextProvider();
  const first = createPage('first');
  provider.setPages([first.page] as never[]);
  const retiredId = provider.getPageId(first.page as never);

  first.close();
  provider.setPages([]);
  assert.throws(
    () => provider.resolvePage({pageId: retiredId}),
    /已失效.*list_pages/,
  );

  const replacement = createPage('replacement');
  provider.setPages([replacement.page] as never[]);
  assert.equal(provider.getPageId(replacement.page as never), 'page-2');
});
```

再覆盖首次分配、重复 reconcile、移出当前 Context、dispose 后旧 ID 失效以及切换 BrowserContext 后旧反向映射清除。

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/worker/BrowserContextProvider.test.js
```

Expected: 编译失败，因为身份 API 尚不存在。

- [ ] **Step 2: 创建纯 PageIdentity 类型文件**

`PageIdentity.ts` 只 import type `Page`，只导出上述两个 interface。不要创建 registry class 或全局 counter。

- [ ] **Step 3: 在 BrowserContextProvider 增加三项状态**

```typescript
private pageIds = new WeakMap<Page, string>();
private readonly pagesById = new Map<string, Page>();
private nextPageId = 1;
```

`nextPageId` 从 1 开始，任何 cleanup、Context 切换或 dispose 都不得减小或重置它。

- [ ] **Step 4: 实现唯一 reconcile 路径**

新增私有方法：

```typescript
private ensurePageId(page: Page): string;
private reconcilePages(pages: Page[]): Page[];
private wasIssuedPageId(pageId: string): boolean;
```

`reconcilePages` 严格执行：

1. 过滤 `isClosed()` 的 Page。
2. 为每个 active Page 调用 `ensurePageId`。
3. 从 `pagesById` 删除不在 active Set 的 Page。
4. 更新 `pagesList`。
5. 若 selected Page 已关闭或不在 active Set，选择第一个 active Page；没有则 `setSelectedPage(null)`。
6. 返回 `pagesList`。

`getPages()`、`setPages()`、`syncPages()`、`newPage()` 都必须调用该方法。不得在四处复制 ID 分配或 cleanup 逻辑。

`setContext(newContext)` 在 Context 对象变化时清空 `pagesById`、`pagesList` 和 selected Page，但保留单调计数器；旧 WeakMap 项可以由 GC 回收，反向解析必须立即失效。

- [ ] **Step 5: 先写统一 selector 失败测试**

覆盖：

- 只传 pageId 成功。
- 只传 pageIdx 成功。
- 两者一致成功。
- 两者指向不同 Page 时，错误同时列出 ID 和索引。
- 未知 ID 与已发放但失效 ID 使用不同消息。
- 负数、非整数和越界索引分别失败。
- 两者省略且 `fallbackToSelected=false/undefined` 时失败。
- 两者省略且 `fallbackToSelected=true` 时返回 selected Page。
- selected Page 已失效时不能 fallback 到旧对象。

- [ ] **Step 6: 实现 resolver，并让旧索引入口委托它**

`wasIssuedPageId` 只解析严格的 `^page-(\d+)$`，编号满足 `1 <= n < nextPageId` 才算曾经发放；因此无需新增 retired ID 集合。

解析顺序固定：

1. 调用 `getPages()` 完成 reconcile。
2. 独立解析 pageId。
3. 独立解析 pageIdx。
4. 两者都有时比较对象 identity。
5. 都没有时按 `fallbackToSelected` 决定。
6. 返回当前数组中的最终 `pageIdx` 与 stable `pageId`。

错误文案必须可区分：

```text
未知页面 ID <id>，请重新调用 list_pages
页面 ID <id> 已失效，请重新调用 list_pages
页面索引 <idx> 超出范围（共 <count> 个页面）
pageId <id> 与 pageIdx <idx> 指向不同页面
未提供 pageId 或 pageIdx
当前没有选中的页面，请先调用 new_page 或 select_page
```

旧方法只保留一行委托：

```typescript
getPageByIdx(idx: number): Page {
  return this.resolvePage({pageIdx: idx}).page;
}
```

- [ ] **Step 7: 运行 Provider 测试**

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/worker/BrowserContextProvider.test.js
```

Expected: PASS。

- [ ] **Step 8: 提交 Task 1**

```powershell
git add src/modules/browser/PageIdentity.ts src/worker/context/BrowserContextProvider.ts tests/unit/worker/BrowserContextProvider.test.ts
git commit -m "feat(browser): assign stable page identities"
```

---

### Task 2: 将身份解析接入内部工具 Context 与 `_tabContext`

**Files:**

- Modify: `src/tools/ToolDefinition.ts`
- Modify: `src/worker/DefineToolContextFactory.ts`
- Modify: `src/worker/ToolContext.ts`
- Modify: `tests/unit/worker/ToolContextProvider.test.ts`

**Interfaces:**

`Context` 增加：

```typescript
getPageId(page: Page): string;
resolvePage(selector: PageSelector): ResolvedPage;
```

`ToolContextProvider` 增加同名方法及 `getSelectedPageIndex()`。

- [ ] **Step 1: 先写 ToolContextProvider 失败测试**

增加以下回归：

- `setPages` 后 `getPageId` 返回 `page-1`/`page-2`。
- 页面重排后 `getContextMeta().pageId` 不变，但 `tabIndex` 更新。
- 未选中 Page 时 `pageId=null`、`tabIndex=null`。
- `getSelectedPageIndex()` 返回当前 reconcile 后索引，失效时返回 null。
- `resolvePage()` 是 BrowserContextProvider 的同一语义，不在 ToolContext 复制逻辑。

关键断言：

```typescript
runtime.setPages([first as never, selected as never]);
runtime.setSelectedPage(selected as never);
const stableId = runtime.getContextMeta().pageId;

runtime.setPages([selected as never, first as never]);

assert.equal(runtime.getContextMeta().pageId, stableId);
assert.equal(runtime.getContextMeta().tabIndex, 0);
```

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/worker/ToolContextProvider.test.js
```

Expected: 新断言失败，因为 `_tabContext.pageId` 仍是 `String(tabIndex)`。

- [ ] **Step 2: 添加一行委托方法**

在 `ToolContextProvider` 添加：

```typescript
getPageId(page: Page): string {
  return this._browserContext.getPageId(page);
}

resolvePage(selector: PageSelector): ResolvedPage {
  return this._browserContext.resolvePage(selector);
}

getSelectedPageIndex(): number | null {
  const page = this.getSelectedPage();
  if (!page) return null;
  const index = this.getPages().indexOf(page);
  return index >= 0 ? index : null;
}
```

- [ ] **Step 3: 修正 Context metadata**

`getContextMeta()` 只在 selected Page 仍属于 reconcile 后数组时读取 ID：

```typescript
const pageId =
  page && tabIndex !== null && tabIndex >= 0 ? this.getPageId(page) : null;
```

返回 `{url,title:null,tabIndex,pageId}`；不再使用 `String(tabIndex)`。

- [ ] **Step 4: 扩展 ToolDefinition 和 factory**

`ToolDefinition.ts` 使用 type-only import 引入 `PageSelector`/`ResolvedPage`；`DefineToolContextFactory.create()` 映射：

```typescript
getPageId: page => provider.getPageId(page),
resolvePage: selector => provider.resolvePage(selector),
```

保持 `getPageByIdx`，供旧工具和调用方继续使用。

- [ ] **Step 5: 运行 worker 聚焦测试**

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/worker/BrowserContextProvider.test.js build/tests/unit/worker/ToolContextProvider.test.js build/tests/unit/worker/verify_list_pages.test.js
```

Expected: PASS。

- [ ] **Step 6: 提交 Task 2**

```powershell
git add src/tools/ToolDefinition.ts src/worker/DefineToolContextFactory.ts src/worker/ToolContext.ts tests/unit/worker/ToolContextProvider.test.ts
git commit -m "refactor(worker): expose stable page resolution"
```

---

### Task 3: 兼容升级 list/new/select 页面工具

**Files:**

- Modify: `src/tools/navigation/listPages.ts`
- Modify: `src/tools/navigation/newPage.ts`
- Modify: `src/tools/navigation/selectPage.ts`
- Modify: `src/tools/navigation/types.ts`
- Create: `tests/unit/tools/navigation/pageIdentityTools.test.ts`
- Modify: `tests/unit/worker/verify_list_pages.test.ts`

**Interfaces:**

- `list_pages`: 每项新增 `pageId`，data 新增 `selectedPageId`。
- `new_page`: data 新增 `pageId`，保留 `index`。
- `select_page`: `pageId?`/`pageIdx?` 至少一个；data 返回 `selectedPageId`/`selectedIndex`。

- [ ] **Step 1: 先写三个工具的失败测试**

`pageIdentityTools.test.ts` 用最小 mock Context 覆盖：

- `list_pages` 每项同时返回 `index` 和 `pageId`。
- selected Page 在数组重排后 `selectedPageId` 不变，`selectedIndex` 改变。
- 空页面返回 `selectedPageId:null`，并保留 `selectedIndex:-1`。
- `new_page` 返回新 Page 的 `pageId` 与 `index`。
- `select_page({pageIdx})` 旧调用成功。
- `select_page({pageId})` 新调用成功。
- 两者一致成功。
- 两者冲突在 `bringPageToFront`、`selectPage` 前失败。
- 两者都省略时返回 `success:false`，提示至少提供一个 selector。

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/tools/navigation/pageIdentityTools.test.js build/tests/unit/worker/verify_list_pages.test.js
```

Expected: 新测试失败，现有响应没有 pageId。

- [ ] **Step 2: 修改 list_pages**

页面条目类型与 push 内容改为：

```typescript
const pageInfos: Array<{
  index: number;
  pageId: string;
  url: string;
  title: string;
}> = [];

pageInfos.push({
  index,
  pageId: context.getPageId(page),
  url: page.url(),
  title,
});
```

统一计算：

```typescript
const selectedIndex = selectedPage ? pages.indexOf(selectedPage) : -1;
const selectedPageId =
  selectedPage && selectedIndex >= 0 ? context.getPageId(selectedPage) : null;
```

有页面和空页面两条响应都返回 `selectedPageId`。

- [ ] **Step 3: 修改 new_page**

导航完成并刷新 pages 后：

```typescript
const pageId = context.getPageId(page);
```

data 返回 `{index: pageIndex, pageId, url, title}`。预加载 hook 的既有逻辑不在本阶段改变。

- [ ] **Step 4: 修改 select_page schema 和 handler**

schema：

```typescript
pageId: zod
  .string()
  .min(1)
  .optional()
  .describe('稳定页面 ID（从 list_pages 获取）。'),
pageIdx: zod
  .number()
  .int()
  .min(0)
  .optional()
  .describe('兼容页面索引（从 list_pages 获取）。'),
```

`defineTool` 只接收字段 shape，无法表达“至少一个”的 object refine，因此 handler 必须在任何浏览器副作用前显式检查：

```typescript
if (pageId === undefined && pageIdx === undefined) {
  response.setStructuredContent({
    success: false,
    message: '请至少提供 pageId 或 pageIdx',
    tooltype: 'select_page',
    data: {},
  });
  return;
}
```

随后只调用一次：

```typescript
const resolved = context.resolvePage({pageId, pageIdx});
```

成功响应使用 `resolved.pageId` 与 `resolved.pageIdx`；错误响应保留解析器的可操作消息。不要先按索引取 Page 再校验 ID。

- [ ] **Step 5: 同步 navigation 类型**

`SelectPageParams` 两字段可选；`PageInfo`、`ListPagesData`、`SelectPageData`、`NewPageData` 增加规范中的 stable ID 字段。`ListPagesData` 使用真实响应字段名 `pageInfos`，不继续写已经与实现不一致的 `pages`。

- [ ] **Step 6: 运行导航工具测试**

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/tools/navigation/pageIdentityTools.test.js build/tests/unit/worker/verify_list_pages.test.js
```

Expected: PASS；旧 pageIdx 用例仍通过。

- [ ] **Step 7: 提交 Task 3**

```powershell
git add src/tools/navigation/listPages.ts src/tools/navigation/newPage.ts src/tools/navigation/selectPage.ts src/tools/navigation/types.ts tests/unit/tools/navigation/pageIdentityTools.test.ts tests/unit/worker/verify_list_pages.test.ts
git commit -m "feat(navigation): accept stable page ids"
```

---

### Task 4: 让网络页面选择支持 pageId 且不受 await 后索引漂移影响

**Files:**

- Modify: `src/modules/network/NetworkTypes.ts`
- Modify: `src/modules/network/NetworkModule.ts`
- Modify: `src/worker/ToolContext.ts`
- Modify: `src/tools/network/listNetworkRequests.ts`
- Modify: `src/tools/network/clearNetworkRequests.ts`
- Modify: `tests/unit/tools/network/listNetworkRequests.test.ts`
- Modify: `tests/unit/tools/network/clearNetworkRequests.test.ts`
- Modify: `tests/unit/worker/ToolContextProvider.test.ts`

**Interfaces:**

`NetworkServices` 增加：

```typescript
resolvePage(selector: PageSelector): ResolvedPage;
getNetworkRequestsForPage(
  page: Page,
  includePreservedRequests?: boolean,
): HTTPRequest[];
clearNetworkRequestsForPage(page: Page): void;
```

参数和响应增加：

```typescript
targetPageId?: string;
```

成功响应中的 `targetPageId` 是 `string`；失败数据没有可解析页面时使用 `null`。

- [ ] **Step 1: 先写 ToolContext 按 Page 对象读取失败测试**

在 `ToolContextProvider.test.ts` 现有多页面网络用例旁增加：

```typescript
assert.deepStrictEqual(
  runtime.getNetworkRequestsForPage(targetPage as never, false),
  [targetRequest],
);
runtime.clearNetworkRequestsForPage(targetPage as never);
assert.deepStrictEqual(
  runtime.getNetworkRequestsForPage(targetPage as never, false),
  [],
);
```

Expected: 编译失败，因为两个窄方法尚不存在。

- [ ] **Step 2: 添加两个一行 collector adapter**

```typescript
getNetworkRequestsForPage(
  page: Page,
  includePreservedRequests?: boolean,
): HTTPRequest[] {
  return this._collectorContext.getNetworkRequests(
    page,
    includePreservedRequests,
  );
}

clearNetworkRequestsForPage(page: Page): void {
  this._collectorContext.clearNetworkRequests(page);
}
```

保留现有按 index 的 `getNetworkRequests`/`clearNetworkRequests`，避免破坏其他内部调用；NetworkModule 新路径不再使用它们选择 stable-ID 页面。

- [ ] **Step 3: 先写 NetworkModule selector 失败测试**

更新两个测试文件的 `createMockServices`，让它提供 `resolvePage`、`getNetworkRequestsForPage`、`clearNetworkRequestsForPage`。新增断言：

- 只传 `targetPageId` 可选择正确 Page。
- 只传 `targetPageIdx` 继续成功。
- 两者一致成功，响应同时返回最终 ID/index。
- 两者冲突失败，collector 未被读取或清空。
- 两者省略时以 `fallbackToSelected=true` 解析当前页。
- 未知/失效 ID 的消息原样返回。
- `pageIdx` 仍只控制请求结果分页。
- `waitForRequest` 期间重排 `getPages()`，读取始终使用最初解析出的同一个 Page 对象。
- clear 按 `Page` 清空，不把 stable ID 再降级成漂移的 index。

等待期间重排用例形状：

```typescript
let pages = [firstPage, targetPage];
let reads = 0;
const services = createMockServices({
  resolvePage: () => ({page: targetPage, pageId: 'page-2', pageIdx: 1}),
  getNetworkRequestsForPage: page => {
    assert.equal(page, targetPage);
    reads += 1;
    pages = [targetPage, firstPage];
    return reads > 1 ? [matchingRequest] : [];
  },
  getPages: () => pages as never[],
});
```

- [ ] **Step 4: 修改 NetworkTypes**

- `ListNetworkRequestsParams`、`ClearNetworkRequestsParams` 增加 `targetPageId?: string`。
- `ListNetworkRequestsData`、`ClearNetworkRequestsData` 增加 `targetPageId: string | null`。
- 为 `NetworkServices` 增加上述三个必需方法。
- 保留旧 index 方法，供非 stable-ID 内部调用兼容。

- [ ] **Step 5: 用统一 resolver 替换 NetworkModule 的私有索引解析**

删除 `resolvePageIdx()`，新增：

```typescript
private resolveTargetPage(
  services: NetworkServices,
  selector: {targetPageId?: string; targetPageIdx?: number},
): ResolvedPage {
  return services.resolvePage({
    pageId: selector.targetPageId,
    pageIdx: selector.targetPageIdx,
    fallbackToSelected:
      selector.targetPageId === undefined &&
      selector.targetPageIdx === undefined,
  });
}
```

`listRequests()` 在第一个 await 前解析一次，并保存 `ResolvedPage`。后续筛选、超时轮询和最终读取都调用：

```typescript
services.getNetworkRequestsForPage(resolved.page, includePreserved);
```

`waitForMatchingRequest` options 改为携带 `targetPage: Page`，不再携带 index。`clearRequests()` 同理调用 `clearNetworkRequestsForPage(resolved.page)`。

`emptyPageData` 增加 `targetPageId` 参数。若 selector 解析前失败，返回 `targetPageId:null`；若下游 collector 失败，返回已经解析出的 ID/index。

- [ ] **Step 6: 增加两个工具 schema 字段**

`listNetworkRequests.ts` 与 `clearNetworkRequests.ts` 增加：

```typescript
targetPageId: zod
  .string()
  .min(1)
  .optional()
  .describe('稳定浏览器页面 ID。可与 targetPageIdx 同时提供以校验一致性。'),
```

明确保持 `list_network_requests.pageIdx` 描述为结果分页页码。

- [ ] **Step 7: 运行网络与 worker 聚焦测试**

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/tools/network/listNetworkRequests.test.js build/tests/unit/tools/network/clearNetworkRequests.test.js build/tests/unit/worker/ToolContextProvider.test.js
```

Expected: PASS；等待请求的重排测试证明读取对象 identity 不变。

- [ ] **Step 8: 提交 Task 4**

```powershell
git add src/modules/network/NetworkTypes.ts src/modules/network/NetworkModule.ts src/worker/ToolContext.ts src/tools/network/listNetworkRequests.ts src/tools/network/clearNetworkRequests.ts tests/unit/tools/network/listNetworkRequests.test.ts tests/unit/tools/network/clearNetworkRequests.test.ts tests/unit/worker/ToolContextProvider.test.ts
git commit -m "feat(network): resolve pages by stable identity"
```

---

### Task 5: 阶段 2 最终兼容性和 diff 验证

**Files:**

- Verify only; no planned source changes.

- [ ] **Step 1: 搜索真实页面 selector，确认没有遗漏或误改分页**

```powershell
rg -n "targetPageIdx|select_page|resolvePage\(|getPageByIdx\(" src/tools src/modules src/worker
rg -n "pageIdx" src/tools/console src/tools/network/getMessages.ts src/tools/network/listConnections.ts
```

Expected:

- `select_page`、`list_network_requests.targetPageIdx`、`clear_network_requests.targetPageIdx` 均有 stable ID 对应字段。
- console/WebSocket 的 `pageIdx` 仍只作为分页字段。
- 旧 `getPageByIdx` 只委托统一 resolver。

- [ ] **Step 2: 运行聚焦测试**

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/worker/BrowserContextProvider.test.js build/tests/unit/worker/ToolContextProvider.test.js build/tests/unit/worker/verify_list_pages.test.js build/tests/unit/tools/navigation/pageIdentityTools.test.js build/tests/unit/tools/network/listNetworkRequests.test.js build/tests/unit/tools/network/clearNetworkRequests.test.js
```

Expected: PASS。

- [ ] **Step 3: 运行最终项目检查**

```powershell
npm run typecheck
npm run test:unit
npm run test:integration
npm run check-format
```

Expected: 全部 PASS，且结果来自最后一次代码修改之后。

- [ ] **Step 4: 检查 diff 和用户工作区**

```powershell
git diff --check
git status --short
```

Expected: 无 whitespace error；本阶段文件没有未提交修改，用户原有脏文件保持原状。

## 阶段 2 完成门槛

- 同一 Page 在任意数组重排后 `pageId` 不变。
- 页面关闭或离开当前 Context 后旧 ID 不能解析，新 Page 不复用旧 ID。
- `list_pages`、`new_page`、`select_page` 同时提供稳定 ID 与旧索引兼容字段。
- network 的 stable ID、index 和结果分页三种语义没有混淆。
- 双选择器冲突在任何页面或 collector 副作用前失败。
- `_tabContext.pageId` 不再等于可变索引字符串。
