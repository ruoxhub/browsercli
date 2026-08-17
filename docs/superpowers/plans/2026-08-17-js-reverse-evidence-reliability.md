# JS Reverse Evidence Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复脚本源码文件保存截断，并在页面刷新导致 CDP `scriptId` 变化后通过兼容的 `ScriptLocator` 恢复脚本定位。

**Architecture:** 保留现有 `scriptId` 快速路径，在调试器脚本元数据之上增加工具拥有的 locator 与 SHA-256 完整性校验。脚本解析、完整源码获取和原子文件写入分别保持单一职责；工具层只负责参数转换和结构化响应，不维护第二套页面或调试器生命周期。

**Tech Stack:** TypeScript ESM、Node.js `node:test`、Patchright/CDP `Debugger`、Node `crypto`、Node `fs/promises`、现有 `ToolError`/`ErrorCodes`、Prettier。

**Spec:** `docs/superpowers/specs/2026-08-17-js-reverse-optimization-roadmap-and-evidence-reliability-design.md`

## Global Constraints

- 先在当前 HEAD 上完成现状校准；不得覆盖或回滚工作树中已有的用户改动。
- 保留现有 `scriptId` 参数、快速路径和成功响应字段；新增 locator 与完整性字段必须是兼容扩展。
- 不新增第三方依赖，不建立常驻脚本注册数据库，不改变默认浏览器启动、Debugger 懒激活或零 JS 注入策略。
- `contentHash` 使用工具计算的 SHA-256；不能把 CDP 的内部 hash 直接当作工具契约。
- `filePath` 写入必须使用同目录临时文件、完整性校验和原子替换；校验失败不得覆盖旧文件。
- 多候选 locator 必须返回明确歧义错误，不得静默选择第一个候选。
- 真实 `67.js` fixture 已获授权可提交；提交前确认不包含 Cookie、Storage、生产凭证或未授权站点数据。
- 每个实现任务均需先写失败测试，再写最小实现；最后一次代码修改后必须重跑相关测试、`npm run typecheck` 和 `npm run check-format`。

---

## 现状校准与文件地图

在执行任何代码任务前，确认以下现状，不假设报告中的“待修复”仍然准确：

- `src/modules/debugger/ScriptManager.ts` 已有 `ScriptInfo.sourceLength`、`sourcePath`、`hash`、分片缓存和 `getScriptSourcePath()`，优先扩展这些能力。
- `src/modules/debugger/DebuggerManager.ts` 委托 `getScriptSource()` 与 `getScriptSourcePath()`，不要在工具层重新创建 CDP session。
- `src/tools/debugger/index.ts` 是当前 `get_script_source` 工具入口；`src/tools/script/script.ts` 不是假定的唯一实现位置。
- `tests/unit/tools/debugger/getScriptSourceFilePath.test.ts` 已存在，先阅读其行为再补充截断回归。
- `src/worker/context/BrowserContextProvider.ts` 已提供稳定 `pageId`，locator 应复用 `getPageId()`/`resolvePage()`，不能引入第二套 page ID。
- 当前工作树已有与本任务无关的修改：`.gitignore`、`src/tools/generated-tools-index.ts`、`src/tools/jsvmp/*`、`src/web/routes/config.ts` 及对应测试。所有提交只能包含本计划明确列出的文件。

---

### Task 1: 校准现状并建立完整样本 fixture

**Files:**

- Create: `tests/fixtures/jsvmp/match18/67.js`
- Create: `tests/fixtures/jsvmp/match18/README.md`
- Test: `tests/unit/tools/debugger/getScriptSourceFilePath.test.ts`

**Interfaces:**

- Consumes: 当前报告中的已授权完整 `67.js` 样本，以及现有 `get_script_source` filePath 测试 harness。
- Produces: 可被测试直接读取的完整脚本 fixture；fixture 的字节数和 SHA-256 常量；一个能在当前 HEAD 上复现是否截断的失败测试。

- [ ] **Step 1: 检查现状与样本来源**

运行：

```powershell
git status --short
node -e "const fs=require('node:fs'); const p='tests/fixtures/jsvmp/match18/67.js'; if (fs.existsSync(p)) console.log(fs.statSync(p).size); else console.log('fixture-missing')"
npm test -- --test-name-pattern="get_script_source|script source file path"
```

