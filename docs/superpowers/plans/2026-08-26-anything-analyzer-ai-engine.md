# Anything Analyzer 迁移 — P2 两阶段智能分析引擎与报告生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地两阶段智能分析引擎与报告生成能力：扩展 `SessionStore` 与 `CaptureSessionManager` 支持 `ai_reports` 读写；构建 `SceneDetector`（规则场景预判）、`TrafficPurifier`（流量降噪清洗）、`CryptoScriptExtractor`（Hook 堆栈与源码切片提取）与 `PromptBuilder`（5 种模式 Prompt 组装）；落地 `session_analyze_purified` 与 `session_generate_report` 两个 MCP 工具并更新 domain manifest。

**Architecture:**
- **Phase 1（规则降噪与场景推断）**：
  - `TrafficPurifier`：从会话 `CapturedRequestRow[]` 剔除静态资源/探针/广告域名（复用 `PatternDetector` 的黑白名单机制），提取关键请求的时序与 body 摘要。
  - `SceneDetector`：单次 $O(N)$ 遍历检测请求与响应特征，识别 `auth-token`、`signature-hash`、`crypto-cipher`、`ai-sse`、`login-flow` 等场景标签与置信度。
  - `CryptoScriptExtractor`：消费 `HookRecordRow[]`，解析 `callStack` 堆栈定位脚本 URL 与行号，从 `CodeCollector` 或缓存提取加密函数上下文代码切片。
- **Phase 2（提示词组装与 LLM 报告）**：
  - `PromptBuilder`：根据模式（`auto` | `api_reverse` | `security` | `perf` | `js_crypto`）组装提纯数据、场景标签与代码切片为结构化 Prompt。
  - `LLMService`：调用 AI 执行生成（无 AI 时降级输出 Markdown 提纯汇总），结果持久化至 `ai_reports` 表。
- **数据层扩展**：
  - `src/modules/session/types.ts` 定义 `AiReportRow` / `AiReportInput`。
  - `SessionStore` & `SqliteSessionStore` 增加 `saveReport(row)`、`getReport(id)`、`getReports(sessionId)`。
  - `CaptureSessionManager` 增加 `saveReport`、`getReport`、`getReports` 代理方法。
- **MCP 工具**：
  - `session_analyze_purified`（只读，Category: `ToolCategory.NETWORK`，输出 `sceneHints`、`purifiedRequests`、`cryptoSnippets`、`recommendedPrompt`）。
  - `session_generate_report`（生成并持久化，Category: `ToolCategory.NETWORK`，输出 `reportId`、`reportMarkdown`）。

**Tech Stack:** TypeScript ESM · `better-sqlite3` · `node:test` · `zod`（`src/third_party`）· `defineTool` · `LLMService`

**Spec:** `docs/superpowers/specs/2026-08-26-anything-analyzer-migration-design.md`（§4.2 ai_reports 表、§5.2 复用映射、§6.4 & §6.5 工具契约）

---

## Global Constraints

- 遵循已有 Session 模块架构与命名规范（`CaptureSessionManager`、`SqliteSessionStore`）。
- 5 种分析模式定义：`auto | api_reverse | security | perf | js_crypto`（默认 `auto`）。
- 工具类别统一使用 `ToolCategory.NETWORK`。
- 工具注册走 `defineTool`（`src/tools/ToolDefinition.ts`）；新增/修改工具后运行 `npm run build:index` 重新生成 `src/tools/generated-tools-index.ts`。
- AI 降级保证：当 `LLMService` 未配置或离线时，`session_generate_report` 仍能优雅降级生成基于规则的 Markdown 分析报告，不抛出未经处理的裸异常。
- ESLint/Prettier：`singleQuote: true`、`trailingComma: all`、`arrowParens: avoid`、`endOfLine: lf`；内置模块 `node:` 前缀；类型导入/导出显式 `type`。
- 测试：`node:test`（`describe`/`it` + `assert`），文件 `tests/unit/**/*.test.ts` 镜像 `src/`；源码导入用 `.js` 后缀。

---

### Task 1: 扩展 SessionStore 与 SqliteSessionStore 支持 ai_reports 持久化

