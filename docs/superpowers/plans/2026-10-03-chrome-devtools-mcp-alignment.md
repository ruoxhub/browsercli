# Reverser-CLI 与 chrome-devtools-mcp 对齐实施计划 (方案 A: 交互与 Token 架构对齐)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 参考官方 `chrome-devtools-mcp` 架构，为 `Reverser-CLI` 引入基于 AXTree 的语义快照（TextSnapshot）与 UID 元素定位交互机制，并建立 Token-Optimized "Reference over Value" 大产物自动文件落盘规范，大幅降低 Agent 上下文消耗与操作脆弱性。

**Architecture:** 
1. 新建 `PageSnapshotManager` 模块，通过 Playwright / CDP 采集无障碍树（AXTree），建立结构化文本大纲并分配单会话自增数字 UID（如 `1_4`），维护 `uid ⇄ locator/backendNodeId` 映射表及页面生命周期失效感知。
2. 新增 MCP 工具 `take_snapshot`，返回紧凑、语义清晰、Token 开销极低的页面控件大纲与 UID。
3. 升级 `click`、`fill`、`hover` 输入工具，支持 `uid` 与 `selector` 双模定位，优先使用稳定 UID。
4. 增强 `ToolResponseAccumulator`，加入 Token 安全预算（默认 12KB），超出阈值的结构化大产物自动写入 `artifacts/outputs/`，Prompt 仅返回元信息摘要、预览及文件绝对引用路径。

**Tech Stack:** TypeScript (ESM), Playwright / Patchright, Node.js `node:test`, Zod.

**Spec:** 前文讨论并确认的设计规范：Reverser-CLI 交互与 Token 架构对齐 (方案 A)。

## Global Constraints

- 不破坏反爬分层（保持零 JS 注入与 StealthArgs 边界，不向页面隐式注入脚本）。
- 保持高扇入接口稳定性，所有现有工具接口保持向下兼容（`selector` 仍完全支持）。
- 遵循 TypeScript ESM 规范与 ESLint 平铺配置，Node 内置模块使用 `node:` 前缀。
- 所有单元测试使用 Node 内置 `node:test` 与 `node:assert/strict`。

## Review Focus

1. **快照过期处理**：页面发生跳转或 DOM 大幅重载后，旧 UID 的操作必须抛出明确、自愈性错误提示（引导重新调用 `take_snapshot`）。
2. **选择器回退兼容性**：不带 `uid` 仅传 `selector` 时，原有定位、错误处理与行为必须 100% 保持一致。
3. **UID 格式与解析容错**：面对非法格式、不存在或跨页面 UID 输入时，应拦截并返回标准 ValidationError 或 NotFound 错误，而不是引发未捕获异常。
4. **Reference over Value 文件写盘并发与安全性**：自动落盘必须保证目录存在、防路径穿越、生成唯一文件名，且在写盘失败时优雅降级并记录警告。
5. **AXTree 节点深度与环路保护**：对于超深节点树或复杂 iframe，文本大纲序列化必须具备深度防溢出边界。

---

### Task 1: 语义快照核心管理器 (`PageSnapshotManager`)

**Files:**
- Create: `src/modules/snapshot/types.ts`
- Create: `src/modules/snapshot/PageSnapshotManager.ts`
- Test: `tests/unit/modules/snapshot/PageSnapshotManager.test.ts`

- [ ] **Step 1.1: 编写测试用例**
  编写 `tests/unit/modules/snapshot/PageSnapshotManager.test.ts`，覆盖：
  - 空树与基础 AXTree 的格式化序列化（带 role, name, uid）。
  - UID 生成规律与节点索引映射（`idToNode`）。
  - `getElementLocatorByUid` 的映射解析与未找到 UID 时的友好错误抛出。
  - 页面重置/导航后的快照清理与过期校验。
- [ ] **Step 1.2: 运行测试验证失败**
  运行 `node --test tests/unit/modules/snapshot/PageSnapshotManager.test.ts`，确认因模块缺失而失败。
- [ ] **Step 1.3: 实现类型定义**
  在 `src/modules/snapshot/types.ts` 中定义 `SnapshotNode`、`TextSnapshotResult`、`SnapshotOptions` 接口。
- [ ] **Step 1.4: 实现 PageSnapshotManager 核心类**
  在 `src/modules/snapshot/PageSnapshotManager.ts` 中实现：
  - `capture(page: Page, options?: SnapshotOptions): Promise<TextSnapshotResult>`
  - `getLocatorByUid(page: Page, uid: string): Locator`
  - `clear(page?: Page): void`
  - 格式化输出算法（类似 chrome-devtools-mcp 的语义缩进文本格式）。
- [ ] **Step 1.5: 运行测试并验证通过**
  运行 `node --test tests/unit/modules/snapshot/PageSnapshotManager.test.ts`，确保全部测试通过。

---

### Task 2: 新增 `take_snapshot` MCP 工具与清单注册

**Files:**
- Create: `src/tools/dom/takeSnapshot.ts`
- Modify: `src/tools/dom/index.ts`
- Modify: `src/tools/dom/manifest.ts`
- Modify: `src/tools/generated-tools-index.ts`
- Test: `tests/unit/tools/dom/takeSnapshot.test.ts`

- [ ] **Step 2.1: 编写工具单元测试**
  编写 `tests/unit/tools/dom/takeSnapshot.test.ts`，模拟 Context 与 Page，验证：
  - 工具返回包含格式化大纲与节点计数统计。
  - 支持 `interestingOnly` 和 `verbose` 模式切换。
  - 正确更新 Context 绑定的快照缓存。
