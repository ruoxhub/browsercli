# Reverser-CLI 全景架构重构规范 (Master Architecture Spec)

- **创建日期**：2026-09-04
- **状态**：Draft Approved (待生成实施计划)
- **文档路径**：`docs/superpowers/specs/2026-09-04-architecture-master-spec.md`
- **关联分析**：Graphify 全库拓扑分析报告 (`graphify-out/GRAPH_REPORT.md`)
- **修订记录**：2026-09-04 依据文件级静态扫描（547 个 `.ts`、1,708 条 import 边、Tarjan SCC）校订事实、方案与门禁

### 度量口径声明

本文所有数字默认采用 **文件级静态扫描口径**（解析 `import`/`export ... from` 语句，解析 `index.ts` 目录导入，剔除注释与 `import type` 后被 elide 的边）。Graphify 报告采用 **符号级口径**（含 CALLS/USAGE 关系），两者不可直接比较。凡引用 Graphify 数字处均显式标注。

| 指标                      | 文件级实测             | Graphify 符号级 | 说明                          |
| ------------------------- | ---------------------- | --------------- | ----------------------------- |
| SCC（size > 1）           | **7 组**               | 未直接给出      | 与 §1 声明一致                |
| `browser.ts`              | 909 行                 | —               | 原 spec 写 1,036 行           |
| `tools/debugger/index.ts` | 2,033 行               | —               | 原 spec 写 2,181 行           |
| `types/index.ts`          | 856 行 / 81 个 export  | —               | 原 spec 写 974 行 / 89 个类型 |
| `getRuntime()` 引用       | 86 处 / 70 个文件      | 142 条边        | 原 spec 写 134（口径不明）    |
| `types/index.ts` 入边     | 41                     | —               | 原 spec 写 342                |
| 最长 import 链            | 23 跳（自 `index.ts`） | —               | 原 spec 称 9 层               |

---

## 1. 背景与重构动因

依据 Graphify 知识图谱（5,543 个节点、14,441 条依赖链接、611 个源码文件）与本次文件级静态扫描，系统暴露出四个结构性缺陷：

1. **7 组循环依赖（SCCs）**：包含 1 个波及 11 个核心文件的巨型配置-日志-浏览器环路。⚠️ 需按运行时风险分层看待（详见 §5.1）——剔除 `import type`（编译后 elide）后，全库 1,388 条 value 边中 **value-only SCC 仅剩 1 组**：`config/RuntimeConfigStore.ts ⇄ config/resolver.ts`。也就是说，**真正存在于运行时、可能诱发 ESM 未定义引用或时序死锁的只有这一组**；其余 6 组均为 type-only 编译期耦合，不构成运行时风险。本轮按 §5.1 决议保留该组并登记为例外（§2.1 目标 2）。
2. **分层倒置（Layer Inversion）**：实测 **6 条 L0 → L1 边**，其中 4 条为 value import（编译后保留）。最严重的一处是 `src/config/servicesConfig.ts` value import 了 `src/services/AIService.ts` 与 `src/services/OpenAIProvider.ts`——配置层直接持有 AI 服务实现，倒置程度远超常被点名的 `CacheAdapters.ts`（后者 2 条均为 `import type`）。
3. **高耦合"上帝组件"（God Nodes）**：
   - `src/modules/browser/browser.ts`（909 行，聚合了进程生命周期、远程 CDP 探测、端口回退与反爬参数）；
   - `src/tools/debugger/index.ts`（2,033 行，单文件容纳 18 个 `defineTool`，且 `manifest.ts` 中 22 条 `modulePath` 指向它）；
   - `src/types/index.ts`（856 行，81 个 export，41 个入边，混合了 10+ 个领域）；
   - `src/worker/ToolContext.ts`（379 行，16 个入边）。⚠️ 该文件**并未**"无差别实例化全量子系统"——`src/worker/context/` 下已有 `Browser/Collector/DebuggerContextProvider` 三个拆分好的 provider；与 `runtime.ts` 的互引为 `import type`，非运行时双向循环。
4. **服务定位器（Service Locator）松散使用**：`src/runtime.ts::getRuntime()` 被 70 个文件引用（其中 `src/tools/**` 占 63 个），工具层可任意穿透调用，导致依赖模糊且单元测试难以隔离。

---

## 2. 架构目标与非目标

### 2.1 架构目标 (Goals)

1. **严格单向分层**：确立 4 层单向流动拓扑，严格禁止逆向依赖；对 §3.2 显式列出的豁免清单之外的横向/向上依赖一律拦截。
2. **循环依赖清零**：消除现存全部 7 组循环引用，**运行时零环**。按 §5.1 的 P0/P1 分级处理，不追求形式上的"边数归零"而忽略 type-only 边的实际风险差异。
   - **已登记的唯一例外**：`src/config/RuntimeConfigStore.ts ⇄ src/config/resolver.ts` 的播种时序环**保留**（决策见 §5.1 环 1 决议 A）。理由与验收口径：
     - 剔除 `import type` 后全库 value-only SCC **仅剩这 1 组**（实测 1,388 条 value 边），即**运行时无环**的目标不受影响；
     - 该环是 `configFromEnv()` 播种 store 与 `getRuntimeConfigStore()` 读回 store 的初始化时序约定，硬拆风险高于收益；
     - 验收口径因此为：**value-only SCC = 1（即本例外），文件级 SCC = 0 之外的其余 6 组全部消散**。
   - Phase 4 复核此例外是否仍需保留。
3. **上帝组件拆解**：将 `browser.ts` 与 `debugger/index.ts` 等巨型文件按 SRP（单一职责原则）拆分。
   - ⚠️ 原目标"调用链深度控制在 4 层以内"**不可行**：实测最长 import 链 23 跳，且这是分层架构的正常深度（L3→L2→L1→L0 本身的扇出叠加），强行压到 4 层需要推翻整个目录结构。改为：拆解后 **单个文件的直接出边（fan-out）与职责数**可控，`tools/debugger/index.ts` 内的工具数从 18 降至 ≤ 4。
4. **服务契约收敛**：工具层全面改为显式通过 `ToolContext` 获取依赖，移除 `src/tools/**` 对 `runtime.js` 的 64 处直接引入。
5. **本地静态门禁**：在 `npm run check-format`（已接入 ESLint）内实现循环依赖与分层违规的自动化拦截。
   - ⚠️ 项目**当前不存在 CI**（`.github/workflows` 不存在）。原目标"在 CI 中拦截"需二选一：
     - **(A) 推荐**：本次仅落地本地门禁 + `package.json` script，CI 由后续独立任务建立；
     - **(B)**：本 spec 附带建立 `.github/workflows/arch.yml`。
   - **默认按 (A) 执行**；若选 (B)，在本节勾选并追加对应任务到 Phase 4。

### 2.2 非目标 (Non-Goals)

1. **不推翻重写现有业务逻辑**：保持逆向分析、Hook、AST 去混淆、WASM 分析等核心算法逻辑与**已有行为完全一致**。特别注意：`CodeCollector.getActivePage()` 的 lazy-init 语义（见 §4.1）属于"已有行为"，不得在本轮改为 Fast-Fail。
2. **不破坏既有 MCP 工具契约**：全部 166 个已注册工具（`generated-tools-index.ts` 中的 `handlerName` 计数）的外部输入参数（JSON Schema）与返回结构保持向后兼容。**验收必须包含 `npm run test:contracts`**（原 spec 四个 Phase 的验收均未包含，已修正，见 §7）。
3. **不破坏反检测分层边界**：严格维系 Patchright 协议层、CloakBrowser 源码层、启动参数最小集与 JS 注入隔离的既定安全边界。