**Files:**
- Modify: `src/modules/session/types.ts`
- Modify: `src/modules/session/SessionStore.ts`
- Modify: `src/modules/session/SqliteSessionStore.ts`
- Modify: `src/modules/session/CaptureSessionManager.ts`
- Test: `tests/unit/modules/session/SqliteSessionStore.test.ts`
- Test: `tests/unit/modules/session/CaptureSessionManager.test.ts`

**Interfaces:**
- Produces:
  - `AiReportRow = { id: string; sessionId: string; mode: string; sceneHints: string | null; purifiedSummary: string | null; reportMarkdown: string; messages: string; createdAt: number; }`
  - `AiReportInput = Omit<AiReportRow, 'id' | 'createdAt'> & { id?: string; createdAt?: number; }`
  - `SessionStore` & `SqliteSessionStore` 方法：`saveReport(row: AiReportRow): void`, `getReport(id: string): AiReportRow | null`, `getReports(sessionId: string): AiReportRow[]`
  - `CaptureSessionManager` 方法：`saveReport(input: AiReportInput): AiReportRow`, `getReport(id: string): AiReportRow | null`, `getReports(sessionId: string): AiReportRow[]`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/modules/session/SqliteSessionStore.test.ts` 追加针对 `saveReport`、`getReport`、`getReports` 的测试用例；在 `tests/unit/modules/session/CaptureSessionManager.test.ts` 追加对应的代理测试。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/session/SqliteSessionStore.test.js`
Expected: FAIL（方法未定义）。

- [ ] **Step 3: 实现类型、Store 与 Manager 扩展**

1. 在 `src/modules/session/types.ts` 增加 `AiReportRow` 与 `AiReportInput` 类型定义。
2. 在 `src/modules/session/SessionStore.ts` 接口追加 `saveReport`, `getReport`, `getReports`。
3. 在 `src/modules/session/SqliteSessionStore.ts` 实现 SQL 存取与行映射：
   - `INSERT INTO ai_reports (id, session_id, mode, scene_hints, purified_summary, report_markdown, messages, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
   - `SELECT * FROM ai_reports WHERE id = ?`
   - `SELECT * FROM ai_reports WHERE session_id = ? ORDER BY created_at DESC`
4. 在 `src/modules/session/CaptureSessionManager.ts` 增加 `saveReport(input: AiReportInput): AiReportRow`（若无 id 则生成 `randomUUID()`，若无 createdAt 则取 `Date.now()`）及查询代理方法。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/session/SqliteSessionStore.test.js build/tests/unit/modules/session/CaptureSessionManager.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/session/ types.ts SessionStore.ts SqliteSessionStore.ts CaptureSessionManager.ts tests/unit/modules/session/
git commit -m "feat(session): add ai_reports persistence and store methods"
```

---

### Task 2: SceneDetector（O(N) 规则场景推断）

**Files:**
- Create: `src/modules/analyzer/ai/SceneDetector.ts`
- Create: `src/modules/analyzer/ai/types.ts`
- Test: `tests/unit/modules/analyzer/ai/SceneDetector.test.ts`

**Interfaces:**
- Produces:
  - `SceneHint = { scene: string; confidence: 'high' | 'medium' | 'low'; evidence: string; matchedUrls?: string[]; }`
  - `SceneDetector` 类，方法 `detect(requests: CapturedRequestRow[], hooks?: HookRecordRow[]): SceneHint[]`
  - 场景识别覆盖：`auth-token` (Bearer/JWT/OAuth), `signature-hash` (sign/sig/hmac/timestamp/nonce), `crypto-cipher` (Crypto hook/AES/RSA/SM4), `ai-sse` (text/event-stream, chunked sse), `login-flow` (login/auth/captcha/verify).

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/modules/analyzer/ai/SceneDetector.test.ts`，测试包含：
- 请求包含 Bearer/Authorization/JWT 时识别 `auth-token` (confidence high)。
- 请求参数包含 sign/sig/timestamp 或 Header 包含 signature 时识别 `signature-hash`。
- 请求为 `text/event-stream` 或 `isStreaming === 1` 时识别 `ai-sse`。
- 请求 URL 包含 login/captcha/verify 时识别 `login-flow`。
- 存在 crypto hook 记录时识别 `crypto-cipher`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/analyzer/ai/SceneDetector.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 SceneDetector 与 types**

创建 `src/modules/analyzer/ai/types.ts` 与 `src/modules/analyzer/ai/SceneDetector.ts`：
- 复用并对齐 `src/modules/analyzer/PatternDetector.ts` 与 `PatternDetectorAuthPatterns.ts` 中的匹配规则。
- 采用单次 $O(N)$ 扫描请求列表，对每条请求的 URL、Headers、Body 以及 Hook 记录做特征匹配，输出聚合后的 `SceneHint[]`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/analyzer/ai/SceneDetector.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/analyzer/ai/types.ts src/modules/analyzer/ai/SceneDetector.ts tests/unit/modules/analyzer/ai/SceneDetector.test.ts
git commit -m "feat(analyzer): add SceneDetector rule-based scene inference"
```

