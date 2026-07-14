# MCP Alignment Design Spec

**Date**: 2026-06-10
**Branch**: refactor
**Approach**: 方案 A — 逐模块迁移，适配 CLI 架构
**Phasing**: 3 阶段递进 (P0 → P1 → P2)

## Background

JSReverser-CLI (本项目) 已参考 JSReverser-MCP 完成了核心模块迁移（逆向任务编排、参数工作流等），但在 6 个维度上存在差距：环境诊断、知识库、Agent 响应协议、Trace 输出、并发控制、文档深度。本设计描述如何将 MCP 的这些能力逐模块迁移到 CLI 项目中，同时适配 CLI 的 manifest/domain 注册体系、Worker 架构和 CLI 命令行接口。

## Gap Analysis

| 差距                    | MCP 实现                                                               | CLI 现状                                                     |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| Environment Diagnostics | `diagnose_environment` tool + `diagnostics/` module                    | 无自检查/doctor 能力                                         |
| Knowledge Base          | `docs/knowledge/parameter-blueprints/` 结构化知识库                    | 无 knowledge 目录                                            |
| Agent Response Protocol | `response-builder.ts` 统一 continuation 字段、route guard、invoke hint | 无结构化 agent 响应协议                                      |
| Trace Output            | `trace-output.ts` 选择性 traceId 调试输出                              | 无 trace 输出模式                                            |
| Concurrency Control     | `Mutex.ts` FIFO guard 模式                                             | 无显式互斥锁                                                 |
| Documentation Depth     | 9 guides + 20 reference docs + client prompt                           | 较少 guides，缺失 troubleshooting/orchestration/agent guides |

## Phase 0: Core Runtime (P0)

### 1.1 Environment Diagnostics Module

新建 `src/diagnostics/` 目录：

```
src/diagnostics/
  types.ts          — DiagnosticCheck, DiagnosticReport, DiagnosticStatus 类型
  environment.ts    — 检查 Node 版本、构建产物、AI 配置、浏览器连接、路径权限
  index.ts          — runEnvironmentDiagnostics() 聚合入口
```

**检查项清单**：

| 检查项                | 检查内容                                                       | 适配点                                                     |
| --------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| `node_version`        | Node 版本是否在支持范围内 (`^20.19.0 \|\| ^22.12.0 \|\| >=23`) | 直接迁移                                                   |
| `build_output`        | `build/src/bin/js-reverse.js` 是否存在                         | 适配 CLI 的构建入口路径                                    |
| `ai_config`           | AI provider 配置状态（API key 或 CLI path）                    | 改为读取 `src/config/resolver.ts` + `src/config/schema.ts` |
| `browser_connection`  | 浏览器连接是否可达                                             | 适配 `SessionManager` + `DevToolsConnectionAdapter`        |
| `artifacts_directory` | `artifacts/tasks/` 目录是否存在且可写                          | 直接迁移                                                   |
| `worker_health`       | Worker 进程是否可达                                            | CLI 独有能力，新增检查项                                   |

**DiagnosticReport 结构**：

```typescript
export type DiagnosticStatus = 'ok' | 'warn' | 'fail';

export interface DiagnosticCheck {
  name: string;
  status: DiagnosticStatus;
  reason: string;
  fix: string;
  details?: Record<string, unknown>;
}

export interface DiagnosticReport {
  timestamp: string;
  checks: DiagnosticCheck[];
  summary: {
    ok: number;
    warn: number;
    fail: number;
  };
}
```

### 1.2 Diagnose Environment Tool

新建 `src/tools/diagnostics/` 工具域：

```
src/tools/diagnostics/
  diagnoseEnvironment.ts  — diagnose_environment 工具实现
  manifest.ts             — DomainManifest 注册
  index.ts
  types.ts
```

**工具定义**：

- 名称：`diagnose_environment`
- 类别：`ToolCategory.DIAGNOSTICS`（需新增枚举值到 `src/tools/categories.ts`）
- Profile：`search`（所有 profile 均可见）
- Schema：可选 `checks` 参数（string array，指定只运行哪些检查）
- 输出：JSON 格式的 `DiagnosticReport`
- 只读提示：`readOnlyHint: true`

**manifest.ts 示例**：

```typescript
import type {DomainManifest} from '../../manifest.js';

export const diagnosticsManifest: DomainManifest = {
  name: 'diagnostics',
  description: 'Environment diagnostics and health checks',
  tools: [
    {
      modulePath: 'diagnostics/diagnoseEnvironment.js',
      handlerName: 'diagnoseEnvironmentTool',
      profile: 'search',
    },
  ],
};
```

### 1.3 Trace Output Module

新建 `src/tools/shared/trace-output.ts`：