---

## 3. 4 级严格单向分层模型

系统按照抽象级别与职责范围划分为 4 个层级，依赖流动遵循 **严格向下依赖（Downward-Only）** 准则：

```text
Level 3: 接口与接入层 (Ingress Layer)
  ├── src/tools/                # MCP 工具定义与实现
  ├── src/web/                  # REST API 与 WebSocket 路由
  ├── src/ipc/                  # 守护进程 IPC 服务端
  └── browsercli/               # 独立 CLI 客户端包 (零耦合，独立构建)
         │
         ▼ (单向依赖)
Level 2: 编排与运行调度层 (Orchestration & Worker Layer)
  ├── src/worker/               # ToolContext, ExecutionPipeline, JobStore
  ├── src/reverse/              # 逆向任务状态机、编排器、Checkpoints
  ├── src/runtime/              # 延迟初始化组装根 (RuntimeServices)
  ├── src/runtime.ts            # ⚠️ 根文件，70 个入边，SCC 2 成员，归 L2
  └── src/index.ts              # 进程入口
         │
         ▼ (单向依赖)
Level 1: 领域核心能力层 (Domain Core Layer)
  ├── src/modules/              # 业务能力实现 (browser, debugger, collector, hook, 等)
  ├── src/services/             # AI 评估、去混淆与外部服务集成
  ├── src/database/             # 本地 SQLite 数据持久化
  ├── src/formatters/           # ⚠️ 展示层格式化 (console/network/websocket, 821 行)
  ├── src/trace-processing/     # ⚠️ 性能轨迹解析 (160 行，仅依赖 utils/logger)
  └── src/diagnostics/          # ⚠️ 环境诊断 (158 行，仅依赖 config + utils)
         │
         ▼ (单向依赖)
Level 0: 基础支撑与共享契约层 (Foundational Layer)
  ├── src/utils/                # 无状态通用工具 (safeJson, errors, EventBus, logger)
  ├── src/config/               # 不可变环境变量与静态配置解析
  ├── src/config.ts             # ⚠️ 根文件，SCC 1 成员，归 L0
  ├── src/types/                # 跨层共享只读契约与错误枚举定义
  └── src/third_party/          # ⚠️ 第三方类型与兼容桩 (414 行，178 个入边)
```

**⚠️ 原 spec 遗漏的归属**（合计 1,553 行 + 2 个根文件）：`src/formatters`、`src/trace-processing`、`src/diagnostics`、`src/third_party`、`src/runtime.ts`、`src/config.ts`。本次全部补齐，归属依据其实际依赖：

- `formatters/`：被 L1（`modules/network`）与 L3（`tools/ToolDefinition.ts`）同时消费，但其自身仅依赖 L0/L1 类型 → **归 L1**（展示格式化属领域能力）。
- `trace-processing/`：仅依赖 `utils/logger` → **归 L1**。
- `diagnostics/`：仅依赖 `config/resolver` + `utils/projectPaths` → **归 L1**。
- `third_party/`：全库最底层（178 入边、0 出边到业务层） → **归 L0**。
- `runtime.ts`：依赖 L1 全部领域模块 + L2 `ToolContext` → **归 L2**。
- `config.ts`：仅 re-export `config/index.js` → **归 L0**。

**`src/web-ui/`（React/Vite，7 个文件、758 行）不参与本分层**：它由 `vite --config vite.web-ui.config.ts` 独立构建，产物被 `src/web/` 静态托管，不产生 TS import 边。所有门禁脚本必须显式排除该目录。

### 3.1 跨层依赖约束规则

1. **Rule D1 (Downward Only)**：高层可依赖同层或下层模块；低层绝对禁止直接或间接 import 高层模块。
2. **Rule D2 (No Ingress Inversion)**：Level 0、1、2 模块严禁引用 Level 3（`tools/`, `web/`, `ipc/`）中任何符号——**§3.2 豁免清单内的白名单路径除外**。
3. **Rule D3 (Foundational Purity)**：Level 0（`utils`, `config`, `config.ts`, `types`, `third_party`）为系统基石，严禁包含任何业务领域依赖。
4. **Rule D4 (Horizontal Decoupling)**：Level 1 内部各业务模块默认横向解耦，严禁产生直接双向引用；跨模块协同必须经由 Level 0 的 `EventBus` 或 Level 2 编排器驱动。

### 3.2 ⚠️ Rule D2 / D1 的显式豁免清单（新增）

实测存在 **20 条 L2 → L3 边**，其中多数是**结构性、无法靠抽接口消除**的——因为 `defineTool`（L3）的签名本身必须由 L2 的 `DefineToolContextFactory` 注入 `ToolContextProvider`。若不加豁免，Phase 1 的 `check-arch` 会在第一天全红，且实施者会因"无法同时满足门禁与编译"而被迫关闭整条规则。

**豁免白名单（允许 L2 → L3）**：

| 源（L2）                       | 目标（L3）                                          | 豁免理由                                                                                 |
| ------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `worker/**`                    | `tools/ToolDefinition.ts`                           | 工具定义工厂是 worker 管线的输入契约，`ToolExecutionPipeline` 必须读取 `defineTool` 产出 |
| `worker/**`                    | `tools/tools-meta.ts`                               | 工具注册表元数据，worker 需枚举全部工具以分发                                            |
| `worker/**`                    | `tools/tool-arg-validator.ts`                       | 参数校验属执行管线职责                                                                   |
| `worker/**`                    | `tools/prerequisites/ToolPrerequisiteChecker.ts`    | 前置条件检查属执行管线职责                                                               |
| `worker/daemonMain.ts`         | `ipc/**`、`web/ws/WsHub.ts`、`web/ConsoleServer.ts` | `daemonMain` 是 daemon 装配根，其职责就是组装 L3 接入层（引导态，非业务依赖）            |
| `reverse/**`                   | `tools/shared/response-builder.ts`                  | 统一响应构造器，属跨层共享契约，应随 §4.3 一并迁至 L0/L2                                 |
| `reverse/ExecutionAdapters.ts` | `tools/rebuild/index.ts`                            | 见 §5.1 环 6，应随解环一并处理                                                           |

**豁免的落地方式**：白名单**逐个文件**列出（不使用通配目录），并附 `// arch-exempt: <理由>` 行内注释。门禁规则对白名单外的 L2 → L3 边继续报错。新增白名单条目必须在 PR 中说明理由。

**待消除项（不豁免，排入 Phase 3）**：`reverse/** → tools/shared/response-builder.ts`（3 条）与 `reverse/ExecutionAdapters.ts → tools/rebuild/index.ts`（1 条）应在 Phase 3 随类型归位一并消除，故白名单为**临时豁免**，Phase 3 验收时复核。

### 3.3 全量分层违规清单（新增）

以下 26 条为当前实测的全部 L0/L2 向上依赖，`[type]` 标记的边在编译后被 elide（风险低但仍应清理以保住架构可读性）：

