# 定位器层扩展 + 元素错误分类 — 实现计划（v2，范围已调整）

> **Goal:** 让全部 element 工具接受 `role=` / `text=` / `xpath=` 定位器（复用 patchright 原生引擎），并**统一**把「多匹配」变成立即报错 `ELEMENT_LOCATOR_AMBIGUOUS`，同时保留「0 匹配/超时」为可重试。

**范围调整（本次）：**
1. 多匹配语义 → **激进方案**：全部工具统一报歧义，不再静默取第一个。
2. 边缘工具 → **全部纳入**：video 三件套 + `monitor_events` 一并改造。

**Architecture:** 两件事，都必须做全，否则会出现「一半工具报歧义、一半静默」的不一致状态。

1. **所有元素操作用 `frame.locator()` 而非 `frame.click()`/`page.$()`/`document.querySelector`。** 只有 `locator()` 理解 `role=`/`text=`/`xpath=` **且** 默认 strict（多匹配抛错）。已验证：`frame.click` 与 `page.$` 多匹配**静默取第一个**，而 `locator` 的每一个动作 API 都抛 `strict mode violation`。
2. **在共享边界把 Playwright 错误映射为 `transient`/`permanent`**，新增 `ELEMENT_LOCATOR_AMBIGUOUS` 错误码。

**Tech Stack:** TypeScript ESM、patchright ^1.59.0（`patchright-core` 1.59.4）、Node 内置 `node:test`。

---

## 已核实的前提（本机实测，勿重复验证）

### A. 定位器引擎

| 事实 | 实测结果 |
|---|---|
| `role=` / `text=` / `xpath=` 引擎可用 | `frame.click('role=button[name="Submit"]')`、`page.click`、`page.$`、`page.type`、`waitForSelector`、`locator.fill`、`locator.hover` 全部通过 |
| **只有 `document.querySelector` 注入会炸** | `frame.evaluate(sel => document.querySelector(sel), 'role=button[...]')` → `SyntaxError: Failed to execute 'querySelector'` |
| `frame.locator()` 同时理解 CSS 与 `role=` | `.first().evaluate(fn)` 两种输入均返回正确结果 |
| `frame.locator` 穿过 `wrapFrameWithTimeout` Proxy | Proxy 只拦 `evaluate`，其余 `bind` 透传；`.locator(...).first().click()` 通过 |
| `>> nth=N` 逃逸通道已内建 | `f.locator('role=button[name="Submit"] >> nth=1').click()` 通过 —— **无需新增 `nth` 参数** |
| 逗号回退**不支持** | `f.locator('role=button, input[type=file]')` → `InvalidSelectorError`。`role=` 引擎不能与 CSS 逗号混写 |

### B. strict 语义（决定统一报歧义方案的前提）

| API | 多匹配行为 |
|---|---|
| `frame.click` / `page.click` / `page.$` / `page.type` / `waitForSelector` | **静默取第一个**（`frame.click` 后 `activeElement.id === 'a'`） |
| `locator.click` / `hover` / `fill` / `pressSequentially` / `dragTo` / `setInputFiles` / `waitFor` | **抛 `strict mode violation`** |
| `locator.boundingBox` / `isVisible` / `textContent` | **抛 `strict mode violation`** |
| `locator.count` / `evaluateAll` / `allInnerTexts` | 不抛（返回数量/全部） |
| `locator.count()` 0 匹配 | **不 auto-wait**，8ms 返回 `0` |
| `locator.boundingBox()` 0 匹配 | **auto-wait**，默认 30s 后 `TimeoutError` |

→ **结论**：只要把动作与读取都走 `locator`，就天然获得 strict 语义，无需手写「先 count 再动作」的检查。

### C. 三种失败可区分

| 情形 | 错误 | 分类 |
|---|---|---|
| 多匹配 | `Error: strict mode violation: locator('...') resolved to 2 elements` | permanent |
| 非法选择器 | `Error: Unexpected token "%" while parsing css selector` | permanent |
| 0 匹配 / 超时 | `TimeoutError: Timeout 1200ms exceeded`（`error.name === 'TimeoutError'`） | transient |

### D. 其他

- `progress.js:92` 是超时串唯一产地：`Timeout ${timeout}ms exceeded.`；判定优先用 `error.name`，正则仅兜底。
- 仓库已有同构先例可照抄：`ErrorCodes.SCRIPT_LOCATOR_AMBIGUOUS`（`src/utils/errors.ts:51`）由 `src/tools/shared/scriptResolver.ts:212-222` 抛出，带 `suggestion` + `candidates`。
- `NON_RETRYABLE_CODES`（`src/utils/errors.ts:76-81`）是**白名单式否定**：不在其中即 `retryable = true`，所以新错误码**必须显式加入**才能得到 `retryable = false`。