---

### Task 3: TrafficPurifier（Phase 1 流量清洗与降噪）

**Files:**
- Create: `src/modules/analyzer/ai/TrafficPurifier.ts`
- Modify: `src/modules/analyzer/ai/types.ts`
- Test: `tests/unit/modules/analyzer/ai/TrafficPurifier.test.ts`

**Interfaces:**
- Produces:
  - `PurifiedRequest = { sequence: number; method: string; url: string; source: 'cdp' | 'proxy'; statusCode: number; durationMs: number; contentType: string | null; keyHeaders: Record<string, string>; bodyPreview: string | null; responsePreview: string | null; isStreaming: number; isWebSocket: number; }`
  - `TrafficPurifier` 类，方法 `purify(requests: CapturedRequestRow[], options?: { maxRequests?: number }): PurifiedRequest[]`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/modules/analyzer/ai/TrafficPurifier.test.ts`，测试包含：
- 过滤静态文件资源（`.png`, `.jpg`, `.css`, `.woff`, `.svg`, `.ico`）。
- 过滤黑名单分析/统计域（`google-analytics.com`, `sentry.io`, `doubleclick.net` 等）。
- 提取关键 Header（过滤掉通用浏览器 Header 如 `sec-ch-ua`, `accept-language`，保留 `authorization`, `cookie`, `content-type`, `x-*` 等）。
- 对过长 requestBody / responseBody 生成精简的 JSON/文本 bodyPreview（控制单条在 1000 字符内）。
- 按时间或 sequence 升序输出核心业务请求链路。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/analyzer/ai/TrafficPurifier.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 TrafficPurifier**

创建 `src/modules/analyzer/ai/TrafficPurifier.ts`：
- 结合 `BLACKLIST_DOMAINS` 与静态扩展名过滤规则。
- 提取有逆向价值的关键 Headers 并做安全修剪。
- 提取请求体与响应体摘要预览。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/analyzer/ai/TrafficPurifier.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/analyzer/ai/TrafficPurifier.ts src/modules/analyzer/ai/types.ts tests/unit/modules/analyzer/ai/TrafficPurifier.test.ts
git commit -m "feat(analyzer): add TrafficPurifier noise reduction"
```

---

### Task 4: CryptoScriptExtractor（Hook 堆栈回溯与代码切片）

**Files:**
- Create: `src/modules/analyzer/ai/CryptoScriptExtractor.ts`
- Modify: `src/modules/analyzer/ai/types.ts`
- Test: `tests/unit/modules/analyzer/ai/CryptoScriptExtractor.test.ts`

**Interfaces:**
- Produces:
  - `CryptoSnippet = { functionName: string; hookType: string; file: string; line?: number; column?: number; sourceSnippet: string; argsPreview?: string; resultPreview?: string; }`
  - `CryptoScriptExtractor` 类，方法 `extractSnippets(hooks: HookRecordRow[], scriptGetter?: (url: string) => string | null): CryptoSnippet[]`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/modules/analyzer/ai/CryptoScriptExtractor.test.ts`，测试包含：
- 解析 HookRecordRow 的 `callStack` 提取文件 URL、行号与列号（支持 Chrome/V8 堆栈格式 `at functionName (url:line:col)`）。
- 当提供 `scriptGetter` 时，依据行号切片提取上下文 15~30 行源码并标注目标行。
- 当无法获取源码时，降级使用函数名与参数/返回值快照构造切片。
- 对重复文件+行号做去重保护。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/analyzer/ai/CryptoScriptExtractor.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 CryptoScriptExtractor**

创建 `src/modules/analyzer/ai/CryptoScriptExtractor.ts`：
- 实现 V8 call stack 解析器（正则表达式解析 `at <fn> (<url>:<line>:<col>)` 或 `at <url>:<line>:<col>`）。
- 实现安全切片提取器 `sliceSourceContext(source, line, radius = 10)`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/analyzer/ai/CryptoScriptExtractor.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/analyzer/ai/CryptoScriptExtractor.ts src/modules/analyzer/ai/types.ts tests/unit/modules/analyzer/ai/CryptoScriptExtractor.test.ts
git commit -m "feat(analyzer): add CryptoScriptExtractor hook stack tracing"
```