| #    | 边                                                               | 类型      | 处置                                                            |
| ---- | ---------------------------------------------------------------- | --------- | --------------------------------------------------------------- |
| 1    | `config/servicesConfig.ts` → `services/AIService.ts`             | **VALUE** | **P0**，Phase 1 消除（§5.1）                                    |
| 2    | `config/servicesConfig.ts` → `services/OpenAIProvider.ts`        | **VALUE** | **P0**，Phase 1 消除（§5.1）                                    |
| 3    | `config/servicesConfig.ts` → `modules/sourcemap/types.ts`        | **VALUE** | **P0**，Phase 1 消除（仅取 `SourceMapConfig`/`SourceMapError`） |
| 4    | `config/servicesConfig.ts` → `modules/browser/browser.ts`        | type      | Phase 1，随 §4.3 类型归位消除                                   |
| 5    | `utils/CacheAdapters.ts` → `modules/collector/CodeCache.ts`      | type      | Phase 1（§5.2）                                                 |
| 6    | `utils/CacheAdapters.ts` → `modules/collector/CodeCompressor.ts` | type      | Phase 1（§5.2）                                                 |
| 7–26 | 20 条 L2 → L3                                                    | 混合      | 按 §3.2 豁免，其中 4 条在 Phase 3 消除                          |

---

## 4. 上帝模块与核心组件解构规范

### 4.1 `src/modules/browser/browser.ts` 拆解

- **问题定义**：909 行单体，混合了进程拉起（284-455 行）、多 Target 监听、DevToolsActivePort 磁盘扫描与远程连接回退（465-596 行）、崩溃检测（813-935 行）、分离帧守卫（864-935 行）。
- **拆分设计**：
  1. 抽取 **`src/modules/browser/remote-connector.ts`**：
     - 接管 `resolveConnectEndpoint`（473 行）、`fetchVersionInfo`（483 行）、`buildDevToolsActivePortFallback`（536 行）、`readDevToolsActivePort`（550 行，当前从 `browser-discovery.ts:104` 引入）。
     - 专注处理 CDP 端口探测、超时与重试逻辑。
  2. 重构 **`BrowserManager` (`src/modules/browser/browser.ts`)**：
     - 仅保留 `launchBrowser`、`getBrowser`、`closeBrowser`、`newPage`、`getCurrentPage`、`isConnected` 等高层生命周期管理。
     - 代码量收敛至 **400 行以内**（原 spec 写 350 行；实测崩溃检测与分离帧守卫约 130 行需保留，350 行不切实际）。
  3. **抽取示例**（可选，视 Plate 2 余量）：`browser-guard.ts` 承载 `setupCrashDetection` / `installDetachedFrameGuard` / `removeDetachedFrameGuard`。

- **⚠️ 已删除原 spec 的 `getActivePage()` Fast-Fail 要求**，理由：
  - `CodeCollector.getActivePage()`（`CodeCollector.ts:239`）实测有 **91 处引用**（`modules` 59、`tools` 8、`worker` 6，其中 `DOMInspector.ts` 单一文件 11 处），当前语义为 **lazy-init**（`CodeCollector.ts:245-247`：`if (!this.browser || !this.browser.isConnected()) await this.init()`）。
  - 改为"未就绪即抛错"是**行为变更**，波及 91 个调用点，直接违反 §2.2 非目标 1。
  - 该变更对解环 **零贡献**——`CodeCollector` 不在任何 SCC 中。
  - 若确需显式失败语义，**改为新增 `getActivePageOrThrow()`**，保留原 lazy 方法不动，由调用方按需选择。此项列为可选，不属于本轮范围。

### 4.2 `src/tools/debugger/index.ts` 解耦

- **问题定义**：`src/tools/debugger/index.ts` 2,033 行，含 18 个 `defineTool`（`setBreakpoint`/`removeBreakpoint`/`listBreakpoints`/`stepInto`/`stepOver`/`stepOut`/`resume`/`pause`/`listScripts`/`getScriptSource`/`searchInSources`/`breakOnXhr`/`removeXhrBreakpoint`/`traceFunction`/`getAiDebugStatus`/`findInScript`/`getRequestInitiator`/`getPausedInfo`/`evaluateOnCallframe`/`inspectLocals`/`setBreakpointOnText`/`xhrToJsBreakpoint`）。

  > 注：原 spec 称 `src/modules/debugger/DebuggerManager.ts` 有 82 个出度。实测该文件 711 行、17 条 import（含 `BlackboxManager`/`BreakpointManager`/`ExecutionController`/`RuntimeInspector`/`ScopeInspector`/`ScriptManager`/`WatchExpressionManager`/`XHRBreakpointManager` 等），**门面化已基本完成**——子管理器已拆分，本轮不再重复拆 `DebuggerManager`。

- **拆分设计**：`src/tools/debugger/index.ts` 按用例切分为 4 个独立工具子文件：
  - `breakpointTools.ts`：`setBreakpoint`、`removeBreakpoint`、`listBreakpoints`、`breakOnXhr`、`removeXhrBreakpoint`、`setBreakpointOnText`、`xhrToJsBreakpoint`。
  - `steppingTools.ts`：`stepInto`、`stepOver`、`stepOut`、`resume`、`pause`。
  - `evaluationTools.ts`：`evaluateOnCallframe`、`inspectLocals`、`getRequestInitiator`。
  - `sourceTools.ts`：`listScripts`、`getScriptSource`、`searchInSources`、`findInScript`、`traceFunction`、`getAiDebugStatus`、`getPausedInfo`。
  - `pausedInfo.ts`：`PausedInfoData` 接口与 `buildPausedInfoData()`（当前在 `index.ts:222-330`，被 `index.ts` 内部 7 处 + `tests/unit/tools/debugger/buildPausedInfoData.test.ts` 9 处引用，切分后需由 `sourceTools.ts` 引入）。
  - `index.ts` 仅保留工具注册清单与统筹导出。

- **⚠️ 必须同步的构建链（原 spec 遗漏）**：
  1. `src/tools/debugger/manifest.ts` 中 **22 条** `modulePath: './debugger/index.js'` 必须按新落点改写（例如 `setBreakpoint` → `./debugger/breakpointTools.js`）。
  2. `scripts/generate-tools-index.ts` 以正则解析所有 `manifest.ts` 生成 `src/tools/generated-tools-index.ts`（736 行、166 个 `handlerName`）。改完 manifest 后必须重跑 `npm run build:index`，并确认 `generated-tools-index.ts` 中 debugger 域的 `modulePath` 与 `manifest.ts` 逐条一致。
  3. 索引由正则 `modulePath:\s*'([^']+)'\s*,\s*handlerName:\s*'([^']+)'` 匹配 —— **多行的 manifest 条目（如带 `requirements` 的 `resume`/`listScripts`/`evaluateOnCallframe`）也要保持同条目内 `modulePath` 与 `handlerName` 相邻**，否则索引会漏项。

- **验收**：`npm run build:index` 后 `generated-tools-index.ts` 中 debugger 域 handler 数仍为 22；`npm run test:contracts` 全绿。

### 4.3 `src/types/index.ts` 领域类型归位

