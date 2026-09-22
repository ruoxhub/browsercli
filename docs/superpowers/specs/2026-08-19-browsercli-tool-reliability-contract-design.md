# BrowserCLI 全工具可靠性与契约一致性设计规范

- **日期**: 2026-08-19
- **模块**: 工具定义 / 执行管线 / 调试器 / AI 服务 / HTTP Job / CLI / 测试基础设施
- **状态**: Approved (Design Stage)
- **文档路径**: `docs/superpowers/specs/2026-08-19-browsercli-tool-reliability-contract-design.md`

---

## 1. 背景

BrowserCLI 当前通过 `defineTool -> ToolExecutionPipeline -> ToolAdapter -> HTTP Job`
执行工具。仓库已经具备参数元数据、页面健康度追踪、基础前置条件检查、统一
`ToolError` 和 Job 状态管理，但对全部工具的可靠性验证暴露出以下共性问题：

1. 页面被 Debugger 暂停后，依赖 `frame.evaluate` 或 `Runtime.evaluate` 的工具会等待
   到超时，而不是在执行前识别暂停状态。
2. 一些工具把业务失败包装进 `structuredContent.success: false` 后正常返回，导致 Job
   被记录为 `done`，调用方无法仅依据 Job 状态判断是否成功。
3. 工具的 Zod Schema、`argSpecs`、远程 CLI 参数、Skill 文档和示例存在漂移。
4. AI 未配置或不可用时，部分分析工具仍进入外部调用和指数退避，长时间占用 Worker
   的单工具执行通道。
5. 无页面、陈旧 `scriptId`、缺失 native 工具等条件的错误码、恢复建议和可重试语义
   不统一。
6. 全工具验证依赖临时人工脚本，尚未形成稳定的契约、分类集成和浏览器 E2E 门禁。

本设计在现有执行链路上集中治理这些问题，不创建第二套工具注册中心，不改变
BrowserCLI 的 HTTP Job 调用模型。

## 2. 目标

### 2.1 功能目标

1. 让工具在执行前声明并检查 Browser、Page、Frame、Debugger、AI 和 native 工具链需求。
2. 页面暂停时阻止不安全的页面执行调用，快速返回可恢复的结构化错误。
3. 让 Job `done` 只表示工具真实成功；任何工具级失败必须进入 Job `failed`。
4. 以工具 Zod Schema 及其生成元数据作为唯一参数契约，立即移除旧参数别名兼容。
5. AI 不可用时自动返回本地 AST/规则分析结果，并显式说明降级模式和原因。
6. 为全部注册工具建立分层、可持续运行的验证门禁。

### 2.2 质量目标

- 暂停态门禁不改变用户调试现场，不自动恢复页面执行。
- 新能力集中在工具元数据、前置条件检查和执行管线，避免逐工具复制控制逻辑。
- 错误响应可由 CLI 和 Agent 直接转化为下一步恢复动作。
- 验证环境不依赖真实账号、生产站点、Cookie 或外部 AI 服务。

## 3. 非目标

本轮不包含：

- 重写 BrowserManager、DebuggerManager 或 HTTP Worker 架构。
- 为旧参数名提供兼容期、别名映射或静默转换。
- 自动安装 WABT、Binaryen、wasmtime、浏览器或其他 native 依赖。
- 让所有 146 个工具都运行独立真实浏览器 E2E。
- 修改默认反检测分层、默认开启 JS stealth 或 eager-enable CDP 域。
- 修复与本设计无关的业务逻辑、UI 或历史测试失败。

## 4. 设计原则

1. **单一事实源**：Schema 定义参数，生成元数据服务 CLI、文档校验和测试。
2. **失败即失败**：错误通过 `ToolError` 传播，不通过成功响应携带失败文本。
3. **状态先于动作**：环境不满足时在 handler 前失败，不让底层 CDP 或 Playwright 报错。
4. **不破坏调试现场**：暂停态不自动 `resume`，也不隐式切换调用帧。
5. **本地能力优先**：AI 是增强能力；可由本地分析完成的任务不因 AI 不可用而失败。
6. **最小集中改动**：优先扩展现有 `ToolDefinition`、`ToolPrerequisiteChecker` 和
   `ToolExecutionPipeline`。

## 5. 总体架构

