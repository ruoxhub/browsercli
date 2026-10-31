# Repository Guidelines

## 开发原则

- **KISS（保持简单）**：优先选择最简单、直接且足以解决当前问题的实现。
- **SRP（单一职责）**：一个模块只负责一件事，并明确其职责边界。
- **DRY（不重复）**：避免重复实现相同逻辑，优先复用或提取公共能力。
- **显式优于隐式**：配置、依赖和状态必须清晰、明确且可追踪。
- **代码是给人看的**：可读性永远优先于炫技和不必要的技巧。

## Project Structure &amp; Module Organization

核心源码位于 `src/`。其中 `src/tools/` 提供 MCP 工具实现，`src/modules/` 放逆向分析、Hook、调试、去混淆等核心模块；`src/worker/` 是后台 worker 运行时（`src/index.ts` 为进程入口）。命令行客户端位于 `src/cli/`（`browsercli` 可执行命令），通过本地命名管道（POSIX 为 unix socket）与 detached daemon 会话通信：CLI 按 workspace-hash 注册表（`%LOCALAPPDATA%\browsercli\daemon`）发现会话，连不上就自动 spawn daemon 并等 stdout 就绪行握手（不再内置本地 worker 进程管理，start/stop/status/repl 等命令已删除；原 `/api/v1` HTTP 契约与 Sekiro RPC 均已下线）。构建产物输出到 `build/`，不要手改。文档集中在 `docs/`，公开案例与脚本入口在 `scripts/cases/`。真实任务证据默认保留在 `artifacts/tasks/<task-id>/`，仓库只跟踪模板目录。

## Build, Test, and Development Commands

先使用 `npm install` 安装依赖，要求 Node `^20.19.0 || ^22.12.0 || >=23`。

- `npm run build`：编译 `src/` 与 `tests/` 到 `build/`
- `npm run start`：构建后启动 MCP 服务
- `npm run start-debug`：以 `DEBUG=mcp:*` 启动，适合排查工具链问题
- `npm test`：构建后运行全部测试
- `npm run test:unit` / `npm run test:integration` / `npm run test:property` / `npm run test:perf`：按类型执行测试
- `npm run typecheck`：只做 TypeScript 类型检查
- `npm run format` / `npm run check-format`：自动格式化或只检查格式

## Coding Style &amp; Naming Conventions

项目使用 TypeScript ESM。Prettier 规则要求 `singleQuote: true`、`trailingComma: all`、`arrowParens: avoid`、`endOfLine: lf`。遵循 ESLint 平铺配置：导入按字母序分组，类型导入/导出必须显式，优先使用 `interface`，Node 内置模块使用 `node:` 前缀。文件名与现有结构保持一致，工具测试推荐使用 `*.test.ts`，集成测试使用 `*.integration.test.ts`。

## Testing Guidelines

测试框架为 Node 内置 `node:test`，覆盖目录包括 `tests/unit/`、`tests/integration/`、`tests/property/`、`tests/performance/`。新增代码时至少补对应层级测试，并保持源码目录与测试目录镜像，例如 `src/config/schema.ts` 对应 `tests/unit/config/schema.test.ts`。覆盖率目标参考 `tests/README.md` 中的 80%；提交前至少运行 `npm run test:unit` 与 `npm run check-format`。

### 最终变更验证闭环

代码任务交接前必须以最终 diff 为边界完成验证：选择与改动直接相关的最小测试，并运行适用的 `npm run typecheck`、`npm run test:unit`、`npm run check-format`。如果检查失败，先保留失败与修复之间的对应关系，再在最后一次代码修改后重跑同一检查。只有最终变更的相关检查通过后才能报告完成；无法运行或仍失败时，明确交接阻塞项，不得用修改前的通过结果代替。

## Commit &amp; Pull Request Guidelines

近期提交采用 Conventional Commits 风格，如 `feat: ...`、`fix(daemon): ...`、`build: ...`、`docs: ...`。提交信息应说明变更范围与目的，避免笼统的 “update”。PR 需写清问题背景、方案摘要、验证命令；若涉及文档、CLI 输出或调试流程，附示例命令或截图。不要提交真实 Cookie、Storage、生产参数或 `artifacts/tasks/` 中的私有任务内容。

## Security &amp; Configuration Tips

外部 LLM 配置优先通过 MCP client 的 `env` 注入；仅在本地直跑时使用 `.env`。提交前确认敏感 host、URL、凭证和会话状态已脱敏，公开 case 统一维护在 `scripts/cases/README.md`。

## Architecture Notes