- **问题定义**：856 行、81 个 export、41 个入边（文件级）。⚠️ 原 spec 称 974 行 / 89 个类型 / 342 入边，与实测不符；且所列保留符号 `ToolResult`、`ExecutionStatus` **在代码库中不存在**（全库 0 匹配）。
- **拆分设计**：
  1. 按属主就近原则下沉（以实测 export 为准）：
     - 调试相关（`ScopeVariable`/`BreakpointHitEvent`/`BreakpointHitCallback`/`DebuggerSession`/`GetScopeVariablesOptions`/`GetScopeVariablesResult`）→ `src/modules/debugger/types.ts`（**已存在**）；
     - 采集相关（`CollectCodeOptions`/`CodeFile`/`CollectCodeResult`）→ `src/modules/collector/types.ts`（**已存在**）；
     - 逆向任务相关（`ReverseTaskStoreOptions`/`ReverseTaskOpenInput`/`ReverseTaskDescriptor`/`ReverseTaskEvent`/`ReverseTaskHandle`/`ReverseTaskReadApi`/`ReverseTaskState`）→ `src/reverse/types.ts`（**新建**）；
     - 浏览器配置相关（`PuppeteerConfig`）→ `src/modules/browser/types.ts`（**新建**）；
     - 分析/去混淆相关（`Deobfuscate*`/`ObfuscationType`/`DependencyGraph` 等 20+ 项）→ `src/modules/analyzer/types.ts` 或 `src/modules/deobfuscator/types.ts`；
     - 检测相关（`DetectCryptoOptions`/`DetectCryptoResult`/`CryptoAlgorithm`/`CryptoParameters`/`CryptoLibrary`）→ `src/modules/crypto/types.ts`；
     - JSVMP 相关（`VMType`/`VMInstruction`/`JSVMPDeobfuscatorOptions` 等 8 项）→ `src/modules/deobfuscator/types.ts`。
  2. **⚠️ 错误码的真实位置**：`ErrorCodes` 定义在 `src/utils/errors.ts:31`（105 个入边），**不在** `src/types/index.ts`。本节不涉及它。
  3. `src/types/index.ts` 保留：跨层通用基元（`Result`、`Session`、`SessionData`、`DetectedEnvironmentVariables`、`MissingAPI`、环境模拟相关类型、`LLMConfig`/`MCPConfig`/`CacheConfig`/`PerformanceConfig` 等配置型契约）。

- **⚠️ 重导出的收益边界（必须明示）**：
  原 spec 要求"原有符号通过 `export type * from ...` 保持无缝兼容，文件本体精简至 150 行以内"。须注意：**只要保留重导出，`types/index.ts` 的 41 个入边一个都不会少**，中心化程度不变，仅定义位置变更。
  - 收益：**定义归属清晰**（改调试协议时知道去 `modules/debugger/types.ts`），这是真实且够用的收益。
  - 不收益：**扇入不下降**。若目标是降低耦合，必须改这 202 处 import 路径——**本轮不做**（属机械性大改，独立成任务）。
  - 行数目标因此调整为：**保留重导出的前提下，文件本体 ≤ 250 行**（81 个符号的重导出语句本身约占 100 行）。

### 4.4 `src/worker/ToolContext.ts` 按需 Lazy 化与接口隔离

- **⚠️ 问题重述（原描述与实测不符）**：
  - 原 spec 称"单体 Provider 为每个工具预先实例化全量依赖，且与 `runtime.ts` 形成双向循环依赖"。
  - 实测：`ToolContext.ts` 379 行，构造时仅 new 三个 provider（`BrowserContextProvider`/`DebuggerContextProvider`/`CollectorContextProvider`，`ToolContext.ts:51-60`），`src/worker/context/` 下已有分领域 provider 拆分；与 `runtime.ts` 的互引**全部是 `import type`**（`ToolContext.ts:30` / `runtime.ts:43`），编译后 elide，**运行时无环**。
  - 因此 §5.1 原"环 4 = `ServiceLocator ⇄ runtime ⇄ ToolContext` 引起运行时双向依赖"的表述**不成立**，原方案"runtime.ts 改为仅依赖 `IToolContext` 接口"**已实现**（`runtime.ts:43` 就是 `import type`），属无效工作，从 Phase 3 移除。

- **本轮真实目标**（重定义）：
  1. `ToolContext → ServiceLocator`、`ToolContext → DefineToolContextFactory` 这两条 **value 边**构成 `ToolContext` 与同目录的 SCC 2。虽然同目录循环在 ESM 中通常无害，但仍是编译期耦合，Phase 3 通过将 `ServiceLocator` 的构造改为外部注入消除。
  2. 若实测发现某服务属性在构造期被 eager 实例化且成本高（需先用 profiling 证据确认，而非直觉），再按原方案改造为 getter 懒加载。**`src/runtime.ts:122-163` 已经是 getter 懒加载的既有范式**，新代码应对齐该写法。
  3. 具体做法：在 Level 2 定义 `IToolContext` 纯接口作为**文档契约**（便于单测 mock），但不作为"解环手段"宣传。

---

## 5. 服务访问契约、解环与生命周期规范

### 5.1 7 组循环依赖消除方案

实测全库 SCC（size > 1）共 7 组。"运行时环"列 = 剔除 `import type` 后该环是否仍成环（决定 ESM 未定义引用风险）：

| 环  | 成员                                                                                                                                                                                                                       | 规模   | 环内边类型明细                                                                                      | 运行时环                                         | 风险         | Phase |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------ | ----- |
| 1   | `browser-discovery` → `browser-detect` → `StealthScripts2025` → `stealth/index` → `config.ts` → `utils/logger` → `browser.ts` → `config/servicesConfig` → `config/RuntimeConfigStore` → `config/resolver` → `config/index` | **11** | 主干全 VALUE；`servicesConfig → browser`、`resolver ⇄ servicesConfig` 为 type                       | **是**（切后剩 `resolver ⇄ RuntimeConfigStore`） | **P0**       | 1     |
| 2   | `runtime.ts` ⇄ `worker/ToolContext.ts` ⇄ `worker/ServiceLocator.ts` ⇄ `worker/DefineToolContextFactory.ts`                                                                                                                 | 4      | 仅 `ToolContext → ServiceLocator`、`ToolContext → DefineToolContextFactory` 为 VALUE，反向均为 type | 否                                               | P2（编译期） | 3     |
| 3   | `reverse/ReverseTaskCheckpoint` ⇄ `reverse/ReverseTaskExecutor` ⇄ `reverse/ExecutionAdapters`                                                                                                                              | 3      | `Executor → ExecutionAdapters`、`Executor → Checkpoint`（其一）为 VALUE，反向均 type                | 否                                               | P1           | 2     |
| 4   | `modules/network/NetworkTypes` ⇄ `formatters/websocketFormatter`                                                                                                                                                           | 2      | 双向均 type                                                                                         | 否                                               | P1           | 1     |
| 5   | `modules/deobfuscator/SubPipelineRunner` ⇄ `modules/deobfuscator/Deobfuscator`                                                                                                                                             | 2      | `Deobfuscator → SubPipelineRunner` VALUE，反向 type                                                 | 否                                               | P2           | 2     |
| 6   | `tools/tool-search-engine` ⇄ `tools/tools-meta`                                                                                                                                                                            | 2      | `tools-meta → tool-search-engine` VALUE，反向 type                                                  | 否                                               | P2           | 3     |
| 7   | `modules/v8-inspector/HeapSnapshotParser` ⇄ `modules/v8-inspector/DominatorTreeBuilder`                                                                                                                                    | 2      | `HeapSnapshotParser → DominatorTreeBuilder` VALUE，反向 type                                        | 否                                               | P2           | 2     |

