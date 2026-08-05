# Repository Guidelines

## Project Structure &amp; Module Organization

核心源码位于 `src/`。其中 `src/tools/` 提供 MCP 工具实现，`src/modules/` 放逆向分析、Hook、调试、去混淆等核心模块，`src/services/` 负责外部 AI 与服务集成；`src/worker/` 是后台 worker 运行时（`src/index.ts` 为进程入口）。命令行客户端已抽离为独立、零耦合的 `browsercli/` 包，仅通过 worker 的 `/api/v1` HTTP 契约通信，不再内置本地 worker 进程管理（start/stop/status/repl 等命令已删除）。构建产物输出到 `build/`，不要手改。文档集中在 `docs/`，公开案例与脚本入口在 `scripts/cases/`。真实任务证据默认保留在 `artifacts/tasks/<task-id>/`，仓库只跟踪模板目录。

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
| BrowserManager        | `src/browser/browser.ts`                 | 浏览器生命周期、页面管理、反检测注入         |
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
   src/browser/cloak.ts`，49 个 C++ patch。cloak profile 目录与默认 profile   *物理隔离**（`cloak-profile`vs`chrome-profile`）—— 改动 profile 解析时   须保留这一边界，见` src/browser/browser-helpers.ts::resolveUserDataDir`。
3. **启动参数**：默认走最小集 `MINIMAL_STEALTH_ARGS`（`--test-type` banner  
   制 + `--hide-crash-restore-bubble`）。**不要**在默认路径上追加历史  
   FULL_STEALTH_ARGS `—— 其中多个 flag（`--window-size=1920,1080`、   --disable-blink-features=AutomationControlled`、`--disable-logging`、  
   --aggressive-cache-discard`）本身已是反爬检测信号。回退走   --full-stealth-args` CLI flag。
4. **JS 注入（**`StealthScripts2025`**）**：默认 **不** 注入。需要 opt-in：  
   --js-stealth`CLI flag 或`inject_stealth `工具显式调用。**不要**在   BrowserManager.launchBrowser()` 或 `src/index.ts` 里隐式调用  
   StealthScripts2025.injectAll` —— 那会让所有用户都暴露 JS 注入检测面。

Viewport 默认 `null`（`src/browser/browser.ts::launchBrowser` 末尾的  
`setViewportSize(null)` 分支）。Playwright 默认 1280×720 是自动化框架的常见  
bot 信号，关掉它暴露真实 OS 屏幕。只有用户显式传 `config.viewport` 才覆盖。

强反爬逃生通道详见 [`docs/cloak.md`](./docs/cloak.md)。

# graphify

- **graphify** `~/.agents/skills/graphify/[SKILL.md](http://SKILL.md)`) - any input to knowledge graph. Trigger: `/graphify`

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.