预期：记录当前工作树状态；若 fixture 已存在，记录其真实大小；若不存在，测试仍能明确显示缺少完整 fixture，而不是默默使用截断文件。

- [ ] **Step 2: 写入完整授权样本和来源说明**

将授权的完整 `67.js` 原样写入 `tests/fixtures/jsvmp/match18/67.js`，在 README 中记录：样本用途是保存完整性回归、来源为 match/18 实战、不得用于生产请求复现。不要把其他脚本、Cookie、Storage 或请求凭证放入 fixture 目录。

- [ ] **Step 3: 增加失败断言**

在现有测试中加入等价断言：

```typescript
const source = readFileSync(fixturePath, 'utf8');
assert.equal(Buffer.byteLength(source, 'utf8'), 34498);
const expectedHash = createHash('sha256').update(source, 'utf8').digest('hex');
assert.equal(result.sha256, expectedHash);
assert.equal(
  createHash('sha256').update(readFileSync(outputPath)).digest('hex'),
  expectedHash,
);
```

将工具返回的 `sourceLength`、实际写入文件大小和文件 SHA-256 都绑定到同一完整样本。

- [ ] **Step 4: 运行测试确认基线行为**

运行：

```powershell
npm test -- --test-name-pattern="get_script_source|script source file path"
```

预期：在当前实现仍保存截断内容时失败；如果已经通过，记录为现状已解决，并保留测试作为回归门槛，不重复改写行为。

- [ ] **Step 5: Commit**

```powershell
$env:GIT_MASTER='1'; git add tests/fixtures/jsvmp/match18/67.js tests/fixtures/jsvmp/match18/README.md tests/unit/tools/debugger/getScriptSourceFilePath.test.ts
$env:GIT_MASTER='1'; git commit -m "test: add complete jsvmp source fixture"
```

---

### Task 2: 实现工具拥有的 ScriptLocator 类型与解析器

**Files:**

- Create: `src/tools/shared/scriptResolver.ts`
- Create: `tests/unit/tools/shared/scriptResolver.test.ts`
- Modify: `src/modules/debugger/ScriptManager.ts`
- Modify: `src/modules/debugger/DebuggerManager.ts`

**Interfaces:**

- Consumes: `ScriptInfo`、`DebuggerManager.getScripts()`、`getScriptSource()`、`BrowserContextProvider.getPageId()`/`resolvePage()`。
- Produces: `ScriptLocator`、`ScriptLookupParams`、`ResolvedScript` 以及 `resolveScript()`；后续 `get_script_source` 和 `analyze_jsvmp_vm` 只调用该解析器，不复制匹配规则。

将接口固定为：

```typescript
export interface ScriptLocator {
  pageId?: string;
  url?: string;
  domIndex?: number;
  contentHash?: string;
  sourceLength?: number;
}

export interface ScriptLookupParams {
  scriptId?: string;
  locator?: ScriptLocator;
}

export interface ResolvedScript {
  scriptId: string;
  url: string;
  source: string;
  sourceLength: number;
  sha256: string;
  matchedBy: 'scriptId' | 'hash' | 'domIndex' | 'url';
  staleScriptIdRecovered?: boolean;
}
```

- [ ] **Step 1: 写失败单元测试**

覆盖以下行为：有效 `scriptId` 直接命中；旧 `scriptId` + locator 通过 URL/长度/hash 找到新 ID；唯一 URL 命中；无候选抛 `SCRIPT_NOT_FOUND`；多候选抛 `SCRIPT_LOCATOR_AMBIGUOUS`；locator 指向已关闭 `pageId` 抛 `PAGE_NOT_FOUND`。

- [ ] **Step 2: 运行测试确认失败**

```powershell
npm test -- --test-name-pattern="ScriptResolver"
```

预期：失败原因是 resolver 类型或 `resolveScript()` 尚不存在，而不是测试 harness 崩溃。

- [ ] **Step 3: 实现最小解析器**

按固定顺序实现：