> **结论**：7 组中只有环 1 含运行时环；且环 1 按 §5.1 决议切完后，唯一残留的运行时环是 `RuntimeConfigStore ⇄ resolver`，已在 §2.1 目标 2 登记为例外。这与附录 A 的 value-only SCC 实测（1,388 条 value 边中仅 1 组）一致。

#### 环 1（P0）—— ⚠️ 原 spec 的三条修复方案全部对不上实测

原方案逐条核验：

| 原方案                                                          | 实测                                                                                                                                                                  | 判定                     |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| "`logger.ts` 移除对 `config/resolver.ts` 的静态依赖"            | `logger.ts:20` 依赖的是 `../config.js`（`src/config.ts` 再导出 `config/index.js`），**不直接引用 resolver**                                                           | 路径写错，方向正确       |
| "`resolver.ts` 剥离对 `browser.ts` 的直接引用"                  | `resolver.ts → servicesConfig.ts`（`resolver.ts:333` re-export）与 `servicesConfig.ts → browser.ts:17` **均为 `import type`**，编译后 elide                           | **非成环因素**           |
| "`StealthScripts2025.ts` 改为入参注入，不静态导入 `browser.ts`" | `StealthScripts2025.ts` 全文仅 import `third_party/index.js` 与 `utils/logger.ts`，**从未 import `browser.ts`**。真实方向是反向：`browser.ts:19` → `stealth/index.ts` | **依赖不存在，方案落空** |

**config 内部子图的实测边（`[type]` 表示编译后 elide）**：

```
utils/logger.ts  ──VALUE──> config.ts ──VALUE──> config/index.ts ──VALUE──> config/resolver.ts
                                                     │                          │  ▲
                                                     │                          │  │
                                                     └──VALUE──> RuntimeConfigStore.ts
                                                                        │          │
                                          config/servicesConfig.ts <────┘          │
                                                     │                             │
                                                     └──VALUE─────────────────────┘
                                                     └──[type]──> modules/browser/browser.ts (L1)
                                                     └──VALUE──> modules/sourcemap/types.ts (L1)
                                                     └──VALUE──> services/AIService.ts (L1)
                                                     └──VALUE──> services/OpenAIProvider.ts (L1)
```

**真正需要切断的边**：

1. **`config/servicesConfig.ts:18-23`（4 条 L0 → L1 边）**——这是环 1 中唯一的 L1 入口，也是本次最严重的倒置：
   - `modules/browser/browser.ts:17`（type，仅取 `BrowserManagerConfig`）→ 随 §4.3 类型迁至 `modules/browser/types.ts`。
   - `modules/sourcemap/types.ts:18`（**value**，取 `SourceMapConfig` + `SourceMapError`）→ 将这两个符号迁至 `src/types/` 或降级为 type-only import。
   - `services/AIService.ts:22` 与 `services/OpenAIProvider.ts:23`（**value**，用于 `createAIService()`）→ **改为函数内动态 `await import()`**。`createAIService()` 本身已是工厂函数（`servicesConfig.ts:431`），延迟导入不改变其同步签名之外的契约。
2. **`utils/logger.ts:20` → `../config.js`**：改为直接读取原生 `process.env.LOG_LEVEL`（`logger.ts:296` 已在读 `process.env.NODE_ENV`，模式一致）。这一刀同时断开 logger 与整个 config 子系统。
   - ⚠️ 同一模式的还有 `src/utils/fsSafe.ts:10` 与 `src/tools/page/sessionState.ts:15`（各自从 `../../config.js` 取 `getEnvValue`/`getEnvNumber`）。它们**不在 SCC 内**（`utils/logger` 在环内是因 `browser.ts`/`StealthScripts2025` 回指），但同属 L0 反向依赖 config 的坏味道，建议同批处理。

**⚠️ 额外的边：`resolver.ts:333-343` 的 value re-export**

`resolver.ts` 末尾把 9 个符号（`createAIService`/`getAIConfig`/`getBrowserConfig`/`getBrowserManagerConfig`/`getDefaultLLMProvider`/`getEnv`/`getSystemConfig`/`isDebugEnabled`/`validateConfig`）从 `servicesConfig.ts` **value re-export** 出去。这条边与 `servicesConfig → resolver`（`getEnvValue` 等）构成 value 环，**是 §6.2 门禁豁免必须覆盖的第二对文件**（第一对是 `resolver ⇄ RuntimeConfigStore`）。

实测这 9 个符号的外部消费方（**全部已直接指向 `config/servicesConfig.js` 或 `config/resolver.js`，无一经由 `../config.js` 桶文件**）：

| 符号                                                                                | 真实消费方                                                                                       |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `getBrowserManagerConfig`                                                           | `index.ts:22`、`runtime.ts:6`、~~`worker/browserRequests.ts:15`~~、~~`worker/daemonMain.ts:25`~~ |
| `createAIService`                                                                   | `services/LLMService.ts:6`（经 `../config.js`）、`web/routes/config.ts:40`                       |
| `getAIConfig`                                                                       | `diagnostics/environment.ts:10`                                                                  |
| `getDefaultLLMProvider`                                                             | `diagnostics/environment.ts:10`（同上）、`web/routes/config.ts:42`                               |
| `getEnv`、`getSystemConfig`、`validateConfig`、`getBrowserConfig`、`isDebugEnabled` | **0 个非 config 消费方**                                                                         |

> ⚠️ 上表核验发现 `worker/browserRequests.ts:15` 与 `worker/daemonMain.ts:25` 实际从 `'../config/servicesConfig.js'` 而非 `'../config.js'` 导入 `getBrowserManagerConfig`，已划删除线更正；`index.ts:22` 同理指向 `./config/servicesConfig.js`，仅 `runtime.ts:6` 走 `./config.js` 桶文件。

**消除方案（Phase 1，成本极低）**：把这 9 个符号的 `resolver.ts` 重导出删除，让消费方直接从 `config/servicesConfig.js` 导入。需改动的仅 `runtime.ts:6`（1 行）。`src/utils/config.ts` 是另一个从 `../config.js` 做 value re-export 的桶文件，但实测 **0 个文件引用它**，可在 Phase 4 作为死代码删除（属既有死代码，不在本轮主动删除范围，见 CLAUDE.md「Don't remove pre-existing dead code unless asked」）。

**⚠️ 前置约束（原 spec 未提）**：环 1 涉及的文件顶部有 **3 处 `eslint-disable import/no-cycle`**（均已确认为 VALUE 边，非 type-only）：