```typescript
export type TraceOutputMode = 'errors' | 'all';

export function resolveTraceOutputMode(
  globalMode: string | undefined,
  requestMode: unknown,
): TraceOutputMode {
  if (requestMode === 'all' || requestMode === 'errors') {
    return requestMode;
  }
  return globalMode === 'all' ? 'all' : 'errors';
}

export function withOptionalTraceIdContent(
  content: Array<{type: string; text?: string}>,
  traceId: string,
  mode: string | undefined,
): Array<{type: string; text?: string}> {
  if (mode !== 'all') {
    return content;
  }
  return [{type: 'text', text: JSON.stringify({traceId}, null, 2)}, ...content];
}
```

**集成点**：

- `src/cli/args-parser.ts`：增加 `--traceOutput` 参数（`'errors' | 'all'`，默认 `'errors'`）
- `src/cli/commands/start.ts`：将 traceOutput 传递到 worker 启动配置
- `src/cli/commands/tool-dispatcher.ts`：在工具调用返回时调用 `withOptionalTraceIdContent()`
- Worker 启动时接收 traceOutput 配置，写入 worker 配置

### 1.4 Mutex

> **已存在**：`src/utils/Mutex.ts` 已在 CLI 项目中存在（与 MCP 完全相同的 FIFO 实现）。无需迁移，可直接使用。

**未来集成场景**（后续按需接入）：

- `HookManager`：注入/移除 hook 时的并发保护
- `ReverseTaskStore`：写操作互斥
- 其他有并发风险的模块

### 1.5 P0 File Changes

| 操作 | 路径                                           | 说明                      |
| ---- | ---------------------------------------------- | ------------------------- |
| 新建 | `src/diagnostics/types.ts`                     | 诊断类型定义              |
| 新建 | `src/diagnostics/environment.ts`               | 环境检查实现              |
| 新建 | `src/diagnostics/index.ts`                     | 聚合导出                  |
| 新建 | `src/tools/diagnostics/diagnoseEnvironment.ts` | 工具实现                  |
| 新建 | `src/tools/diagnostics/manifest.ts`            | DomainManifest 注册       |
| 新建 | `src/tools/diagnostics/index.ts`               | 域导出                    |
| 新建 | `src/tools/diagnostics/types.ts`               | 工具类型                  |
| 新建 | `src/tools/shared/trace-output.ts`             | Trace 输出控制            |
| 修改 | `src/tools/categories.ts`                      | 新增 `DIAGNOSTICS` 枚举值 |
| 修改 | `src/cli/args-parser.ts`                       | 增加 `--traceOutput` 参数 |
| 修改 | `src/cli/commands/start.ts`                    | 传递 traceOutput 选项     |
| 新建 | `tests/unit/diagnostics/environment.test.ts`   | 诊断模块测试              |
| 新建 | `tests/unit/tools/shared/trace-output.test.ts` | Trace 输出测试            |

## Phase 1: Agent Response Protocol (P1)

### 2.1 Response Builder Module

新建 `src/tools/shared/response-builder.ts`。

**核心类型**：

```typescript
export type OutputMode = 'compact' | 'verbose';
export type AgentOutcome = 'success' | 'partial' | 'blocked';
export const REVERSE_AGENT_SCHEMA_VERSION = '1.0';

export interface ContinuationInvokeHint {
  requiredParams: string[];
  optionalParams?: string[];
  example?: Record<string, unknown>;
}

export interface ContinuationShape {
  ready: boolean;
  reason: string;
  tool?: string;
  params?: Record<string, unknown>;
  invoke?: {tool: string; params?: Record<string, unknown>};
  invokeHint?: ContinuationInvokeHint;
  toolClass?: 'task' | 'orchestration' | 'rebuild' | 'analysis';
  routeHint?:
    | 'stay_on_task_flow'
    | 'switch_to_orchestration'
    | 'switch_to_rebuild'
    | 'switch_to_analysis';
  strategy?: string;
  resumeCommand?: string;
  actionKey?: string;
}

export interface UnifiedContinuationFields {
  outcome: AgentOutcome;
  shouldResume: boolean;
  shouldSwitchStrategy: boolean;
  nextBestTool?: string;
  nextBestParams?: Record<string, unknown>;
  errorCode?: string;
  errorType?: string;
  retryable?: boolean;
  blockedBy?: string;
  detailLevel: 'minimal' | 'standard';
  routeGuard?: {
    preferredToolClass?: 'task' | 'orchestration' | 'rebuild' | 'analysis';
    routeHint?:
      | 'stay_on_task_flow'
      | 'switch_to_orchestration'
      | 'switch_to_rebuild'
      | 'switch_to_analysis';
    avoidTools?: string[];
  };
  continuation: ContinuationShape;
}
```

**核心函数**（从 MCP 迁移，纯逻辑无需适配）：

