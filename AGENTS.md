# Repository Guidelines

## 开发原则

- **KISS（保持简单）**：优先选择最简单、直接且足以解决当前问题的实现。
- **SRP（单一职责）**：一个模块只负责一件事，并明确其职责边界。
- **DRY（不重复）**：避免重复实现相同逻辑，优先复用或提取公共能力。
- **显式优于隐式**：配置、依赖和状态必须清晰、明确且可追踪。
- **代码是给人看的**：可读性永远优先于炫技和不必要的技巧。

## Project Structure &amp; Module Organization

核心源码位于 `src/`。其中 `src/tools/` 提供 MCP 工具实现，`src/modules/` 放逆向分析、Hook、调试、去混淆等核心模块，`src/services/` 负责外部 AI 与服务集成；`src/worker/` 是后台 worker 运行时（`src/index.ts` 为进程入口）。命令行客户端位于 `src/cli/`（`browsercli` 可执行命令），通过本地命名管道（POSIX 为 unix socket）与 detached daemon 会话通信：CLI 按 workspace-hash 注册表（`%LOCALAPPDATA%\browsercli\daemon`）发现会话，连不上就自动 spawn daemon 并等 stdout 就绪行握手（不再内置本地 worker 进程管理，start/stop/status/repl 等命令已删除；原 `/api/v1` HTTP 契约与 Sekiro RPC 均已下线）。构建产物输出到 `build/`，不要手改。文档集中在 `docs/`，公开案例与脚本入口在 `scripts/cases/`。真实任务证据默认保留在 `artifacts/tasks/<task-id>/`，仓库只跟踪模板目录。

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

测试框架为 Node 内置 `node:test`，覆盖目录包括 `tests/unit/`、`tests/integration/`、`tests/property/`、`tests/performance/`。新增代码时至少补对应层级测试，并保持源码目录与测试目录镜像，例如 `src/services/Foo.ts` 对应 `tests/unit/services/Foo.test.ts`。覆盖率目标参考 `tests/README.md` 中的 80%；提交前至少运行 `npm run test:unit` 与 `npm run check-format`。

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

| 组件                  | 文件                                     | 职责                                         |
| --------------------- | ---------------------------------------- | -------------------------------------------- |
| EventBus              | `src/utils/EventBus.ts`                  | 类型安全事件总线，全局单例                   |
| RuntimeServices       | `src/runtime/RuntimeServices.ts`         | 延迟初始化服务集合（AI、分析器、去混淆器等） |
| BrowserManager        | `src/modules/browser/browser.ts`         | 浏览器生命周期、页面管理、反检测注入         |
| CodeCollector         | `src/modules/collector/CodeCollector.ts` | 脚本收集 + 缓存 + 搜索                       |
| HookManager           | `src/modules/hook/HookManager.ts`        | Hook 创建、管理、数据存取门面                |
| HookStore             | `src/modules/hook/HookStore.ts`          | Hook 采样数据存储层                          |
| HookCodeBuilder       | `src/modules/hook/HookCodeBuilder.ts`    | Hook 脚本链式构建器                          |
| ReverseTaskStore      | `src/reverse/ReverseTaskStore.ts`        | 逆向任务持久化存储                           |
| ToolRegistry          | `src/tools/registry/ToolRegistry.ts`     | MCP 工具注册表 + toolProfile 过滤            |
| ToolExecutionPipeline | `src/worker/ToolExecutionPipeline.ts`    | 工具执行管线（校验→上下文→执行→响应）        |
| WsHub                 | `src/web/ws/WsHub.ts`                    | WebSocket 连接中心                           |

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

### 反检测分层（与 jshookmcp 对齐）

默认启动路径遵循 **零 JS 注入** 哲学：`Object.defineProperty` hack 本身就是
反爬系统的检测信号。反检测能力分四层，改动时不要破坏分层边界：

1. **协议层（Patchright）**：始终启用。不调 `Runtime.enable` / `Console.enable`，
   DP 域只在工具显式需要时才激活（详见 `DebuggerManager.ts` /
   CodeCollector.ts` 的懒激活路径）。**不要**在启动流程里 eager-enable。
2. **源码层（CloakBrowser 二进制）**：仅 `--cloak` 启用。实现在
   src/modules/browser/cloak.ts`，49 个 C++ patch。cloak profile 目录与默认 profile *物理隔离**（`cloak-profile`vs`chrome-profile`）—— 改动 profile 解析时 须保留这一边界，见` src/modules/browser/browser-helpers.ts::resolveUserDataDir`。