---

### Task 5: PromptBuilder 与 AI 分析模式（5 种模式组装）

**Files:**
- Create: `src/modules/analyzer/ai/PromptBuilder.ts`
- Create: `src/modules/analyzer/ai/index.ts`
- Modify: `src/modules/analyzer/ai/types.ts`
- Test: `tests/unit/modules/analyzer/ai/PromptBuilder.test.ts`

**Interfaces:**
- Produces:
  - 分析模式枚举与类型：`AnalysisMode = 'auto' | 'api_reverse' | 'security' | 'perf' | 'js_crypto'`
  - `PromptBuilder` 类，方法 `buildPrompt(params: { mode: AnalysisMode; sceneHints: SceneHint[]; purifiedRequests: PurifiedRequest[]; cryptoSnippets: CryptoSnippet[]; targetUrl?: string | null; }): { systemPrompt: string; userPrompt: string; fallbackReport: string; }`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/modules/analyzer/ai/PromptBuilder.test.ts`，测试包含：
- 针对 5 种模式生成特异化的 System Prompt 与 User Prompt（例如 `api_reverse` 侧重接口签名与入参结构，`js_crypto` 侧重算法识别与密钥还原，`security` 侧重鉴权漏洞与明文传输）。
- 生成确定性的 `fallbackReport`（当无 AI 服务时可直接作为最终 Markdown 报告输出）。
- 导出 `src/modules/analyzer/ai/index.ts` barrel。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/analyzer/ai/PromptBuilder.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现 PromptBuilder 与 barrel**

创建 `src/modules/analyzer/ai/PromptBuilder.ts` 与 `src/modules/analyzer/ai/index.ts`：
- 构建结构化、高密度且遵循 Token 预算的提示词。
- 提供基于 Markdown 的离线分析降级模板渲染。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/analyzer/ai/PromptBuilder.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/analyzer/ai/PromptBuilder.ts src/modules/analyzer/ai/index.ts src/modules/analyzer/ai/types.ts tests/unit/modules/analyzer/ai/PromptBuilder.test.ts
git commit -m "feat(analyzer): add PromptBuilder with 5 analysis modes and offline fallback"
```

---

### Task 6: `session_analyze_purified` MCP 工具

**Files:**
- Create: `src/tools/session/session_analyze_purified.ts`
- Modify: `src/tools/session/manifest.ts`
- Modify: `src/tools/generated-tools-index.ts`（经 `npm run build:index` 重新生成）
- Test: `tests/unit/tools/session/session-tools.test.ts`（追加用例）

**Interfaces:**
- Consumes: `getRuntime().captureSessionManager`, `SceneDetector`, `TrafficPurifier`, `CryptoScriptExtractor`, `PromptBuilder`
- Produces: 命名导出 `sessionAnalyzePurified`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/tools/session/session-tools.test.ts` 追加 `session_analyze_purified` 测试用例：
- 测试获取活跃会话并输出 `sceneHints`、`purifiedRequests`、`cryptoSnippets` 与 `recommendedPrompt`。
- 测试支持显式传入 `sessionId` 与 `mode`（如 `api_reverse`）。
- 测试未知 `sessionId` 抛出 `ErrorCodes.NOT_FOUND`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/session/session-tools.test.js`
Expected: FAIL（工具未定义）。

- [ ] **Step 3: 实现 session_analyze_purified 工具并更新 manifest**

创建 `src/tools/session/session_analyze_purified.ts`：
```ts
export const sessionAnalyzePurified = defineTool({
  name: 'session_analyze_purified',
  description: '执行 Phase 1 规则探测与降噪提纯，输出高价值请求、场景推断与加密代码切片，供 AI Agent 直接消费。',
  annotations: { category: ToolCategory.NETWORK, readOnlyHint: true },
  schema: {
    sessionId: zod.string().optional().describe('会话 ID，默认当前活跃会话。'),
    mode: zod.enum(['auto', 'api_reverse', 'security', 'perf', 'js_crypto']).optional().describe('分析模式，默认 auto。'),
  },
  handler: async (request, response) => { ... }
});
```
并在 `src/tools/session/manifest.ts` 中注册。