| 函数                                                       | 用途                                   |
| ---------------------------------------------------------- | -------------------------------------- |
| `compactAgentPayload(payload, outputMode)`                 | compact 模式裁剪冗余字段               |
| `withSchemaVersion(payload)`                               | 注入 schema 版本号                     |
| `buildInvokeHint(tool, params)`                            | 生成工具调用提示                       |
| `inferBlockedBy(reason)`                                   | 推断阻塞来源                           |
| `inferOutcomeFromStatus(status)`                           | 推断执行结果                           |
| `buildTaskDiagnostics(action, outputMode, taskId)`         | 构建任务诊断数据                       |
| `buildManageSummaryText(action, payload)`                  | 构建 manage 操作摘要文本               |
| `compactManagePayload(action, payload, outputMode)`        | compact 模式裁剪 manage 响应           |
| `buildManageContinuation(action, payload, fallbackReason)` | 构建 manage 操作的 continuation        |
| `buildOrchestrationContinuation(input)`                    | 构建 orchestration 操作的 continuation |
| `buildRebuildContinuation(input)`                          | 构建 rebuild 操作的 continuation       |

### 2.2 Integration Points

CLI 项目中 response-builder 的集成位置：

| 文件                                     | 集成方式                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/reverse/ReverseTaskAdmin.ts`        | manage_reverse_task 返回时附加 `UnifiedContinuationFields`                          |
| `src/reverse/ReverseTaskOrchestrator.ts` | orchestrate_reverse_task 返回时调用 `buildOrchestrationContinuation()`              |
| `src/reverse/ReverseAgentRunner.ts`      | run_reverse_agent 返回时调用 `compactAgentPayload()` + `withSchemaVersion()`        |
| `src/tools/workflow/rebuildBundle.ts`    | export_rebuild_bundle / get_rebuild_health_report 调用 `buildRebuildContinuation()` |

### 2.3 Response Schema Documentation

新建 `docs/reference/` 下的 JSON Schema 文件：

- `manage-response.schema.json` — manage_reverse_task 响应结构
- `orchestrate-response.schema.json` — orchestrate_reverse_task 响应结构
- `rebuild-health-response.schema.json` — get_rebuild_health_report 响应结构
- `reverse-agent-response.schema.json` — run_reverse_agent 响应结构
- `reverse-agent-schema-versioning.md` — Schema 版本策略（何时 bump major/minor）

Schema 内容从 MCP 对应文件迁移，调整字段名以匹配 CLI 工具命名。

### 2.4 P1 File Changes

| 操作 | 路径                                                 | 说明                            |
| ---- | ---------------------------------------------------- | ------------------------------- |
| 新建 | `src/tools/shared/response-builder.ts`               | Agent 响应协议（约 630 行）     |
| 修改 | `src/reverse/ReverseTaskAdmin.ts`                    | 集成 continuation 字段          |
| 修改 | `src/reverse/ReverseTaskOrchestrator.ts`             | 集成 orchestration continuation |
| 修改 | `src/reverse/ReverseAgentRunner.ts`                  | 集成 agent continuation         |
| 新建 | `docs/reference/manage-response.schema.json`         | manage 响应 Schema              |
| 新建 | `docs/reference/orchestrate-response.schema.json`    | orchestrate 响应 Schema         |
| 新建 | `docs/reference/rebuild-health-response.schema.json` | rebuild health 响应 Schema      |
| 新建 | `docs/reference/reverse-agent-response.schema.json`  | agent 响应 Schema               |
| 新建 | `docs/reference/reverse-agent-schema-versioning.md`  | Schema 版本策略                 |
| 新建 | `tests/unit/tools/shared/response-builder.test.ts`   | 协议层测试                      |

## Phase 2: Knowledge Base & Documentation (P2)

### 3.1 Parameter Blueprints Knowledge Base

新建 `docs/knowledge/parameter-blueprints/` 目录。

**目录结构**：

```
docs/knowledge/parameter-blueprints/
  index.json                              — 所有 blueprint 的索引
  jd-h5st/
    metadata.json                         — id, title, aliases, category, summary
    parts.json                            — 参数组成部分定义
    mutations.json                        — 参数变异规则
    workflow.md                           — 逆向工作流文档
  ks-hxfalcon/
    metadata.json
    mutations.json
    workflow.md
  douyin-a-bogus/
    metadata.json
    parts.json
    mutations.json
    workflow.md
  generic-query-token/
    metadata.json
    workflow.md
  generic-header-sign/
    metadata.json
    workflow.md
