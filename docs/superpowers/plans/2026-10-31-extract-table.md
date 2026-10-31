# Extract Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供 `extract_table` MCP 工具，从当前选中 Frame 的 HTML table 或 ARIA table/grid 中提取稳定列、数据行及合并单元格信息，并可导出 CSV。

**Architecture:** 在选中 Frame 的隔离执行上下文中运行只读采集器，利用浏览器 DOM/ARIA 属性生成原始单元格事实，再用纯 TypeScript 函数归一化为二维矩阵。MCP 适配器只负责参数、结果和可选 CSV 文件输出；不引入依赖，不修改页面，不启用 Debugger 域。

**Tech Stack:** TypeScript ESM、Zod、Patchright/CDP、Node.js `node:test`。

**Spec:** `docs/adr/0002-adopt-structured-extraction-and-operation-evidence.md`、`GLOSSARY.md` 的 Structured Extraction；行为参考 `open-source/BrowserSkill/docs/structured-extraction.md`，但不复制其扩展连接层或 session/target 机制。

## Global Constraints

- 首个交付仅实现 `extract_table`，不夹带列表发现、操作证据链或复合动作工具。
- 使用 `ToolCategory.DATA` 和 `src/tools/data/manifest.ts`，manifest 为 `profile: 'full'`；通过 `npm run build:index` 更新生成索引，不手改生成文件。
- 输入为 `{selector: string, format?: 'json' | 'csv', outputPath?: string, includeHidden?: boolean}`；`selector` 必填且只接受 CSS，避免多目标猜测。
- JSON 为默认格式；`format: 'csv'` 时 `outputPath` 必填；JSON 与显式 `outputPath` 组合也可导出对应 `.json` 文件。写文件使用 Node `writeFile`（与 `wasm_dump` 一致），不使用 worker 模式下会抛错的 `context.saveFile`。
- JSON 合同为 `schemaVersion: 1, kind: 'table', source, columns, rows, spans, coverage, warnings`。`columns[].key` 为 `c1...cN`；每行是列 key 到 `string | null` 的记录。
- 表格仅针对当前选中 Frame；OOPIF 通过现有 `select_frame` 流程处理。隐藏容器始终拒绝；默认跳过隐藏行/单元格，`includeHidden: true` 时包含。
- 无匹配返回 `NOT_FOUND`，多个匹配或选择器未指向支持的表格返回 `VALIDATION`；运行时/CDP 失败返回 `RUNTIME`，保留已有 `ToolError`。
- 被动读取不得点击、滚动、聚焦、翻页、安装 observer、写入页面 storage 或保留 JS/CDP 资源。
- 首期用可复现单元测试证明表格矩阵、选择器错误与 CDP 生命周期；真实 Chromium DOM 验收单独报告，不以 mock 结果代替浏览器通过结论。

## Review Focus

- 合并单元格：被 `rowspan`/`colspan` 覆盖的位置必须为 `null`，不能复制锚点文本（Task 1 矩阵测试）。
- 表头歧义：重复/空表头不能覆盖其他列，必须生成稳定列名并给 warning（Task 1 表头测试）。
- 选择器与可见性：嵌套表格不能被子选择器误算进父表，隐藏行默认不能进入结果（Task 1、2 测试）。
- 输出边界：CSV 的逗号、引号、CR/LF 必须正确转义，不能因写文件丢失结构化结果（Task 2、3 测试）。
- 资源清理：成功和异常路径都必须释放 isolated world 与 CDP session，不得关闭或改动其他工具共享的 CDP 域（Task 2 测试）。

---

### Task 1: 表格事实归一化与 CSV 编码

**Files:**
- Create: `src/tools/data/extractTableModel.ts`
- Create: `src/tools/data/types.ts`
- Test: `tests/unit/tools/data/extractTableModel.test.ts`