| 位置                                  | 被屏蔽的 VALUE 边                                                           | 支撑的时序约定                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/config/resolver.ts:7`            | `resolver.ts:30 → RuntimeConfigStore.ts`（`getRuntimeConfigStore`）         | `resolver.ts:313` `getToolResultRecordingConfig()` 读取 `getRuntimeConfigStore().get()` 作为 fileConfig 源 |
| `src/config/RuntimeConfigStore.ts:17` | `RuntimeConfigStore.ts:18 → resolver.ts`（`configFromEnv`）                 | store 构造时用 `configFromEnv()`（`resolver.ts:211`）播种初始内存态                                        |
| `src/config/servicesConfig.ts:7`      | `servicesConfig.ts:25-30 → resolver.ts`（`getEnvValue`/`getEnvBoolean` 等） | 服务配置读取复用 resolver 的核心 env 工具                                                                  |

三者性质不同：**前两处是"播种 ↔ 读回"的同一份状态契约（拆开就必须重新设计 store 播种机制）**，第三处只是工具函数复用（拆解成本低）。这正是决议 A 只摘第三处的依据。

> **✅ 环 1 决议（已采纳 A）**：保留 `resolver ⇄ RuntimeConfigStore` 的播种时序环，仅摘 `servicesConfig.ts:7` 一处 disable，另两处保留并把注释改为指向本决议（注明"已登记为已知例外，见 spec §2.1 目标 2 与 §5.1 环 1 决议 A"）。

**建议切法**：切断 `servicesConfig → services/**`（含 `sourcemap/types`）与 `logger → config` 这两条，**不动 resolver ⇄ RuntimeConfigStore 的播种时序**。三条 value 边全部处理后（`servicesConfig → L1`、`logger → config`、`resolver → servicesConfig` 重导出），环 1 收缩为 `resolver ⇄ RuntimeConfigStore` 二元组，登记为"已知可接受的初始化时序耦合"（§2.1 目标 2 已同步登记该例外）。

**⚠️ 因此 §6.2 的 `no-circular` 豁免实际需要覆盖两对文件**（Phase 1 完成后仍会报的环）：

1. `src/config/resolver.ts` ⇄ `src/config/RuntimeConfigStore.ts`（播种时序，决议 A 保留）
2. `src/config/resolver.ts` ⇄ `src/config/servicesConfig.ts`（**若不执行上面的重导出清理**；执行后此项自动消失，无需豁免）

推荐执行重导出清理，使豁免最终只保留第 1 对。

**该决议的实测依据**：剔除 `import type` 后，全库 1,388 条 value 边中 **value-only SCC 仅剩 1 组，即 `RuntimeConfigStore ⇄ resolver`**（size 2）。也就是说，**当前唯一真正存在于运行时的环就是这一组**；其余 6 组 SCC 都是 type-only 编译期环。这把 §1 第 1 条"7 组循环依赖极易诱发运行时未定义引用"的论断收敛为：**运行时风险集中在 1 组，且本轮选择保留它**。Phase 4 复核时若需彻底清零，此处是唯一目标点。

#### 环 2（P2，编译期）

`runtime.ts → ToolContext.ts`、`ToolContext.ts → runtime.ts`、`ServiceLocator → runtime.ts` **全为 `import type`**；仅 `ToolContext → ServiceLocator`、`ToolContext → DefineToolContextFactory` 是同目录 value 边。

**处置**：不追求"边数归零"。Phase 3 将 `ServiceLocator` 改为由 `DefineToolContextFactory` 外部注入 `ToolContextProvider`，消除同目录 value 循环即可。type-only 的 `runtime ⇄ ToolContext` 保留（这是 `contextProvider?: ToolContextProvider` 字段的必要声明）。

#### 环 3（P1）—— ⚠️ 拓扑形状更正

原 spec 描述为 `Executor ⇄ Checkpoint ⇄ ExecutionAdapters` 三角环。**实测为星形**：

```
reverse/ExecutionAdapters.ts ⇄ reverse/ReverseTaskExecutor.ts
reverse/ReverseTaskCheckpoint.ts ⇄ reverse/ReverseTaskExecutor.ts
```

`Checkpoint` 与 `ExecutionAdapters` 之间**无直接互引**。

**处置**：`ReverseTaskExecutor` 是中心节点。将任务上下文契约抽象为 `ReverseTaskContext` 接口，使 Checkpoint 与 ExecutionAdapters 各自单向依赖该接口，切断两条边。

#### 环 4（P1）

`modules/network/NetworkTypes.ts` ⇄ `formatters/websocketFormatter.ts`。

**处置**：提取共享消息类型至 `src/modules/network/types.ts`（**新建**，原 spec 路径正确）。格式化器与网络模块单向引用该类型。⚠️ 注意 `formatters/` 现归 L1（§3），与 `modules/network` 同层，同层单向引用不违反 D1。

#### 环 5（P2）

`SubPipelineRunner.ts` ⇄ `Deobfuscator.ts`。提取子管线调度契约 `ISubPipelineRunner` 至 `src/modules/deobfuscator/types.ts`，解开双向类引用。

#### 环 6（P2）

`tools/tool-search-engine.ts` ⇄ `tools/tools-meta.ts`。提取工具元数据只读结构至 `src/tools/registry/types.ts`（**新建**；注意 `src/tools/registry/` 当前仅有 `ToolRegistry.ts`）。

#### 环 7（P2）

`HeapSnapshotParser.ts` ⇄ `DominatorTreeBuilder.ts`。将节点支配树结构定义下沉至 `src/modules/v8-inspector/types.ts`（**新建**）。

### 5.2 消除分层倒置

1. **`src/utils/CacheAdapters.ts`** → 迁至 `src/modules/collector/adapters/CacheAdapters.ts`。
   - ⚠️ 补充：该文件的 2 条违规边（`CodeCache.ts`、`CodeCompressor.ts`）**均为 `import type`**，风险等级低于 §5.1 环 1 的 value 边。迁移本身仍值得做（Level 0 纯度），但**不应排在环 1 之前**。
   - 调用方：`src/runtime.ts:36-39`（value import）与 `src/modules/collector/CodeCache.ts:10`（仅注释引用）。迁移后同步改 `runtime.ts`。
2. **`src/modules/browser/BrowserTargetInspector.ts:14`**：移除对 `src/modules/collector/CollectedFileRegistry.js` 中 `DEFAULT_COLLECTION_LIMITS` 的直接导入，改为构造参数注入。
   - ⚠️ 补充：此条不产生跨层违规（`modules/browser` 与 `modules/collector` 同属 L1），属 **D4 横向解耦**范畴，非"分层倒置"。

### 5.3 服务访问与注入契约

1. **工具层服务获取守则**：
   - 工具处理函数严禁在内部调用 `getRuntime()`。
   - 必须显式从 `context` 获取子系统实例：

     ```typescript
     // 正确模式
     export const myTool = defineTool({
       name: 'my_tool',
       async handler(args, context) {
         const browser = await context.browser.ensureBrowser();
         ...
       }
     });
     ```

   - **工作量实测**：`src/tools/**` 中有 **64 个文件直接引入 `runtime.js`**、**78 处 `getRuntime()` 引用**（全库 86 处中 tools 占 78）。典型模式：

     ```typescript
     // src/tools/analyzer/deobfuscate.ts
     const result = await getRuntime().deobfuscator.deobfuscate({...});
     // src/tools/analyzer/analysisExecution.ts
     const llm = options.llmService ?? getRuntime()?.llmService;
     ```

     这是 Phase 3 的主体工作量，需按域分批（建议顺序：`proxy` 17 → `network` 16 → `analyzer` 17 → 其余）。

2. **`getRuntime()` 适用边界**：
   - 仅限在 `src/index.ts`、`src/worker/daemonMain.ts`（引导装配）、IPC Server 装配阶段使用。
   - 允许清单（Phase 3 验收时的白名单，共 8 处非 tools 引用）：`src/index.ts`、`src/runtime.ts`、`src/runtime/RuntimeServices.ts`、`src/worker/daemonMain.ts`、`src/modules/collector/PageController.ts`、`src/reverse/ReverseTaskStore.ts`、`src/utils/EventBus.ts`（仅注释）各 1 处。
   - 暴露的返回对象收敛为按需只读接口，禁止外部模块直接调用内部私有可变状态。

### 5.4 生命周期契约

- **⚠️ 原 spec 的 `IDisposable` 抽象待证据（降级为待定）**：
  `src/worker/WorkerLifecycle.ts`（63 行）已有 `createGracefulShutdown()`，处理 `browserManager.close()` 与 `contextProvider.dispose()`，带 10s 超时与重入保护（`isShuttingDown`）。

  新增 `LifecycleManager` 统管 `BrowserManager`/`DebuggerManager`/`CodeCollector`/`WsHub`/`DatabaseManager` 五个组件的拓扑倒序释放，**必须先给出孤儿 Chrome 进程或端口泄漏的可复现证据**（例如 `browsercli list` 显示残留会话、`netstat` 显示端口占用）。
  - 若证据成立 → Phase 4 实施，接口定义于 `src/types/lifecycle.ts`。
  - 若证据不成立 → 本轮**不做**，仅保留现状。这符合 YAGNI：现有实现已覆盖主要泄漏面。

---

## 6. 自动化静态架构门禁规范

### 6.1 ⚠️ 优先复用既有 ESLint，不新增依赖

**决策：Phase 1 不引入 `dependency-cruiser`**，理由：

1. 项目**已有** `eslint-plugin-import`，且 `eslint.config.mjs:138-143` 已开启 `import/no-cycle: ['error', {maxDepth: Infinity}]`。
2. 环之所以未暴露，是因为 §5.1 列出的 **3 处 `eslint-disable import/no-cycle`** 屏蔽了它们，不是工具能力不足。
3. `node_modules/dependency-cruiser` **不存在**，引入即新增依赖。项目 CLAUDE.md 要求 "No new dependency if it can be avoided"。

**Phase 1 动作**：

1. 摘掉 `src/config/servicesConfig.ts:7` 的 disable（**仅此一处**，依据 §5.1 环 1 决议 A）。
2. 保留 `src/config/resolver.ts:7` 与 `src/config/RuntimeConfigStore.ts:17` 两处 disable，把注释改写为指向本决议：`/* eslint-disable import/no-cycle -- 已知例外：configFromEnv() 播种 store 与 getRuntimeConfigStore() 读回 store 的初始化时序契约。见 spec §2.1 目标 2 与 §5.1 环 1 决议 A，Phase 4 复核。 */`
3. **门禁需为该例外留口**：`check-arch` 的 `no-circular` 规则必须把 `src/config/resolver.ts` 与 `src/config/RuntimeConfigStore.ts` 的互引列入豁免（仅这两个文件、仅这一对），否则 Phase 1 完成后门禁仍会报 1 个环。豁免注释中写明 spec 出处。
4. 用 ESLint 原生 `no-restricted-imports` / `import/no-restricted-paths` 表达 §3.1 的 D1–D4 与 §3.2 豁免白名单。
5. 新增 `package.json` script：

   ```json
   {
     "scripts": {
       "check-arch": "eslint --cache src --rule '{\"import/no-cycle\":[\"error\",{\"maxDepth\":\"Infinity\"}],\"no-restricted-imports\":[\"error\",{\"patterns\":[\"../*/modules/*\",\"../*/tools/*\",\"../*/worker/*\",\"../*/web/*\",\"../*/ipc/*\"]}]}'"
     }
   }
   ```

   > 实际落配置时，规则应写入 `eslint.config.mjs` 的独立 config block（`files: ['src/**/*.ts']`），而不是长命令行——上例仅示意。

6. **必须显式排除**：`src/web-ui/**`（React/Vite 独立构建，不受本分层约束）、`browsercli/**`（已在 `globalIgnores`）。

**升级条件**：若 `import/no-restricted-paths` 无法表达"按层分组 + 逐文件白名单"（例如需要按 glob 集合而非单路径配置），再评估引入 `dependency-cruiser`。届时补入 `--ignore src/web-ui` 与 `browsercli` 独立门禁。

### 6.2 核心拦截规则集

1. **`no-circular` (Error)**：
   - 禁止项目中存在任何文件级别的循环依赖。
   - **豁免（逐对文件列出，不使用通配）**：
     1. `src/config/resolver.ts` ⇄ `src/config/RuntimeConfigStore.ts` —— §5.1 环 1 决议 A 保留的播种时序环，Phase 4 复核。
     2. `src/config/resolver.ts` ⇄ `src/config/servicesConfig.ts` —— **仅当 Phase 1 未执行 `resolver.ts:333-343` 重导出清理时才需要**；执行清理后此项应删除。
   - 豁免处必须写明 spec 出处；新增豁免需 PR 说明理由。
   - ⚠️ `import/no-cycle` 对 type-only 导入的处理依赖 `eslint-import-resolver-typescript` 的版本与配置，**Phase 1 必须先实测确认**：若它把 type-only 边也计入，则 §5.1 的 6 组 type-only 环会一起报错。届时有两条路：(a) 配置为忽略 type-only（推荐，与"运行时零环"目标一致）；(b) 按 §5.1 的 Phase 排期逐个消除。**不得**为绕过而整条关闭该规则。
2. **`strict-downward-layering` (Error)**：
   - 禁止 `src/utils/**`、`src/config/**`、`src/config.ts`、`src/types/**`、`src/third_party/**` 引用 `src/modules/**`、`src/services/**`、`src/formatters/**`、`src/worker/**`、`src/reverse/**`、`src/tools/**`、`src/web/**`、`src/ipc/**`。
   - 禁止 `src/modules/**`、`src/services/**`、`src/formatters/**` 引用 `src/worker/**`、`src/reverse/**`、`src/tools/**`、`src/web/**`、`src/ipc/**`。
   - 禁止 `src/worker/**`、`src/reverse/**`、`src/runtime.ts` 引用 `src/tools/**`、`src/web/**`、`src/ipc/**`——**§3.2 白名单路径除外**。
3. **`no-runtime-in-tools` (Error)**：
   - 禁止 `src/tools/**` 直接引用 `src/runtime.ts` 或 `src/runtime.js`。
4. **`no-ingress-inversion` (Error)**：
   - 与 2 的第三条重叠，保留作为独立命名规则以便门禁报错可读。

---

## 7. 四阶段分步实施路线图与验证门禁

> **全局验收门禁（每个 Phase 都必须跑，原 spec 遗漏 `test:contracts`）**：
>
> 1. `npm run typecheck`
> 2. `npm run test:unit`
> 3. **`npm run test:contracts`** —— 守护 §2.2 非目标 2 的 166 个工具契约
> 4. `npm run check-format`
> 5. `npm run check-arch` —— Phase 1 引入后每个 Phase 必跑
>
> 涉及工具路径变更的 Phase（2、3）额外跑 **`npm run test:integration`**。
> 涉及 `browsercli` 的变更额外跑 `npm run test:ipc`。

```text
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: 基础设施解环与分层修正 (Milestone 1)                  │
│  - 摘除 servicesConfig.ts:7 的 eslint-disable（保留另 2 处     │
│    resolver ⇄ RuntimeConfigStore 时序耦合，注释指向决议 A）    │
│  - servicesConfig.ts 的 4 条 L0→L1 边：AI 服务改动态 import， │
│    sourcemap 符号迁位/降级 type-only，browser 类型随 §4.3 迁  │
│  - 删除 resolver.ts:333-343 对 servicesConfig 的 value 重导出，│
│    改 runtime.ts:6 直连 config/servicesConfig.js（1 行）      │
│  - logger.ts 改读原生 process.env.LOG_LEVEL，切断 config 依赖│
│  - 同类：fsSafe.ts:10、tools/page/sessionState.ts:15（可选）  │
│  - 迁移 CacheAdapters.ts → modules/collector/adapters/       │
│  - 解环 4（NetworkTypes ⇄ websocketFormatter）               │
│  - 落地 §3.2 豁免白名单 + check-arch 门禁（排除 src/web-ui）  │
│  - 实测并确定 import/no-cycle 对 type-only 边的处理（§6.2）   │
│  - 验收：文件级 SCC 从 7 降至 5（环 1 收缩为登记例外、       │
│    环 4 消除）；value-only SCC = 1（仅登记例外）；           │
│    L0→L1 VALUE 边归 0；全局门禁 1-5 全绿                     │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: God 模块拆解与调用链收敛 (Milestone 2)              │
│  - 从 browser.ts 抽离 remote-connector.ts（4 个方法）        │
│  - browser.ts 收敛至 400 行以内                             │
│  - 拆解 tools/debugger/index.ts 为 4 子文件 + pausedInfo.ts  │
│  - 【关键】同步 debugger/manifest.ts 的 22 条 modulePath     │
│    并重跑 npm run build:index，核对 generated-tools-index   │
│  - 解环 3（ReverseTaskExecutor 星形环）、环 5、环 7          │
│  - BrowserTargetInspector 的 DEFAULT_COLLECTION_LIMITS      │
│    改参数注入（D4 横向解耦）                                │
│  - 验收：generated-tools-index 中 debugger 域 handler 仍为   │
│    22；全局门禁 1-5 + test:integration 全绿                │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 3: 调度与契约收敛 (Milestone 3)                        │
│  - 解体 types/index.ts，领域类型按模块下沉（保留重导出）     │
│  - 工具层 64 个文件的 runtime.js 引入改为 context 注入       │
│    （分批：proxy 17 → network 16 → analyzer 17 → 其余）     │
│  - 定义 IToolContext 纯接口作为文档契约（非解环手段）        │
│  - ToolContext 的 ServiceLocator 改外部注入，消同目录 value 环│
│  - 解环 6（tool-search-engine ⇄ tools-meta）                │
│  - 消除 4 条临时豁免（reverse → tools/shared、tools/rebuild）│
│  - 验收：tools → runtime 直接依赖数归 0（白名单 8 处除外）； │
│          全局门禁 1-5 + test:integration 全绿               │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 4: DRY 与生命周期治理 (Milestone 4)                    │
│  - 抽取统一的 CdpScriptFetcher 服务                         │
│  - 【先取证据】孤儿进程/端口泄漏可复现后，再决定是否引入     │
│    LifecycleManager + IDisposable；无证据则本项不做          │
│  - 门禁升级为全量严格模式（重审 §3.2 白名单，收敛至 0 条     │
│    临时豁免）                                               │
│  - 重审登记例外：resolver ⇄ RuntimeConfigStore 是否仍需保留   │
│  - 可选：删除 0 引用的死代码 src/utils/config.ts（需另行确认）│
│  - 可选：若 §2.1 目标 5 选 (B)，建立 .github/workflows/arch  │
│  - 验收：全局门禁 1-5 + test:integration + test:ipc 全绿；   │
│          文件级 SCC = 0（或仅剩重审后仍保留的登记例外）；   │
│          无悬挂进程与端口泄漏                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. 规范自检清单 (Spec Self-Review Checklist)

- [x] **Placeholder 扫描**：无任何 "TBD"、"TODO"、模糊不清的待定描述。
  - ⚠️ 例外：§5.4 生命周期治理与 §2.1 目标 5 的 CI 选项为**显式登记的条件性待定**，已写明触发条件与默认路径，不属于占位符。
- [ ] **一致性核验**（**部分完成**）：
  - ✅ **已解决**：原 §5.1 环 1 决议与 §2.1 目标 2「SCC = 0」的冲突。**采纳 (A)**——保留 `resolver ⇄ RuntimeConfigStore` 播种时序环。§2.1 目标 2 已改写为「运行时零环 + 唯一登记例外」，§5.1 环 1 已补入决议依据（value-only SCC 实测仅剩 1 组），§6.1/§6.2 已同步门禁豁免，Phase 1–4 已对齐。
    - [x] **(A) 采纳保留**（已选）
    - [ ] **(B) 不保留**：Phase 1 一并拆解 `resolver` 与 `RuntimeConfigStore` 的双向依赖（需额外设计 store 播种机制），维持 SCC = 0。
  - ⬜ **待实施前补齐**：§6.2 的 4 条门禁规则尚未逐条映射到 `eslint.config.mjs` 的可执行配置（尤其 `no-restricted-imports` 的 patterns 如何表达 §3.2 的逐文件白名单，需 §6.1 的升级条件实测后确定）。
  - ⬜ **待 Phase 1 实测**：`import/no-cycle` 对 type-only 边的处理行为（§6.2 第 1 条），结果决定 6 组 type-only 环是走 (a) 忽略还是 (b) 排期消除。
- [x] **范围边界核验**：界定了清晰的 4 个阶段里程碑，各阶段有明确验收门禁与可独立交付的产出。
- [x] **事实核验**：本文所有文件行数、依赖边、SCC 成员、符号位置均经文件级静态扫描复核，与 `graphify-out/GRAPH_REPORT.md` 的符号级数字口径差异已在顶部声明。
- [x] **歧义排除核验**：对各层的调用权限、豁免白名单、`getRuntime()` 适用边界（含 8 处白名单）、门禁硬性拦截规则给出了精确定义。

---

## 附录 A：事实核验方法论

本文数据由以下方式取得，可复现：

1. **SCC 检测**：递归解析 `src/**/*.ts`（排除 `web-ui/`）的 `import`/`export ... from` 语句，将 `./x.js` 归一化为 `./x.ts` 并回退到 `./x/index.ts`，构建有向图后运行 Tarjan 算法。实测 547 个文件、1,708 条边。
2. **value-only SCC 检测**：同上，但剔除所有 `import type` / `export type ... from` 边（模拟 TypeScript 编译后的 elide 行为）。实测 **1,388 条 value 边、1 组 SCC**（`config/RuntimeConfigStore.ts ⇄ config/resolver.ts`）。这是 §1 第 1 条与 §5.1 环 1 决议的核心依据。
3. **分层违规检测**：按 §3 的目录前缀映射为每个文件计算层号，枚举所有 `L(target) > L(source)` 的边，并区分 `import type`（编译后 elide）与 value import。
4. **互引对检测**：枚举所有 `(A→B) ∧ (B→A)` 的文件对，实测 10 对（其中 8 对跨文件、构成上表 7 个 SCC 的成员边）。
5. **最长链**：DFS + memo 计算 import 图上的最大深度（环内截断），实测 23 跳。
6. **符号级数字**：引用 `graphify-out/GRAPH_REPORT.md`（5,543 节点 / 14,441 边 / 217 社区，生成于 2026-09-04 11:09）。

**已知局限**：

- 正则解析不处理 `import()` 动态表达式与条件导入。
- `import type` 的 elide 行为以 TypeScript 标准语义推断，**未实际编译验证**。§6.2 第 1 条已把「实测 `import/no-cycle` 的真实行为」列为 Phase 1 的必做动作。
- 混合导入（`import {type A, B} from ...`）按整条语句的非 type 说明符判定为 value 边，可能高估个别边的风险等级。