```text
HTTP / RPC request
        |
        v
ToolExecutionPipeline
  1. load contract metadata
  2. strict parameter validation
  3. prerequisite check
  4. page health and debugger-state guard
  5. execute under timeout/abort budget
  6. normalize success or throw ToolError
  7. record telemetry and Job terminal state
        |
        +--> done   (real success only)
        `--> failed (all tool failures)
```

### 5.1 现有组件职责调整

| 组件                             | 调整后职责                                        |
| -------------------------------- | ------------------------------------------------- |
| `ToolDefinition`                 | 声明参数、分类、只读属性和运行需求                |
| `tools-meta` / Zod introspection | 从定义生成远程 CLI 可消费的完整契约               |
| `tool-arg-validator`             | 严格验证规范参数，不再执行旧参数别名映射          |
| `ToolPrerequisiteChecker`        | 统一检查 Page、Frame、Debugger、AI 和 native 工具 |
| `ToolExecutionPipeline`          | 固定执行顺序、暂停态门禁、错误规范化和遥测        |
| `ToolExecutionRouter`            | 仅负责按调用模式调用 handler，不承担契约判断      |
| `AIService`                      | 执行有界 AI 请求并提供可判定的可用性结果          |
| 分析工具                         | 组合本地分析与可选 AI 增强，返回统一分析元数据    |
| `apiV1.runJob`                   | 根据 Pipeline 抛错或返回值设置唯一 Job 终态       |

## 6. 声明式运行需求

### 6.1 元数据模型

在不修改 `defineTool` 必选字段的前提下，为 `ToolDefinition.annotations` 增加可选运行需求。
具体名称可在实现阶段按现有 manifest 类型收敛，但行为必须覆盖：

```typescript
interface ToolRuntimeRequirements {
  browser?: 'connected';
  page?: 'selected';
  frame?: 'selected';
  debugger?: 'available' | 'paused' | 'running';
  ai?: 'optional' | 'required';
  nativeTools?: string[];
}
```

约束：

- 新属性全部可选，保护 `defineTool` 高扇入接口。
- 未声明需求的工具不得被推断为需要页面。
- 页面、Frame、Debugger 需求由元数据生成并暴露到 `/api/v1/tools`。
- 恢复类工具必须显式声明可在异常页面状态下运行，不维护隐藏的工具名白名单。
- native 工具需求仅检查并报告，不自动安装。

### 6.2 前置条件检查顺序

1. Browser 是否连接。
2. 是否存在并选中 Page。
3. 是否存在可执行 Frame。
4. 页面健康状态是否允许该工具运行。
5. Debugger 当前状态是否符合工具要求。
6. AI 或 native 能力是否可用。

前置条件失败不得进入 handler。

## 7. Debugger 暂停态治理

### 7.1 状态来源

暂停状态来自当前页面已经存在的 `DebuggerManager`，通过无副作用的 peek 接口读取；检查
暂停状态不得为了探测而 eager-enable Debugger 或 Runtime 域。

### 7.2 行为矩阵

| 工具需求            | Debugger running       | Debugger paused            |
| ------------------- | ---------------------- | -------------------------- |
| 不依赖页面执行      | 允许                   | 允许                       |
| 需要页面/Frame 执行 | 允许                   | `DEBUGGER_PAUSED` 快速失败 |
| 需要 paused 调用帧  | `DEBUGGER_NOT_PAUSED`  | 允许                       |
| 恢复执行工具        | 返回稳定状态错误或执行 | 允许                       |

### 7.3 恢复指引

`DEBUGGER_PAUSED` 错误必须建议以下二选一动作：

- 调用 `resume` 后重试原工具。
- 若目标是在当前调用帧求值，改用 `evaluate_on_callframe`。

执行管线不得自动调用 `resume`，不得自动选择调用帧，也不得通过 isolated world 绕过暂停
状态后继续执行有副作用操作。

### 7.4 性能要求

暂停态前置检查应为内存状态读取。禁止等待现有 10 秒 evaluate 超时后再分类为暂停错误。

## 8. 参数契约统一

### 8.1 唯一契约

工具 Zod Schema 是参数名称、类型、必填项、默认值和枚举的唯一事实源。以下产物必须由其
生成或验证：

- Worker `ToolMeta.argSpecs`
- `/api/v1/tools` 响应
- `browsercli list-tools` 和 `browsercli call` 参数解析
- BrowserCLI Skill 命令示例
- 全工具契约测试向量

### 8.2 立即移除别名

- `tool-arg-validator` 不再读取或应用参数别名映射。
- 未在 Schema 中声明的参数一律返回 `VALIDATION`。
- 错误消息可以提供相似参数建议，但不得自动改写输入。
- 工具名称 aliases 不受本决策影响；本决策只针对参数名。

### 8.3 复杂参数

- `object`、`json` 和数组参数通过 `--data`、`--file` 或 stdin JSON 提供。
- CLI 不猜测对象结构，不把逗号分隔字符串隐式转换成数组。
- `string[]` 只接受字符串数组；若工具业务允许数字，应在该工具 Schema 中明确声明联合类型，
  而不是在全局 validator 中静默转型。
- 枚举严格区分大小写，错误中列出全部合法值。

### 8.4 文档一致性

扩展现有 `scripts/verify-skills-schema.ts`，验证：

1. 文档中的工具名存在。
2. 示例参数名存在于对应 Schema。
3. 必填参数在完整示例中出现。
4. 枚举字面量有效。
5. 数组和对象使用合法 JSON 表达。

## 9. 统一错误模型

### 9.1 ToolError 扩展

在现有 `ToolError` 上扩展结构化恢复信息，不创建并行错误类型：

```typescript
interface ToolFailure {
  code: string;
  message: string;
  toolName: string;
  retryable: boolean;
  recovery?: {
    tool?: string;
    command?: string;
    reason: string;
  };
  details?: Record<string, unknown>;
}
```

`recoverable` 现有字段在传输层映射为 `retryable`；实现不得同时维护含义冲突的两个布尔值。

### 9.2 新增或规范化错误码

| 错误码                | 触发条件                     | retryable | 建议恢复动作                       |
| --------------------- | ---------------------------- | --------- | ---------------------------------- |
| `VALIDATION`          | 参数不符合 Schema            | false     | 修正参数                           |
| `BROWSER_REQUIRED`    | Browser 未连接               | true      | 连接浏览器                         |
| `PAGE_REQUIRED`       | 未选择 Page                  | true      | `new_page` / `select_page`         |
| `FRAME_REQUIRED`      | 无可执行 Frame               | true      | `list_frames` / `select_frame`     |
| `PAGE_UNRESPONSIVE`   | 页面健康状态禁止执行         | true      | `check_browser_health` / 重连      |
| `DEBUGGER_PAUSED`     | running 工具遇到暂停页面     | true      | `resume` / `evaluate_on_callframe` |
| `DEBUGGER_NOT_PAUSED` | paused 工具在运行态调用      | true      | 命中断点或 `pause`                 |
| `SCRIPT_ID_STALE`     | scriptId 已失效              | true      | 重新 `list_scripts`                |
| `NATIVE_TOOL_MISSING` | 缺少外部二进制               | false     | 安装指定工具后重试                 |
| `AI_REQUIRED`         | 功能不能本地降级且 AI 不可用 | true      | 配置 AI Provider                   |
| `TIMEOUT`             | 工具超过预算                 | true      | 检查页面健康或缩小输入             |
| `RUNTIME`             | 未分类运行时异常             | 按上下文  | 查看 details                       |

保留已经对外使用的等价错误码时，应统一语义而非新增重复码。

### 9.3 Job 终态

- Handler 正常完成且未表达失败：Job `done`。
- 参数、前置条件、暂停态、依赖、超时或运行时失败：Job `failed`。
- Job 超时：`timed_out`。
- 客户端或断开操作取消：`cancelled`。
- 禁止 handler 返回 `success: false`、`error: ...` 或“失败：...”文本后由 Pipeline 记录为成功。

### 9.4 迁移检测

增加测试辅助函数识别明显的失败响应模式，包括：

- `structuredContent.success === false`
- 成功响应中只有 `error` 字段
- 工具 fixture 明确触发失败但 Pipeline 未 reject

文本启发式只用于测试迁移报告，不在生产运行时根据中文或英文字符串猜测失败。

## 10. AI 自动本地降级

### 10.1 适用工具

至少覆盖 `understand_code`、`summarize_code`、`analyze_target` 和 `risk_panel`。其他工具仅在
已存在确定性本地实现时加入。

### 10.2 执行策略

1. 先执行本地 AST、规则或已收集证据分析。
2. 检查 Provider 是否已配置且可用。
3. AI 可用时，在有界时间预算内执行增强分析。
4. 未配置、连接失败、速率限制或超时时，返回本地结果。
5. 本地无法完成核心语义且工具明确要求 AI 时，抛出 `AI_REQUIRED`。

### 10.3 响应元数据

分析工具统一包含：

```typescript
interface AnalysisExecutionMeta {
  analysisMode: 'ai' | 'local';
  fallbackReason?: 'not_configured' | 'unavailable' | 'timeout';
}
```

降级不是工具失败。只要本地分析完成，Job 状态为 `done`，并在响应中公开降级原因。

### 10.4 重试和超时

- 未配置 Provider 时不得发起请求或 sleep。
- AI 请求必须接受 Job 的 AbortSignal 或等价取消机制。
- AI 重试总时长受单次工具预算约束，不允许默认指数退避占满 Worker Job 硬超时。
- 降级发生后不得在后台继续遗留 AI 请求。

## 11. 验证体系

### 11.1 全工具契约测试

遍历注册表中的全部工具，并验证：

- `ToolDefinition` 可加载。
- Schema 与 `argSpecs` 一致。
- `/api/v1/tools` 可序列化完整契约。
- BrowserCLI 能构造合法参数并拒绝未知参数。
- Skill 文档示例与 Schema 一致。
- 每个运行需求均能映射到已实现的 prerequisite checker。

该层不启动浏览器，不调用 AI 或 native 工具。

### 11.2 分类集成测试

使用本地确定性测试页和 fixture 覆盖：

- 页面与 Frame
- 脚本与 SourceMap
- Hook 与 Debugger
- DOM 输入与媒体
- HTTP、请求发起者和 WebSocket
- Wasm 捕获、解析与缺失 native 工具
- 会话快照与重建 Bundle
- AI 正常、未配置、超时和降级

分类集成测试必须通过注册表生成工具集合，并检查该类别没有遗漏注册工具。

### 11.3 真实浏览器 E2E

仅覆盖高风险主链路：

1. 创建并选择本地测试页。
2. 暂停页面，验证页面执行工具快速返回 `DEBUGGER_PAUSED`。
3. 在暂停状态使用 `evaluate_on_callframe`，随后 `resume` 并恢复普通工具。
4. 注入 Hook 并捕获数据。
5. 捕获 HTTP 请求、请求发起者和 WebSocket 消息。
6. 捕获最小 Wasm 模块并执行 dump/inspect 主链路。
7. 保存、清除并恢复会话状态。

测试不得访问真实生产站点。

### 11.4 跨平台测试修复

- 删除或更新指向已迁移模块的测试 import。
- 日志和导出文件名使用跨平台安全时间戳。
- native 工具缺失测试必须断言 `NATIVE_TOOL_MISSING`，不得依赖本机是否已安装。
- Windows 与非 Windows CI 使用相同契约测试，平台专属行为使用显式条件测试。

## 12. 数据流

### 12.1 成功调用

```text
raw params
  -> strict schema validation
  -> prerequisite/state guards
  -> handler
  -> normalized structuredContent
  -> telemetry success
  -> JobStore.complete