**构建环境注意：** `npm run build` 会在 `web:build` 挂掉（缺 `@rolldown/binding-win32-x64-msvc`，既有环境问题，与本改动无关）。全程用 `npm run build:index && npm run build:compile && npm run build:post`。基线已验证：该三步通过、`npm run typecheck` 干净、现有相关测试 8/8 通过。

---

## Global Constraints

- 全部元素操作统一走 `frame.locator(...)`，**不允许**残留 `frame.click` / `page.$` / `document.querySelector` 的元素定位路径。
- **不新增定位器参数**：消歧已由 `>> nth=N` 覆盖。
- 复用 patchright 原生引擎，**不自建** ARIA/AX 解析器。
- 错误码扩展遵循既有约定（`retryable` 由 `NON_RETRYABLE_CODES` 推导）。
- 新增测试镜像源码目录。改动测试**只允许**因为「行为契约变更」而更新，不得为了让测试变绿而放宽断言。
- 提交用 Conventional Commits，并在 body 中标注 **BREAKING CHANGE: 多匹配从静默取第一个变为报错**。

## Non-Goals

- **不做 `set_files`** 的定位器扩展：它走 CDP `DOM.querySelector`（`src/tools/input/setFiles.ts:39-42`），协议层实测报 `DOM Error`，**只接受 CSS**。只在描述里标注「仅 CSS」。
- **不做** `snapshot` / `@N` ref 体系（宿主无状态设计下跨轮失效）。
- **不做** 工具面合并、不做 code-base 编排。

---

### Task 1: 新增元素定位错误的共享分类模块

**Files:**
- Create: `src/tools/shared/elementLocator.ts`
- Test: `tests/unit/tools/shared/elementLocator.test.ts`

**Interfaces — Produces:**
- `type ElementFailureKind = 'transient' | 'permanent'`
- `classifyElementError(error: unknown): {kind: ElementFailureKind; code: ToolErrorCode; message: string; suggestion?: string}`
- `toElementError(error: unknown, context: {toolName: string; selector: string}): ToolError`

**分类规则：**

| 判据 | kind | code | suggestion |
|---|---|---|---|
| `error.name === 'TimeoutError'` 或 `/Timeout \d+ms exceeded/` | `transient` | `TIMEOUT` | 元素可能尚未渲染；可重试或先 `wait_for_element` |
| `/strict mode violation/` 或 `/resolved to (\d+) elements/` | `permanent` | `ELEMENT_LOCATOR_AMBIGUOUS` | 用 `>> nth=N` 或收紧定位器；候选数与原始消息放进 `context` |
| `/while parsing\|Unexpected token\|is not a valid selector\|InvalidSelectorError/` | `permanent` | `VALIDATION` | 定位器语法错误，提示合法形式 |
| 兜底 | `permanent` | `RUNTIME` | 透传原消息 |

**要点：**
- `TimeoutError` 判定**优先用 `error.name`**，消息正则仅兜底 —— 消息会随 Playwright 版本漂移，类名稳定。
- 方向与直觉相反，**必须在 JSDoc 里写明**：多匹配 = permanent（迫使换定位器），0 匹配/超时 = transient（自动重试）。
- 解析候选数时不依赖消息文本做业务判断，只用于填充 `context`（消息格式可能变）。

**Verification:**
```
npm run build:compile && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/shared/elementLocator.test.js
```
测试输入用**实测错误串**（见「已核实前提 C」），断言：超时串 → `retryable === true`；strict violation 串 → `code === 'ELEMENT_LOCATOR_AMBIGUOUS'` 且 `retryable === false`；`Unexpected token` 串 → `code === 'VALIDATION'`。

---

### Task 2: 登记 `ELEMENT_LOCATOR_AMBIGUOUS` 错误码

**Files:** Modify `src/utils/errors.ts`

**Produces:** `ErrorCodes.ELEMENT_LOCATOR_AMBIGUOUS === 'ELEMENT_LOCATOR_AMBIGUOUS'`

**要点：**
- 紧邻 `SCRIPT_NOT_FOUND` / `SCRIPT_LOCATOR_AMBIGUOUS`（`:50-52`）放置，保持语义分组。
- **必须显式加入 `NON_RETRYABLE_CODES`**（`:76-81`）—— 歧义重试无意义。这是白名单式否定，不加则默认 `retryable = true`。

**Verification:** `npm run typecheck`

---

### Task 3: 改造 9 处必炸点（`document.querySelector` 注入）

这些工具**今天就无法接受 `role=`**（实测抛 `SyntaxError`），是本任务的核心。