1. 用 `scriptId` 查当前 `ScriptManager`；成功则获取源码并计算工具 SHA-256。
2. `scriptId` 无效时，要求存在 locator；先校验 `pageId`。
3. 用 `url`、`sourceLength`、`domIndex` 过滤候选；若已有 `contentHash`，对候选源码计算 SHA-256 后精确过滤。
4. 0 个或多个候选分别返回结构化错误；1 个候选标记 `staleScriptIdRecovered: true`。
5. 不把内部 CDP hash 写入 `contentHash`。

- [ ] **Step 4: 运行测试确认通过**

```powershell
npm test -- --test-name-pattern="ScriptResolver"
```

预期：所有解析器单元测试通过，错误中包含候选 ID 或恢复建议。

- [ ] **Step 5: Commit**

```powershell
$env:GIT_MASTER='1'; git add src/tools/shared/scriptResolver.ts src/modules/debugger/ScriptManager.ts src/modules/debugger/DebuggerManager.ts tests/unit/tools/shared/scriptResolver.test.ts
$env:GIT_MASTER='1'; git commit -m "feat: resolve scripts after navigation"
```

---

### Task 3: 修复完整源码原子写入与完整性响应

**Files:**

- Modify: `src/utils/fsSafe.ts`
- Modify: `src/tools/debugger/index.ts`
- Modify: `tests/unit/tools/debugger/getScriptSourceFilePath.test.ts`

**Interfaces:**

- Consumes: Task 2 的 `ResolvedScript`，以及现有 `get_script_source` 的 `filePath` 参数和响应格式。
- Produces: `writeScriptFileAtomic(filePath, source)` 返回 `{bytesWritten, sha256}`；`get_script_source` 返回可选的 `sourceLength`、`bytesWritten`、`sha256`、`responseTruncated`、`locator`。

- [ ] **Step 1: 写失败测试**

新增测试：完整 34498 字节样本写入后大小和 hash 完全一致；MCP 预览被截断时磁盘文件不截断；临时写入失败时目标旧文件内容不变；`bytesWritten` 与 UTF-8 `Buffer.byteLength(source)` 一致。

- [ ] **Step 2: 运行测试确认失败**

```powershell
npm test -- --test-name-pattern="get_script_source|atomic script write"
```

预期：当前 filePath 路径在完整样本上失败或缺少完整性字段。

- [ ] **Step 3: 实现原子写入**

使用 `node:fs/promises` 与 `node:crypto`：在目标文件同目录创建唯一临时文件，完整写入 UTF-8 字符串，读取临时文件并校验字节长度/hash，再使用 `rename()` 替换目标。任何异常先删除临时文件并保留旧目标。

- [ ] **Step 4: 接入 get_script_source**

工具入口调用 resolver 获取完整 source，再调用原子写入器。响应预览可继续受现有响应预算限制，但必须显式返回 `responseTruncated: true/false`；只有文件校验成功才返回 `success: true`。

- [ ] **Step 5: 运行测试确认通过**

```powershell
npm test -- --test-name-pattern="get_script_source|atomic script write"
```

预期：完整样本、预览截断、写入失败和旧文件保护测试全部通过。

- [ ] **Step 6: Commit**

```powershell
$env:GIT_MASTER='1'; git add src/utils/fsSafe.ts src/tools/debugger/index.ts tests/unit/tools/debugger/getScriptSourceFilePath.test.ts
$env:GIT_MASTER='1'; git commit -m "fix: preserve complete script source files"
```

---

### Task 4: 把 locator 接入脚本工具并验证刷新恢复

**Files:**

- Modify: `src/tools/debugger/index.ts`
- Modify: `src/tools/jsvmp/analyzeVm.ts`
- Test: `tests/unit/tools/debugger/index.test.ts`
- Test: `tests/unit/tools/jsvmp/analyzeVm.test.ts`
- Create: `tests/integration/scriptSourceRecovery.integration.test.ts`

**Interfaces:**

- Consumes: Task 2 的 `ScriptLookupParams`/`ResolvedScript`，Task 3 的原子写入结果。
- Produces: `get_script_source` 接受 `scriptId`、`locator` 和可选 `filePath`；JSVMP 分析入口能使用解析后的完整源码；真实 Chromium 集成测试证明刷新恢复。

- [ ] **Step 1: 写工具级失败测试**