**Interfaces:**
- Produces: `ExtractedTable`、`ExtractColumn`、`ExtractSpan`、`RawTableCapture`、`RawTableRow`、`RawTableCell` 类型。
- `ExtractedTable` 保留 `RawTableCapture.source`，其字段为 `pageUrl/frameUrl/title/selector`。
- Produces: `normalizeTable(raw: RawTableCapture): ExtractedTable`；输入为浏览器采集的行/单元格事实，输出规范列、行、span 与 warnings。
- Produces: `encodeCsv(table: ExtractedTable): string`；按 `columns` 顺序输出展示列名和行值，并转义 CSV 特殊字符。
- `RawTableCell` 至少含 `text: string`, `header: boolean`, `rowSpan: number`, `colSpan: number`, `headers: string[]`, `scope: string`, `id: string`；`RawTableRow` 至少含 `kind: 'header' | 'data' | 'footer'` 与 `cells`。

- [ ] **Step 1: 写合并单元格与多级表头的失败测试**

建立两列表格：首行 `Group` 跨两列，第二行 `Name`/`Value`，数据首行 `A` 跨两行，下一行只有 `B`。断言两列 key 为 `c1/c2`，列名包含层级路径，span 锚点记录 `rowSpan/colSpan`，被覆盖位置为 `null` 而不是重复 `A` 或 `Group`。

- [ ] **Step 2: 写重复表头、空表头与 CSV 的失败测试**

重复 `Name`、空白 `th` 必须生成不冲突且稳定的列名，并产生可诊断 warning。CSV 值 `a,b`、含双引号文本及 `line1\r\nline2` 必须按 RFC 4180 风格引用，空覆盖单元格输出空字段。

- [ ] **Step 3: 运行模型测试并确认因模块不存在而失败**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/data/extractTableModel.test.js`
Expected: FAIL，无法加载 `src/tools/data/extractTableModel.js`。

- [ ] **Step 4: 实现最小矩阵归一化和 CSV 编码**

用 active-span 占用表逐行填充逻辑列；不通过 ARIA 显式索引、跨 rowgroup 复杂合并等未确定能力。从 column headers 构造 `headerPath`，保留 `spans`，按固定 key 生成行记录；仅用字符串 escaping 实现 CSV，不添加库。

- [ ] **Step 5: 重跑模型测试并确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/data/extractTableModel.test.js`
Expected: PASS，合并单元格、稳定列名和 CSV escaping 全部满足。

### Task 2: 只读 Frame 采集与资源清理

**Files:**
- Create: `src/tools/data/extractTablePage.ts`
- Modify: `src/tools/script/script.ts`（仅导出既有 `resolveSelectedFrameId`）
- Test: `tests/unit/tools/data/extractTablePage.test.ts`

**Interfaces:**
- Consumes: `RawTableCapture` from Task 1。
- Produces: `captureTable(frame: Frame, options: {selector: string; includeHidden: boolean}): Promise<RawTableCapture>`。
- 采集器返回 `source: {pageUrl, frameUrl, title, selector}` 与原始行；无匹配、多匹配、非表格目标以带原因的失败返回/异常交给适配器。
- 浏览器执行使用专用 `Page.createIsolatedWorld` + `Runtime.evaluate(returnByValue: true)`；表达式为 `(${collectTableDom.toString()})(options)`，不改用默认 world 或 `evaluateInPageRuntime` 的 `Runtime.enable`。`frame.page().context().newCDPSession(frame.page())` 只创建本工具持有的 session。
- 取 CDP `frameId` 复用 `src/tools/script/script.ts:97-136` 的 `resolveSelectedFrameId` 思路（`page.frames()` 索引 + `Page.getFrameTree` DFS）；Task 2 将该函数改为导出并在 `extractTablePage.ts` 复用，不复制第二份实现。不得使用 `_guid` 作为 CDP frameId。

- [ ] **Step 1: 写采集器 DOM 行为的失败测试**

将纯 `collectTableDom` 通过函数序列化在 fake CDP 的 VM DOM harness 执行，断言 native table 的 `rowSpan/colSpan`、隐藏行默认排除/`includeHidden` 包含，以及 `[role="grid"]` 的 `row/cell/columnheader` 采集。该 harness 只证明采集算法；真实 Chromium DOM 行为留在 Task 3 Step 6 验收，不把 fake DOM 结果描述成浏览器测试。

- [ ] **Step 2: 写选择与资源生命周期失败测试**