- [ ] **Step 2.2: 运行测试验证失败**
  运行 `node --test tests/unit/tools/dom/takeSnapshot.test.ts`。
- [ ] **Step 2.3: 实现 takeSnapshot 工具**
  在 `src/tools/dom/takeSnapshot.ts` 中使用 `defineTool` 定义 `take_snapshot`：
  - schema: `verbose: zod.boolean().optional()`, `interestingOnly: zod.boolean().optional()`
  - 将生成的快照挂载到当前页面的全局/Context 快照缓存中。
  - response 追加语义摘要与文本树。
- [ ] **Step 2.4: 注册工具到清单与导出**
  - 在 `src/tools/dom/index.ts` 导出 `takeSnapshot`。
  - 在 `src/tools/dom/manifest.ts` 注册条目与 sceneKeywords。
  - 更新 `src/tools/generated-tools-index.ts` 纳入清单。
- [ ] **Step 2.5: 运行工具测试与注册表测试**
  运行 `node --test tests/unit/tools/dom/takeSnapshot.test.ts tests/unit/tools/ToolRegistry.test.ts` 验证通过。

---

### Task 3: 改造 `click`、`fill`、`hover` 支持 UID 双模交互

**Files:**
- Modify: `src/tools/input/click.ts`
- Modify: `src/tools/input/fill.ts`
- Modify: `src/tools/input/hover.ts`
- Modify: `src/tools/shared/elementLocator.ts`
- Test: `tests/unit/tools/input/uid-interaction.test.ts`

- [ ] **Step 3.1: 编写双模交互单元测试**
  在 `tests/unit/tools/input/uid-interaction.test.ts` 中验证：
  - 传入 `uid` 时优先从快照管理器解析元素定位器并执行。
  - 快照不存在或 UID 找不到时，返回提示重新采集快照的错误。
  - 未传 `uid` 仅传 `selector` 时，保持原有定位逻辑不变。
  - `uid` 与 `selector` 均未传时抛出校验错误。
- [ ] **Step 3.2: 运行测试验证失败**
  运行 `node --test tests/unit/tools/input/uid-interaction.test.ts`。
- [ ] **Step 3.3: 提取并增强 locator 解析辅助逻辑**
  在 `src/tools/shared/elementLocator.ts` 中增加 `resolveTargetLocator(context, {uid, selector})` 辅助方法：
  - 若有 `uid`，调取 `PageSnapshotManager` 解析。
  - 否则解析 `selector`。
- [ ] **Step 3.4: 更新 click, fill, hover 工具定义**
  - 修改 `src/tools/input/click.ts`：schema 增加可选 `uid`，selector 改为可选，handler 中接入 `resolveTargetLocator`。
  - 修改 `src/tools/input/fill.ts`：同上升级。
  - 修改 `src/tools/input/hover.ts`：同上升级。
- [ ] **Step 3.5: 验证测试通过**
  运行 `node --test tests/unit/tools/input/uid-interaction.test.ts tests/unit/tools/input/click.test.ts`。

---

### Task 4: Token 优化与 Reference over Value 自动落盘治理

**Files:**
- Modify: `src/worker/ToolResponse.ts`
- Create: `src/utils/ArtifactStorage.ts`
- Test: `tests/unit/worker/ReferenceOverValue.test.ts`

- [ ] **Step 4.1: 编写 Reference-over-Value 测试**
  编写 `tests/unit/worker/ReferenceOverValue.test.ts`，验证：
  - 小于阈值的内容保持原样输出，不产生落盘文件。
  - 大于阈值（如超 12KB）的结构体或多行输出被自动截断，完整内容持久化至指定目录并返回 `artifactPath`。
  - 返回对象中包含清晰的摘要说明与预览片段（前 N 条记录）。
- [ ] **Step 4.2: 运行测试验证失败**
  运行 `node --test tests/unit/worker/ReferenceOverValue.test.ts`。
- [ ] **Step 4.3: 实现 ArtifactStorage 工具类**
  在 `src/utils/ArtifactStorage.ts` 中实现安全落盘工具：
  - 目录自动创建 (`artifacts/outputs/`)。
  - 唯一文件名生成与内容持久化。
  - 摘要与预览提取器。
- [ ] **Step 4.4: 升级 ToolResponseAccumulator / ToolResponseProcessor**
  在 `src/worker/ToolResponse.ts` 中集成阈值保护：
  - 设定默认阈值 `MAX_INLINE_BYTES = 12 * 1024`。
  - 在 `toJSON()` 或 processor 中检查数据大小，超限时调用 `ArtifactStorage` 落盘并重塑为 Reference 结构。
- [ ] **Step 4.5: 运行测试验证通过**
  运行 `node --test tests/unit/worker/ReferenceOverValue.test.ts tests/unit/worker/ToolResponse.test.ts`。

---

### Task 5: 整体类型检查、代码格式化与全量验证闭环

**Files:**
- Check: All modified and created files
- Commands: `npm run typecheck`, `npm run test:unit`, `npm run check-format`

- [ ] **Step 5.1: 运行全量 TypeScript 类型检查**
  运行 `npm run typecheck` 确认无类型报错。
- [ ] **Step 5.2: 运行全量单元测试套件**
  运行 `npm run test:unit` 确认所有既有单元测试与新增测试均绿灯通过。
- [ ] **Step 5.3: 运行代码规范与格式检查**
  运行 `npm run check-format`，如有格式差异运行 `npm run format` 自动修复。
- [ ] **Step 5.4: 提交并记录变更**
  按 Conventional Commits 格式提交代码：
  `feat(interaction): align with chrome-devtools-mcp text snapshot and reference-over-value`