```

### 12.2 失败调用

```text
validation / prerequisite / handler error
  -> ToolError normalization
  -> telemetry failure
  -> structured error transport
  -> JobStore.fail
```

### 12.3 AI 降级调用

```text
local analysis
  -> AI unavailable or budget exceeded
  -> local result + AnalysisExecutionMeta
  -> telemetry success with analysisMode=local
  -> JobStore.complete
```

## 13. 迁移顺序

### 阶段 A：建立失败基线

- 增加错误结构、契约测试框架和全工具清单覆盖检查。
- 锁定当前错误响应模式，但不立即批量修改 handler。
- 修复测试 import 与跨平台测试基础设施，使新增门禁可稳定运行。

### 阶段 B：集中门禁

- 扩展声明式运行需求。
- 扩展 `ToolPrerequisiteChecker`。
- 在 `ToolExecutionPipeline` 接入严格顺序和暂停态快速失败。
- 用元数据替换页面健康恢复工具名白名单。

### 阶段 C：错误语义迁移

- 按类别迁移 handler，使失败抛出 `ToolError`。
- 消除“失败但 Job done”。
- 更新 CLI 对 Job error 的展示和退出码。

### 阶段 D：参数与 AI

- 删除参数别名归一化。
- 修正文档、CLI 示例和测试向量。
- 接入 AI 可用性检查、有界请求与本地降级。

### 阶段 E：全链路验收

- 运行全工具契约测试。
- 运行全部分类集成测试。
- 运行真实浏览器高风险 E2E。
- 运行类型检查、单元测试和格式检查。

## 14. 影响范围

预计涉及但不限于：

| 领域       | 主要文件或目录                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| 工具契约   | `src/tools/ToolDefinition.ts`, `src/tools/manifest.ts`, `src/tools/tools-meta.ts`, `src/tools/zod-introspect.ts` |
| 参数校验   | `src/tools/tool-arg-validator.ts`, `src/tools/tool-aliases.ts`, `browsercli/src/commands/shared/tool-args.ts`    |
| 前置条件   | `src/tools/prerequisites/ToolPrerequisiteChecker.ts`                                                             |
| 执行与错误 | `src/worker/ToolExecutionPipeline.ts`, `src/worker/ToolResponse.ts`, `src/utils/errors.ts`                       |
| Job 终态   | `src/web/routes/apiV1.ts`, `src/worker/JobStore.ts`                                                              |
| 调试器状态 | `src/modules/debugger/DebuggerManager.ts`, `src/modules/debugger/types.ts`, `src/worker/ToolContext.ts`          |
| AI 降级    | `src/services/AIService.ts`, `src/runtime/RuntimeServices.ts`, 对应分析工具                                      |
| CLI 契约   | `browsercli/src/tool-meta-types.ts`, `browsercli/src/commands/`                                                  |
| 文档校验   | `scripts/verify-skills-schema.ts`, BrowserCLI Skill 文档                                                         |
| 测试       | `tests/unit/worker/`, `tests/unit/tools/`, `tests/integration/`, 浏览器 E2E fixture                              |

实施前必须对 `defineTool`、`ToolExecutionPipeline` 和 `ToolError` 运行影响分析，并分批验证
高扇入调用方。

## 15. 验收标准

1. 注册表中的每个工具均被全工具契约测试覆盖，新增工具未加入契约测试时 CI 失败。
2. 暂停页面后，任一声明需要 running Page/Frame 的工具在 250ms 内返回
   `DEBUGGER_PAUSED`，不触发 evaluate 盲等超时。
3. 暂停态检查不自动调用 `resume`，调试调用栈和断点保持不变。
4. 参数别名不再被接受；未知参数返回 `VALIDATION` 和规范参数建议。
5. 文档、远程工具元数据和 CLI 参数契约一致性测试通过。
6. 工具业务失败导致 Job `failed`；不得出现失败响应被记录为 `done`。
7. 无页面、无 Frame、陈旧 scriptId 和缺失 native 工具返回稳定错误码及恢复建议。
8. AI 未配置时，支持本地分析的工具不发起外部请求，并在 2 秒内返回
   `analysisMode: local` 与 `fallbackReason: not_configured`。
9. AI 超时后不遗留后台请求；本地降级成功的 Job 状态为 `done`。
10. 高风险真实浏览器 E2E 覆盖暂停/恢复、Hook、网络、WebSocket、Wasm 和会话恢复。
11. 最终 diff 通过相关单测、`npm run typecheck`、`npm run test:unit` 和
    `npm run check-format`；任何预存失败必须单独记录，不能由新检查掩盖。

## 16. 风险与缓解

| 风险                           | 缓解措施                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------- |
| 立即移除参数别名造成调用方失败 | 同一变更中更新 CLI、Skill 文档、示例和契约测试；以明确 `VALIDATION` 替代静默兼容 |
| 大量 handler 迁移导致回归      | 按工具类别分批迁移，每批先锁定失败行为测试                                       |
| 暂停态检测误触发 CDP 域        | 只读取现有 DebuggerManager 状态，不为检查而初始化调试器                          |
| AI 降级输出与 AI 结果能力不同  | 响应明确 `analysisMode`，本地不能完成核心语义时返回 `AI_REQUIRED`                |
| E2E 运行时间过长               | 全量覆盖放在无浏览器契约层，浏览器 E2E 只覆盖高风险代表链路                      |
| 与既有页面健康设计重叠         | 复用 `PageHealthTracker` 和 Pipeline 守卫，仅补充声明式恢复能力和暂停状态        |

## 17. 决策记录

- 选择集中治理，不逐工具复制基础设施逻辑。
- 不建立独立契约注册中心，继续以 `defineTool` 和生成元数据为核心。
- 参数立即统一，不保留旧参数别名兼容期。
- AI 不可用时自动本地降级。
- 工具失败必须令 Job 进入 `failed`。
- 验证采用全量契约、分类集成和少量真实浏览器 E2E 三层门禁。