测试旧参数只传 `scriptId` 的行为不变；传入 locator 返回生成后的完整 locator；旧 ID 失效时返回 `staleScriptIdRecovered`；歧义和页面失效返回对应错误码。

- [ ] **Step 2: 写集成测试**

用本地 fixture 页面加载两个不同 URL 的脚本，记录第一次返回的 locator，调用 reload，再用旧 locator 调用 `get_script_source`。断言新旧 `scriptId` 可以不同，但返回源码 hash 相同；不要依赖固定 CDP scriptId 数字。

- [ ] **Step 3: 运行失败测试**

```powershell
npm test -- --test-name-pattern="script locator|script source recovery"
```

预期：工具尚未接受 locator 或刷新后无法恢复时失败。

- [ ] **Step 4: 接入工具 schema 与 JSVMP 调用**

在现有 schema 中保留 `scriptId`，增加 `locator` 对象；不要删除旧字段。`analyze_jsvmp_vm` 只消费 resolver 返回的完整 source，不在自身重新实现 URL/hash 匹配。

- [ ] **Step 5: 运行相关测试**

```powershell
npm test -- --test-name-pattern="script locator|script source recovery|analyze_jsvmp_vm|get_script_source"
```

预期：单元与集成测试通过；旧 `scriptId` 调用和已有 analyze 测试均通过。

- [ ] **Step 6: Commit**

```powershell
$env:GIT_MASTER='1'; git add src/tools/debugger/index.ts src/tools/jsvmp/analyzeVm.ts tests/unit/tools/debugger/index.test.ts tests/unit/tools/jsvmp/analyzeVm.test.ts tests/integration/scriptSourceRecovery.integration.test.ts
$env:GIT_MASTER='1'; git commit -m "test: verify script recovery after reload"
```

---

### Task 5: 最终验证与变更边界检查

**Files:**

- Verify only: all files changed by Tasks 1-4

- [ ] **Step 1: 运行定向测试**

```powershell
npm test -- --test-name-pattern="ScriptResolver|get_script_source|script source file path|script source recovery|analyze_jsvmp_vm"
```

预期：所有阶段 1 测试通过。

- [ ] **Step 2: 运行项目要求的完整检查**

```powershell
npm run typecheck
npm run test:unit
npm run check-format
```

预期：三个命令均退出码 0。若存在与本任务无关的既有失败，记录具体命令、文件和错误，不修改无关代码。

- [ ] **Step 3: 检查最终 diff 与提交边界**

```powershell
$env:GIT_MASTER='1'; git status --short
$env:GIT_MASTER='1'; git diff --check HEAD~4..HEAD
$env:GIT_MASTER='1'; git diff --stat HEAD~4..HEAD
$env:GIT_MASTER='1'; git log --oneline -5
```

确认没有 `.gitignore`、JSVMP 未相关改动、配置改动或其他用户文件进入阶段 1 提交；确认 fixture 不含敏感数据。

- [ ] **Step 4: 运行 LSP/编辑器诊断**

对本计划新增或修改的每个 TypeScript 文件运行 `lsp_diagnostics`，确认没有新增 error；对 Markdown 文件运行格式检查即可。

- [ ] **Step 5: Commit verification record**

```powershell
$env:GIT_MASTER='1'; git status --short
```

预期：工作树只保留用户原有未提交改动，阶段 1 的文件均已提交；最终报告必须明确列出这些未提交改动未被触碰。

---

## Self-Review Checklist

- [ ] P2：完整源码、文件长度、SHA-256、原子写入、旧文件保护均由 Task 1/3/5 覆盖。
- [ ] P3：稳定 `pageId` 复用、旧 `scriptId` 快速路径、locator fallback、歧义错误和 reload 集成测试均由 Task 2/4 覆盖。
- [ ] 兼容性：旧 `scriptId` 输入和现有响应字段在 Task 4 回归。
- [ ] 依赖边界：S1、P1、P4、S2-S5、P5 仅出现在总路线图，不进入本计划实现。
- [ ] 无常驻注册表、无新依赖、无默认 JS 注入，符合全局约束。
- [ ] 所有步骤都有具体路径、命令、测试行为或提交动作，不含待补内容或未定义接口。