| 文件 | 行 | 现路径 | 改为 |
|---|---|---|---|
| `src/tools/dom/queryDom.ts` | `:90` | `frame.evaluate(queryOneCode, selector)` | `frame.locator(selector).first().evaluate(el => ...)` |
| `src/tools/dom/queryDom.ts` | `:133` | `frame.evaluate(queryAllCode, {selector, limit})` | `frame.locator(selector).evaluateAll((els, limit) => ...)`（`limit` 走第二参数） |
| `src/tools/page/waitForElement.ts` | `:53` | `page.evaluate(sel => document.querySelector(sel), selector)` | `page.locator(selector).first().evaluate(el => ...)` |
| `src/tools/input/fillElement.ts` | `:20`,`:27-29` | `frame.$(selector)` + `frame.evaluate` 探测 SELECT | `frame.locator(selector).first()` + `.evaluate(el => el.tagName === 'SELECT')`，填值改 `.fill()` / `.selectOption()` |
| `src/tools/input/clickAt.ts` | `:34-45` | `page.evaluate(sel => document.querySelector(sel))` | `frame.locator(selector).first().evaluate(el => ...)` |
| `src/tools/debugger/monitorEvents.ts` | `:98` | `document.querySelector(selector)` | **保留 `window`/`document` 特例**，其余分支改 `locator` —— 见下方「特别注意」 |
| `src/tools/screenshot/getVideoInfo.ts` | `:38` | `page.evaluate(sel => document.querySelector(sel))` | `page.locator(selector).first().evaluate(el => ...)` |
| `src/tools/screenshot/seekVideo.ts` | `:41` | 同上 | 同上 |
| `src/tools/screenshot/captureVideoFrame.ts` | `:70`,`:82-83` | 同上 | 同上 |

**`monitorEvents.ts` 特别注意**：它的默认 `selector` 是 `'window'`（`:42`,`:59`），并在注入代码里特判 `'window'`/`'document'`（`:93-95`）。`locator('window')` 不成立。改法：`'window'`/`'document'` 分支保持原样（用 `page.evaluate(() => ...)` 拿 `window`/`document` 对象），只有「元素分支」改成先 `page.locator(selector).first().evaluate(el => ...)` 拿元素标识、再在原注入代码里用该标识定位。**不要**把 `'window'` 塞进 `locator`。

**`fillElement.ts` 特别注意**：`isSelect` 的探测必须在 `locator` 上做（`locator().evaluate(el => el.tagName)`），否则 `role=` 会走进 `document.querySelector`。`setInputFiles` 不要在 `locator` 上调用（见 Task 4 的约束）。

**Verification:**
```
npm run build:compile && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/jshook-tools.handlers.test.js
```
`jshook-tools.handlers.test.ts:748-771` 已覆盖 `query_dom` 的 `{selector:'#x', all:false}` 与 `{selector:'.x', all:true, limit:2}`，是现成回归护栏 —— 改写后必须仍通过。

---

### Task 4: 统一动作类工具的 strict 语义（激进方案主体）

这些工具目前**能吃 `role=`，但多匹配静默取第一个**（实测 `frame.click` 后 `activeElement.id === 'a'`）。改为走 `locator` 以获得报歧义行为。

| 文件 | 现路径（静默） | 改为（strict） |
|---|---|---|
| `src/tools/input/click.ts` (`:61`) | `frame.click(selector, {clickCount, timeout})` | `frame.locator(selector).click({clickCount, timeout})` |
| `src/tools/page/clickElement.ts` | `page.click(selector)` | `page.locator(selector).click()` |
| `src/tools/input/hover.ts` (`:32`) | `page.$(selector)` → `element.hover()` | `page.locator(selector).hover()` |
| `src/tools/input/uploadFile.ts` (`:34`,`:44`,`:55`) | `page.$(selector)` → `element.setInputFiles` / `element.click` | `page.locator(selector)` → `.setInputFiles` / `.click()` |
| `src/tools/page/typeText.ts` (`:46`) | `page.type(selector, text, {delay})` | `page.locator(selector).pressSequentially(text, {delay})` |
| `src/tools/input/drag.ts` (`:33-34`) | `page.$(from/to)` → `boundingBox()` | `page.locator(from/to).boundingBox()`（**保留手动 mouse.move 路径**，勿换 `dragTo`） |
| `src/tools/page/waitForElement.ts` (`:40`) | `page.waitForSelector(selector, {timeout})` | `page.locator(selector).waitFor({state:'visible', timeout})` |

**已验证的等价性：**
- `locator.click({clickCount:2})` 与 `frame.click({clickCount:2})` 均通过 —— 双击语义不变。
- `locator.boundingBox()` 多匹配抛 strict、0 匹配 auto-wait 后超时 —— 与 `drag.ts` 现有「拿不到 box 就报错」的语义一致（`drag.ts:54-60`），但**错误码会从 `RUNTIME` 变成分类后的结果**，这是刻意的。
- `locator.pressSequentially(text, {delay})` 实测通过（`page.type` 已废弃，改用 `pressSequentially` 是官方推荐路径）。
- `locator.setInputFiles([])` 在定位到真 file input 时通过；定位到 button 时给 `Node is not an HTMLInputElement` —— 该消息含 `is not a` 但不含 `is not a valid selector`，分类器中**不要**用宽泛的 `/is not a/`，否则会误判为 `VALIDATION`。