仓库默认遵循 README 中的逆向方法论：`Observe-first`、`Hook-preferred`、`Breakpoint-last`、`Evidence-first`。贡献新能力时，优先扩展可复用工具与证据沉淀链路，而不是把一次性调试逻辑直接写死在脚本里。涉及公开案例时，只保留抽象流程、字段规范和脱敏样例，避免提交可直接复用的生产链路。

### 核心运行时组件

以下组件构成 MCP 工具的运行时基础。修改时请注意依赖链。

| 组件                  | 文件                                     | 职责                                           |
| --------------------- | ---------------------------------------- | ---------------------------------------------- |
| EventBus              | `src/utils/EventBus.ts`                  | 类型安全事件总线，全局单例                     |
| RuntimeServices       | `src/runtime/RuntimeServices.ts`         | 延迟初始化服务集合（抓包、Wasm、SourceMap 等） |
| BrowserManager        | `src/modules/browser/browser.ts`         | 浏览器生命周期、页面管理、反检测注入           |
| CodeCollector         | `src/modules/collector/CodeCollector.ts` | 脚本收集 + 缓存 + 搜索                         |
| HookManager           | `src/modules/hook/HookManager.ts`        | Hook 创建、管理、数据存取门面                  |
| HookStore             | `src/modules/hook/HookStore.ts`          | Hook 采样数据存储层                            |
| HookCodeBuilder       | `src/modules/hook/HookCodeBuilder.ts`    | Hook 脚本链式构建器                            |
| ToolRegistry          | `src/tools/registry/ToolRegistry.ts`     | MCP 工具注册表 + toolProfile 过滤              |
| ToolExecutionPipeline | `src/worker/ToolExecutionPipeline.ts`    | 工具执行管线（校验→上下文→执行→响应）          |
| WsHub                 | `src/ipc/eventHub.ts`                    | IPC 事件分发中心                               |

### 高扇入接口（@stable）

以下函数/接口被大量调用方依赖，修改签名或返回类型前**必须**运行 impact 分析。
扩展时使用可选属性或 `Partial<>`，不要修改必选参数。

| 符号            | 文件                          | 调用方数 | 说明                                                       |
| --------------- | ----------------------------- | -------- | ---------------------------------------------------------- |
| `defineTool`    | `src/tools/ToolDefinition.ts` | 102+     | 工具定义工厂，所有 MCP 工具通过此注册                      |
| `Runtime`       | `src/runtime.ts`              | 57+      | 运行时服务接口，新增服务应走 `RuntimeServices` lazy getter |
| `getRuntime`    | `src/runtime.ts`              | 57+      | 全局运行时访问器                                           |
| `safeStringify` | `src/utils/safeJson.ts`       | 16       | JSON 安全序列化                                            |
| `getEnvValue`   | `src/config/resolver.ts`      | 11       | 环境变量读取                                               |


<!-- code-review-graph MCP tools -->

## MCP Tools: code-review-graph

**This project has a knowledge graph. Start with the code-review-graph
MCP tools to narrow scope, then read the source.** The graph is cheaper than scanning files and
gives you structural context (callers, dependents, test coverage) that file search cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

### Verify in the source

- Narrow scope with the graph, then read the source. Do not change code from graph output alone.
- For any non-trivial change, read the implementation and the relevant tests before concluding.
- Verify the exact source when touching behavior, database logic, migrations, retries, fallbacks,
  recovery, or compatibility code.
- When the graph and the source disagree, the source wins. The graph may be stale or may not
  model that relationship.
- An empty graph result can mean "not indexed" or "not statically visible", not "does not exist".

### Key Tools

| Tool                             | Use when                                               |
| -------------------------------- | ------------------------------------------------------ |
| `detect_changes_tool`            | Reviewing code changes — gives risk-scored analysis    |
| `get_review_context_tool`        | Need source snippets for review — token-efficient      |
| `get_impact_radius_tool`         | Understanding blast radius of a change                 |
| `get_affected_flows_tool`        | Finding which execution paths are impacted             |
| `query_graph_tool`               | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool`     | Finding functions/classes by name or keyword           |
| `get_architecture_overview_tool` | Understanding high-level codebase structure            |
| `refactor_tool`                  | Planning renames, finding dead code                    |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
<!-- /code-review-graph MCP tools -->

## Agent skills

### Issue tracker

GitHub Issues（`ruoxhub/browsercli`，用 `gh` CLI）。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个规范分诊角色映射到同名标签字符串。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文：根目录 `GLOSSARY.md` + `docs/adr/`。见 `docs/agents/domain.md`。