- [ ] **Step 4: 重新生成工具索引与运行测试**

Run: `npm run build:index && npm run build:compile`
Run: `node --require ./build/tests/setup.js --test build/tests/unit/tools/session/session-tools.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/tools/session/session_analyze_purified.ts src/tools/session/manifest.ts src/tools/generated-tools-index.ts tests/unit/tools/session/session-tools.test.ts
git commit -m "feat(session): add session_analyze_purified MCP tool"
```

---

### Task 7: `session_generate_report` MCP 工具

**Files:**
- Create: `src/tools/session/session_generate_report.ts`
- Modify: `src/tools/session/manifest.ts`
- Modify: `src/tools/generated-tools-index.ts`（经 `npm run build:index` 重新生成）
- Test: `tests/unit/tools/session/session-tools.test.ts`（追加用例）

**Interfaces:**
- Consumes: `getRuntime().captureSessionManager`, `LLMService`, `SceneDetector`, `TrafficPurifier`, `CryptoScriptExtractor`, `PromptBuilder`
- Produces: 命名导出 `sessionGenerateReport`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/tools/session/session-tools.test.ts` 追加 `session_generate_report` 测试用例：
- 测试执行报告生成，返回 `reportId` 与 `reportMarkdown`。
- 测试自动将报告持久化到 `ai_reports` 表，并可通过 `manager.getReports(sessionId)` 查出。
- 测试在没有 LLM 配置时降级返回基于规则的 Markdown 报告并成功落库。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/session/session-tools.test.js`
Expected: FAIL（工具未定义）。

- [ ] **Step 3: 实现 session_generate_report 工具**

创建 `src/tools/session/session_generate_report.ts`：
```ts
export const sessionGenerateReport = defineTool({
  name: 'session_generate_report',
  description: '基于提纯结果与指定分析模式触发 AI 报告生成，并将结果持久化到 ai_reports 表。',
  annotations: { category: ToolCategory.NETWORK, readOnlyHint: false },
  schema: {
    sessionId: zod.string().optional().describe('会话 ID，默认当前活跃会话。'),
    mode: zod.enum(['auto', 'api_reverse', 'security', 'perf', 'js_crypto']).optional().describe('分析模式，默认 auto。'),
  },
  handler: async (request, response) => { ... }
});
```
并在 `src/tools/session/manifest.ts` 注册该工具。

- [ ] **Step 4: 重新生成工具索引与运行测试**

Run: `npm run build:index && npm run build:compile`
Run: `node --require ./build/tests/setup.js --test build/tests/unit/tools/session/session-tools.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/tools/session/session_generate_report.ts src/tools/session/manifest.ts src/tools/generated-tools-index.ts tests/unit/tools/session/session-tools.test.ts
git commit -m "feat(session): add session_generate_report MCP tool"
```

---

### Task 8: 全量验证与端到端集成测试

**Files:**
- Create: `tests/integration/session/session-ai-pipeline.integration.test.ts`
- Test: 全量单元测试、契约测试、类型检查与代码风格

- [ ] **Step 1: 编写集成测试**

在 `tests/integration/session/session-ai-pipeline.integration.test.ts` 编写完整端到端生命周期测试：
1. `session_create` 创建抓包会话。
2. 注入模拟 CDP / Proxy 流量、加解密 Hook 及 Storage 快照。
3. 调用 `session_analyze_purified` 验证场景识别、降噪请求与代码切片输出。
4. 调用 `session_generate_report` 验证 Markdown 报告生成与 `ai_reports` 表持久化校验。
5. 调用 `session_get_data` 验证会话完整数据可追溯。

- [ ] **Step 2: 运行全量检查**

Run: `npm run typecheck`
Run: `npm run test:contracts`
Run: `npm run test:unit`
Run: `node --require ./build/tests/setup.js --test build/tests/integration/session/session-ai-pipeline.integration.test.js`
Run: `npm run check-format`

- [ ] **Step 3: 格式化与最终 Commit**

```bash
git add tests/integration/session/session-ai-pipeline.integration.test.ts
git commit -m "test(session): add end-to-end integration tests for AI analysis pipeline"
```