**`uploadFile.ts` 的 filechooser 回退路径**（`:51-63`）保持两层结构不变，只把 `element.click()` 换成 `locator.click()`。

**⚠️ 必须在描述里写明 `>> nth=N`**（Task 5），否则用户遇到歧义时无路可走。

**Verification:**
```
npm run build:compile && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/input/*.test.js build/tests/unit/tools/page/*.test.js build/tests/unit/tools/jshook-tools.*.test.js
```

**预期会失败的既有测试（需按行为契约更新，不是放宽断言）：**
- `tests/unit/tools/input/click.test.ts:30-53` 的 mock 是 `frame = {click: async (selector, options) => ...}` 并断言 `calls` 里是 `{selector, options}`。改造后调用形态变为 `frame.locator(selector).click(options)`，**mock 必须补 `locator()` 返回带 `click` 的对象**，断言随之调整。
- `tests/unit/tools/input/click.test.ts:57-73`（外层 deadline 超时）的错误来自 `withOperationTimeout`，**不受影响，必须继续通过** —— 若它挂了说明改写越界。

---

### Task 5: 修正「CSS 选择器」描述并写明消歧语法

**Files:** `grep -rln "CSS 选择器\|CSS selector" src/tools --include=*.ts` 命中的 17 个文件。

**统一描述文本：**

> 定位器：CSS（`#id`、`.cls`）、`role=button[name="提交"]`、`text=登录`、`xpath=//button`。多匹配时用 `>> nth=N` 消歧。

**例外标注（必须写清限制）：**
- `src/tools/input/setFiles.ts`：**仅支持 CSS**（CDP `DOM.querySelector` 协议限制，实测 `role=` 报 `DOM Error`）。
- 全部受影响的工具：`role=` **不可与 CSS 逗号混写**（`role=button, input[type=file]` → `InvalidSelectorError`），需拆成多次调用。
- `src/tools/debugger/monitorEvents.ts`：额外说明 `window` / `document` 为保留值。

**Verification:**
```
grep -rn "CSS 选择器" src/tools --include=*.ts
```
期望：仅剩 `setFiles.ts` 一处（带「仅」注明）。

---

### Task 6: 全量验证

**Verification（按顺序，全部通过才算完成）：**

1. `npm run build:index && npm run build:compile && npm run build:post`
2. `npm run typecheck`
3. `node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/**/*.test.js build/tests/property/**/*.test.js`
4. `npm run check-format`
5. **端到端手测（真实浏览器）**：
   - 同一按钮分别用 `.btn`、`role=button[name="Submit"]`、`text=Submit` 调 `click`，三者都成功。
   - 两个同名按钮 → `click` 返回 `ELEMENT_LOCATOR_AMBIGUOUS`，`retryable === false`。
   - 用 `role=button[name="Submit"] >> nth=1` 成功点击第二个。
   - `query_dom` 对 0 匹配返回空而非报错（`count` 不 auto-wait）。
   - `wait_for_element` 对不存在元素返回 `TIMEOUT` 且 `retryable === true`。
   - `monitor_events` 用默认 `window` 仍工作。

---

## 风险与取舍

- **破坏性变更（本次范围已明确接受）**：多匹配从静默变为报错，影响 `click` / `click_element` / `hover` / `type_text` / `drag` / `upload_file` / `wait_for_element`。提交须标 `BREAKING CHANGE`。同时提供 `>> nth=N` 作为迁移路径。
- **`getByRole` 的 TS role 白名单**（`types.d.ts:2996`）不适用于本方案 —— 走字符串 `role=` 引擎，无白名单约束，也无需维护 role 列表。
- **accessible-name 算法由 patchright 提供**，与 ego 自研 AX 树不同。ego 声称的「深层 iframe」强项来自其闭源内核，本方案**不保证**等价，不作为卖点。
- **`locator.boundingBox()` 0 匹配会 auto-wait 30s**（实测），比 `page.$` 立刻返回 null 慢。`drag.ts` 改造后，源元素不存在时用户要等默认超时。**取舍**：接受（默认行为与 Playwright 一致），但若体验问题明显，可在 `drag.ts` 先 `count() > 0` 快速失败 —— 留作后续优化，本轮不做。
- **未验证**：`xpath=` 在多 iframe 场景的表现；`loc=href:` 语义（宿主无对应实现，本方案不提供）。