3. **启动参数**：默认走最小集 `MINIMAL_STEALTH_ARGS`（`--test-type` banner
   制 + `--hide-crash-restore-bubble`）。**不要**在默认路径上追加历史
   FULL_STEALTH_ARGS `—— 其中多个 flag（`--window-size=1920,1080`、 --disable-blink-features=AutomationControlled`、`--disable-logging`、
   --aggressive-cache-discard`）本身已是反爬检测信号。回退走 --full-stealth-args` CLI flag。
4. **JS 注入（`StealthScripts2025`）**：默认 **不** 注入。需要 opt-in：
   --js-stealth`CLI flag 或`inject_stealth `工具显式调用。**不要**在 BrowserManager.launchBrowser()` 或 `src/index.ts` 里隐式调用
   StealthScripts2025.injectAll` —— 那会让所有用户都暴露 JS 注入检测面。

Viewport 默认 `null`（`src/modules/browser/browser.ts::launchBrowser` 末尾的
`setViewportSize(null)` 分支）。Playwright 默认 1280×720 是自动化框架的常见
bot 信号，关掉它暴露真实 OS 屏幕。只有用户显式传 `config.viewport` 才覆盖。

强反爬逃生通道详见 [`docs/cloak.md`](./docs/cloak.md)。

# Skill Usage

- 编写、审查或重构代码时默认应用 `karpathy-guidelines`：先明确假设、边界和可验证成功标准，保持实现简单，仅做与需求直接相关的最小改动。
- 需求仍在探索、涉及创意设计或要新增功能方向时先使用 `brainstorming`；已有明确规格且属于多步骤任务时使用 `writing-plans`，执行既有书面计划时使用 `executing-plans`。
- 实现功能或修复缺陷时使用 `test-driven-development`；遇到 bug、测试失败或异常行为时先使用 `systematic-debugging`；准备声明完成前必须使用 `verification-before-completion` 获取最后一次改动之后的新鲜验证证据。
- 接收评审意见并准备修改前使用 `receiving-code-review`；完成较大功能或准备合并前使用 `requesting-code-review`；对分支、PR、WIP 或指定基点（commit/branch/tag/merge-base）做 Standards + Spec 双轴审查时使用 `code-review`；分支收尾与合并策略使用 `finishing-a-development-branch`，需要隔离工作区时使用 `using-git-worktrees`。
- 用户请求代码评审、评审工作副本/提交/分支区间或“评审并修复”时使用 `open-code-review`；按其流程先检查并按需安装 `ocr`、验证 LLM 配置，再提取业务上下文运行评审，按 High / Medium / Low 分类报告，只有用户明确要求修复时才应用 High / Medium 项。
- 代码发现优先使用 `codebase-memory` 及项目的 Codebase Knowledge Graph；仅在图谱不足、检索非代码文件或字符串字面量时回退到 `rg`。
- 简化、清理或提升近期改动可读性且不改变行为时使用 `code-simplifier`；与 `karpathy-guidelines` 叠加时先保行为与范围，再做清晰度收敛。
- REST API 的资源建模、状态码、分页、过滤、错误响应、版本和限流设计使用 `api-design`；框架实现规则仍使用对应的前端或后端 skill。
- 后端架构、缓存或服务端通用模式使用 `backend-patterns`，但其中 Node.js/Next.js 专属做法不得直接套用于 Go；
- PostgreSQL 模式、查询、索引或安全工作使用 `postgres-patterns`。
- 模块边界、深模块、接口收敛、可测试性或 AI 可导航性设计使用 `codebase-design`。
- Agent / LLM 系统按任务选择：全栈架构诊断使用 `agent-architecture-audit`，失败复盘与自调试使用 `agent-introspection-debugging`，工具与观测面设计使用 `agent-harness-construction`，编码 Agent 对比评测使用 `agent-eval`，x402 支付能力使用 `agent-payment-x402`。
- MCP 开发先使用 `build-mcp-server` 确定部署和工具模型；需要聊天内交互 UI 时再使用 `build-mcp-app`，需要分发本地 MCP 包时使用 `build-mcpb`。
- ECC 安装面裁剪与 DAILY / LIBRARY 分类使用 `agent-sort`；仅当用户明确要求多 Agent 编排或评估委派方案时，才使用 `cavecrew`、`dispatching-parallel-agents` 或 `subagent-driven-development`，不得据此自动扩大任务或启用委派。
- 传统项目的风格继承仅在用户输入 `/inherit-legacy-style`，或明确要求为手写遗留项目建立长期风格约束时使用 `inherit-legacy-style`。
- 真实素材剪辑、FFmpeg / Remotion 流程或视频后期任务使用 `video-editing`。
- `caveman`、`caveman-commit`、`caveman-review`、`caveman-compress`、`caveman-help`、`caveman-stats` 仅在用户明确要求对应的压缩表达、提交、审查、文档压缩、帮助或统计模式时使用。
- 非平凡任务完成后使用 `agent-self-evaluation` 做准确性、完整性、清晰度、可执行性和简洁性复核；它不替代项目要求的测试、类型检查或安全检查。
- Go：生产代码使用 `golang-patterns`；测试、基准、模糊测试或覆盖率工作使用 `golang-testing`；两者可在 Go 功能实现任务中配合使用。
- React：组件与状态设计使用 `react-patterns`；性能分析或优化使用 `react-performance`；组件、Hook 或页面测试使用 `react-testing`。
- React Native / Expo：仅在相关移动端代码存在或用户明确要求时使用 `react-native-patterns`，不要将其套用于当前 Web React 代码。
- 前端通用架构、状态管理和工程模式使用 `frontend-patterns`；组件或页面测试使用 `react-testing`；无障碍专项任务使用 `frontend-a11y`。
- React Native / Expo 任务使用 `react-native-patterns`，不要套用 Next.js 专属规则。
- 演示文稿或 PPTX 转网页使用 `frontend-slides`；需要先生成网站视觉参考图时使用 `imagegen-frontend-web`。
- UI 设计类 skill 职责边界：
  - `PRODUCT.md` / `DESIGN.md` 是项目设计宪法；任何 UI 设计输出、参考图、代码实现和审查结论都必须服从它们。
  - `design-taste-frontend`：用于从零生成设计方案，例如全新页面、全新模块、全新组件或全新视觉方向的初始设计构思。
  - `impeccable`：用于审查、打磨、修复或优化现有设计，例如已有页面、组件、截图或代码的视觉/体验改进。
  - `design-taste-frontend` 只能在现有品牌 token、字体、圆角、组件体系、主题兼容、国际化和工程硬约束内发散，不得重新定义项目设计系统。
  - `frontend-design-direction`：用于确定产品特定的整体视觉方向；已有 `PRODUCT.md` / `DESIGN.md` 明确方向时无需重复使用。
  - 当任务是“从零设计 + 落地实现”时，先使用 `design-taste-frontend` 产出方向，再按项目现有设计系统与工程约束实现；最终落地前必须使用 `impeccable` 做一致性、可访问性、主题兼容和反模板化审查。
  - 当两者看似都适用时，以任务对象为准：全新设计方案用 `design-taste-frontend`，现有设计审查/修复用 `impeccable`，不要让两个 skill 同时争夺最终设计权。
- Python 常规编码、审查和重构使用 `python-patterns`；涉及风格、命名、文档或 lint 配置时补充 `python-code-style`。
- asyncio、并发控制或异步 I/O 使用 `async-python-patterns`；Worker、任务队列和长时任务使用 `python-background-jobs`。
- FastAPI 路由、依赖注入、Pydantic schema、事务服务层和 API 测试使用 `fastapi-patterns`；涉及 REST 资源与协议层设计时先使用 `api-design`。`backend-patterns` 主要面向 Node.js / Express / Next.js API，不作为本 Python 后端的默认 skill，仅在其通用后端架构规则确实相关时使用。
- Streamlit 任务强制使用 `developing-with-streamlit`；跨层架构与 rerun / 状态机制问题补充 `understanding-streamlit-architecture`，运行态调试与 UI 验证补充 `debugging-streamlit`。
- PostgreSQL schema、查询、索引和安全使用 `postgres-patterns`；Redis 缓存、Bloom filter、锁、限流或连接管理使用 `redis-patterns`。
- 测试任务统一使用 `python-testing`；仅当需要其额外测试组织模式时再补充 `python-testing-patterns`，避免重复加载两套高度重叠的 pytest 指南。
- 异常体系、输入校验、批处理失败使用 `python-error-handling`；重试、退避、超时和瞬时故障使用 `python-resilience`；连接、文件、上下文管理器和清理逻辑使用 `python-resource-management`。
- 日志、指标、链路追踪和生产诊断使用 `python-observability`；交互式或远程断点调试使用 `python-debugpy`。
- 类型注解、Protocol、泛型和严格类型检查使用 `python-type-safety`；配置、环境变量和 secrets 管理使用 `python-configuration`。
- 性能问题必须先测量，再使用 `python-performance-optimization`；依赖、`pyproject.toml` 和分发使用 `python-packaging`，项目明确采用 uv 时使用 `uv-package-manager`。
- 新模块边界、目录组织或公共 API 设计使用 `python-project-structure`；职责拆分、组合/继承选择使用 `python-design-patterns`；深模块、接口收敛或可测试性设计使用 `codebase-design`。
- `python-anti-patterns` 仅用于 Python 专项审查或实现完成前的针对性检查，不与所有编码任务默认绑定。