覆盖 0 个、2 个匹配和选择普通 `div`；断言 isolated world 创建参数含专用 world 名，Runtime 调用 `returnByValue: true`，成功和抛出异常都会 detach 本工具新建的 CDP session。不得调用 `Page.enable`、`Runtime.enable` 或 `Debugger.enable`。

- [ ] **Step 3: 运行采集测试并确认 RED**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/data/extractTablePage.test.js`
Expected: FAIL，因采集模块不存在。

- [ ] **Step 4: 实现一次性只读采集**

`querySelectorAll(selector)` 必须恰好匹配一个 `table` 或 `role=table/grid`；采集时使用 `HTMLTableElement.rows/cells` 与 ARIA role 受限遍历，过滤嵌套表格后代。读取 `innerText`/`textContent`、headers/scope 和原生 span 属性；不引入持久状态。

- [ ] **Step 5: 重跑采集测试并确认 GREEN**

Run: 与 Step 3 相同。
Expected: PASS；所有 CDP 资源在成功/失败路径释放。

### Task 3: MCP 工具、文件输出与注册闭环

**Files:**
- Create: `src/tools/data/extractTable.ts`
- Create: `src/tools/data/manifest.ts`
- Create: `src/tools/data/index.ts`
- Modify: `src/tools/generated-tools-index.ts`（仅由生成器更新）
- Test: `tests/unit/tools/data/extractTable.test.ts`
- Test: `tests/integration/tool-categories.integration.test.ts`

**Interfaces:**
- Consumes: `captureTable`、`normalizeTable`、`encodeCsv`。
- Produces: `extractTable` defineTool，name 为 `extract_table`，annotations 为 `ToolCategory.DATA`、`readOnlyHint: false`（允许显式写文件）。
- 成功响应：`{success: true, message, tooltype: 'extract_table', data: ExtractedTable & {outputPath?: string}}`；不返回完整 CSV 字符串。
- `coverage` 至少报告 `rowsReturned` 和 `datasetComplete: 'unknown'`；不声称已加载 DOM 等于完整业务数据集。

- [ ] **Step 1: 写工具适配失败测试**

通过 fake `Frame`/CDP 走真实 `captureTable`，断言 JSON 输出字段、`includeHidden` 透传、`format: 'csv'` 无 `outputPath` 的 validation 错误。`csv + outputPath` 时断言 `writeFile` 写入 UTF-8 字节并返回保存路径且仍保留 rows/spans；`json + outputPath` 写规范 JSON。不要为测试额外暴露仅为注入服务的 seam。

- [ ] **Step 2: 写 manifest 注册失败测试**

断言 data manifest 注册 `extractTable` 且为 full profile；生成索引后通过 `ToolRegistry.listTools('full')` 和 `loadToolMeta` 验证 `extract_table` 可发现、参数可内省，并直接断言 `extractTable.annotations.category === ToolCategory.DATA`。

- [ ] **Step 3: 运行工具测试并确认 RED**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/data/extractTable.test.js`
Expected: FAIL，因工具模块/注册不存在。

- [ ] **Step 4: 实现最小 MCP 适配器并生成索引**

校验 format/outputPath 组合，捕获并映射采集错误，执行 normalize，按需用 Node `writeFile` 写文件，最后设置 structured content。创建 `src/tools/data/manifest.ts` 后运行 `npm run build:index`，不手改生成索引。

- [ ] **Step 5: 运行相关测试并确认 GREEN**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/data/*.test.js build/tests/unit/tools/all-tools-contract.test.js build/tests/integration/tool-categories.integration.test.js`
Expected: PASS，工具发现、metadata 与文件输出合同通过。

- [ ] **Step 6: 最终 diff 验证与交付**

Run: `npm run typecheck && npm run test:unit && npm run check-format`
Expected: PASS。若修改发生在任何检查之后，重跑对应检查；在真实 Chromium 用静态 HTML（多级表头、rowspan/colspan、隐藏行、ARIA grid）执行一次 `extract_table` JSON 和 CSV 验收并记录结果。若无法连接真实浏览器，明确标记未验证，不能声称端到端完成。