```

**index.json 结构**：

```json
{
  "version": 1,
  "items": [
    {
      "id": "jd-h5st",
      "path": "jd-h5st",
      "aliases": ["h5st", "京东h5st"],
      "category": "query-sign"
    },
    {
      "id": "ks-hxfalcon",
      "path": "ks-hxfalcon",
      "aliases": ["falcon", "快手falcon"],
      "category": "risk-param"
    }
  ]
}
```

**内容来源**：从 `JSReverser-MCP/docs/knowledge/parameter-blueprints/` 原样复制。这些是纯知识文档，不涉及代码适配。

**集成**：CLI 的 `ParameterWorkflowLibrary`（`src/modules/workflows/ParameterWorkflowLibrary.ts`）已经设计为读取该目录结构。

### 3.2 Guides to Add

| 文件                                            | 内容                 | 来源                     | 适配点                                 |
| ----------------------------------------------- | -------------------- | ------------------------ | -------------------------------------- |
| `docs/guides/troubleshooting.md`                | 常见故障排查         | MCP `troubleshooting.md` | 增加 CLI worker 相关排查、CLI 命令排错 |
| `docs/guides/reverse-task-orchestration.md`     | 任务编排详细指南     | MCP 同名文件             | 增加 CLI 命令示例                      |
| `docs/guides/mcp-agent-quick-reference.md`      | Agent 使用快速参考   | MCP 同名文件             | 补充 CLI 调用方式                      |
| `docs/guides/mcp-client-auto-resume-example.md` | 客户端自动续接示例   | MCP 同名文件             | 无修改                                 |
| `docs/guides/client-system-prompt.md`           | 客户端系统提示词模板 | MCP 同名文件             | 补充 CLI 工具名映射                    |

### 3.3 Reference Docs to Add

| 文件                                                 | 内容                        | 来源                                  |
| ---------------------------------------------------- | --------------------------- | ------------------------------------- |
| `docs/reference/pure-extraction.md`                  | env-pass 后的纯提取阶段指南 | MCP 迁移                              |
| `docs/reference/parameter-blueprint-template.md`     | Blueprint 贡献模板          | MCP `parameter-blueprint-template.md` |
| `docs/reference/parameter-blueprint-contribution.md` | Blueprint 贡献规范          | 新建                                  |

**更新现有文件**：

- `docs/reference/tool-reference.md` — 补充 `diagnose_environment` 工具参数说明

### 3.4 P2 File Changes

| 操作 | 路径                                                 | 说明                      |
| ---- | ---------------------------------------------------- | ------------------------- |
| 新建 | `docs/knowledge/parameter-blueprints/` (13+ files)   | 参数蓝图知识库            |
| 新建 | `docs/guides/troubleshooting.md`                     | 故障排查                  |
| 新建 | `docs/guides/reverse-task-orchestration.md`          | 编排指南                  |
| 新建 | `docs/guides/mcp-agent-quick-reference.md`           | Agent 快速参考            |
| 新建 | `docs/guides/mcp-client-auto-resume-example.md`      | 自动续接示例              |
| 新建 | `docs/guides/client-system-prompt.md`                | 系统提示词模板            |
| 新建 | `docs/reference/pure-extraction.md`                  | 纯提取指南                |
| 新建 | `docs/reference/parameter-blueprint-template.md`     | Blueprint 模板            |
| 新建 | `docs/reference/parameter-blueprint-contribution.md` | Blueprint 贡献规范        |
| 修改 | `docs/reference/tool-reference.md`                   | 补充 diagnose_environment |

## Testing Strategy

### P0 Tests

- `tests/unit/diagnostics/environment.test.ts`：验证每个检查项的判断逻辑和 fix 建议
- `tests/unit/tools/shared/trace-output.test.ts`：验证 mode 解析和 traceId 注入

### P1 Tests

- `tests/unit/tools/shared/response-builder.test.ts`：验证所有 builder 函数的输出结构、compact 模式裁剪、schema 版本号注入、invoke hint 生成

### P2 Tests

- 文档验证：确保 `index.json` 中的路径引用全部有效
- Blueprint 格式验证：确保每个 metadata.json 符合约定 schema

## Risk Assessment

| 风险                                         | 级别 | 缓解措施                                           |
| -------------------------------------------- | ---- | -------------------------------------------------- |
| 诊断模块依赖 config resolver 的内部 API      | 低   | config resolver 接口稳定，已通过类型约束           |
| Response builder 集成修改 ReverseTask\* 文件 | 中   | 逐文件集成，每个文件修改后运行现有测试验证         |
| Blueprint 内容可能与 CLI 工具名不一致        | 低   | 工具名在两个项目间保持一致（均为 snake_case）      |
| Trace output 需要修改 worker 启动流程        | 低   | traceOutput 作为可选参数传递，默认值不影响现有行为 |

## Success Criteria

- P0：`diagnose_environment` 工具可通过 MCP 或 CLI 调用返回完整诊断报告
- P1：`manage_reverse_task` / `orchestrate_reverse_task` / `run_reverse_agent` 返回包含 `continuation` 字段的结构化响应
- P2：`list_parameter_workflows` 返回 5+ 个 blueprint，docs 目录覆盖所有 MCP 同级文档
