# Reverser-CLI 全景架构重构规范 (Master Architecture Spec)

- **创建日期**：2026-09-04
- **状态**：Draft Approved (待生成实施计划)
- **文档路径**：`docs/superpowers/specs/2026-09-04-architecture-master-spec.md`
- **关联分析**：Graphify 全库拓扑分析报告 (`graphify-out/GRAPH_REPORT.md`)

---

## 1. 背景与重构动因

依据 Graphify 知识图谱对 `Reverser-CLI` 全库（5,543 个节点、14,441 条依赖链接、611 个源码文件）的拓扑分析，系统目前暴露出四个严重的结构性缺陷：

1. **7 组循环依赖（SCCs）**：包含 1 个波及 11 个核心文件的巨型配置-日志-浏览器环路，极易在 Node.js ESM 动态导入中诱发运行时未定义引用或时序死锁。
2. **3 处严重分层倒置（Layer Inversion）**：底层基础工具（如 `src/utils/CacheAdapters.ts`）直接实例化上层领域模块（`src/modules/collector/`），打破了单向调用假设。
3. **4 个高耦合“上帝组件”（God Nodes）**：
   - `src/modules/browser/browser.ts`（1,036 行，聚合了进程生命周期、远程 CDP 探测、端口回退与反爬参数，衍生出深度达 9 层的隐式调用链）；
   - `src/tools/debugger/index.ts`（2,181 行，单文件挤压 15+ 个 MCP 工具定义）；
   - `src/types/index.ts`（974 行，89 个类型定义，342 个入边，成为跨 15 个功能社区的混合体）；
   - `src/worker/ToolContext.ts`（无差别实例化所有子系统，并与 `runtime.ts` 形成双向循环依赖）。
4. **全局服务定位器（Service Locator）滥用**：`src/runtime.ts::getRuntime()` 拥有 134 个入边，工具层任意穿透调用，导致依赖模糊且单元测试难以隔离。

---

## 2. 架构目标与非目标

### 2.1 架构目标 (Goals)

1. **严格单向分层**：确立 4 层单向流动拓扑，严格禁止逆向依赖与未经编排的横向双向依赖。
2. **循环依赖清零**：消除现存全部 7 组循环引用（SCC 计数降为 0）。
3. **上帝组件拆解**：将 `browser.ts` 与 `debugger/index.ts` 等巨型文件按 SRP（单一职责原则）拆分，调用链深度控制在 4 层以内。
4. **服务契约收敛**：工具层全面改为显式通过 `ToolContext` 获取依赖，封禁工具层内直连 `getRuntime()`。
5. **自动化静态门禁**：接入 `dependency-cruiser` 并在 CI/本地检查中实现循环依赖与分层违规的自动化拦截。

### 2.2 非目标 (Non-Goals)

1. **不推翻重写现有业务逻辑**：保持逆向分析、Hook、AST 去混淆、WASM 分析等核心算法逻辑与已有行为完全一致。
2. **不破坏既有 MCP 工具契约**：所有 102+ MCP 工具的外部输入参数（JSON Schema）与返回结构保持向后兼容。
3. **不破坏反检测分层边界**：严格维系 Patchright 协议层、CloakBrowser 源码层、启动参数最小集与 JS 注入隔离的既定安全边界。

---

## 3. 4 级严格单向分层模型

系统按照抽象级别与职责范围划分为 4 个层级，依赖流动遵循 **严格向下依赖（Downward-Only）** 准则：

```text
Level 3: 接口与接入层 (Ingress Layer)
  ├── src/tools/                # MCP 工具定义与实现
  ├── src/web/                  # REST API 与 WebSocket 路由
  ├── src/ipc/                  # 守护进程 IPC 服务端
  └── browsercli/               # 独立 CLI 客户端包 (零耦合)
         │
         ▼ (单向依赖)
Level 2: 编排与运行调度层 (Orchestration & Worker Layer)
  ├── src/worker/               # ToolContext, ExecutionPipeline, JobStore
  ├── src/reverse/              # 逆向任务状态机、编排器、Checkpoints
  └── src/runtime/              # 延迟初始化组装根 (RuntimeServices)
         │
         ▼ (单向依赖)
Level 1: 领域核心能力层 (Domain Core Layer)
  ├── src/modules/              # 业务能力实现 (browser, debugger, collector, hook, 等)
  ├── src/services/             # AI 评估、去混淆与外部服务集成
  └── src/database/             # 本地 SQLite 数据持久化
         │
         ▼ (单向依赖)
Level 0: 基础支撑与共享契约层 (Foundational Layer)
  ├── src/utils/                # 无状态通用工具 (safeJson, errors, EventBus, logger)
  ├── src/config/               # 不可变环境变量与静态配置解析
  └── src/types/                # 跨层共享只读契约与错误枚举定义
```

### 3.1 跨层依赖约束规则

1. **Rule D1 (Downward Only)**：高层可依赖同层或下层模块；低层绝对禁止直接或间接 import 高层模块。
2. **Rule D2 (No Ingress Inversion)**：Level 0、1、2 模块严禁引用 Level 3（`tools/`, `web/`, `ipc/`）中任何符号。
3. **Rule D3 (Foundational Purity)**：Level 0（`src/utils`, `src/config`, `src/types`）为系统基石，严禁包含任何业务领域依赖。
4. **Rule D4 (Horizontal Decoupling)**：Level 1 内部各业务模块默认横向解耦，严禁产生直接双向引用；跨模块协同必须经由 Level 0 的 `EventBus` 或 Level 2 编排器驱动。

---

## 4. 上帝模块与核心组件解构规范

### 4.1 `src/modules/browser/browser.ts` 拆解
- **问题定义**：1,036 行单体，混合了进程拉起、多 Target 监听、DevToolsActivePort 磁盘扫描与远程连接回退。
- **拆分设计**：
  1. 抽取 **`src/modules/browser/remote-connector.ts`**：
     - 接管 `resolveConnectEndpoint`、`fetchVersionInfo`、`buildDevToolsActivePortFallback`、`readDevToolsActivePort`。
     - 专注处理 CDP 端口探测、超时与重试逻辑。
  2. 重构 **`BrowserManager` (`src/modules/browser/browser.ts`)**：
     - 仅保留 `launchBrowser`、`getBrowser`、`closeBrowser`、`newPage` 等高层生命周期管理。
     - 代码量收敛至 350 行以内。
  3. **阻断深层穿透链**：
     - 修改 `CodeCollector.getActivePage()`：若浏览器当前未就绪，立即 Fast-Fail 抛出 `ERR_BROWSER_NOT_RUNNING`，禁止隐式启动远程磁盘端口探测。

### 4.2 `src/modules/debugger/` 与 `src/tools/debugger/` 解耦
- **问题定义**：`src/tools/debugger/index.ts` 达 2,181 行；`DebuggerManager.ts` 拥有 82 个出度，掌控全部调试子类。
- **拆分设计**：
  1. `src/tools/debugger/index.ts` 按用例切分为 4 个独立工具子文件：
     - `breakpointTools.ts`：处理断点增删查、条件断点与命中监听。
     - `steppingTools.ts`：处理 resume, stepOver, stepInto, stepOut, pause。
     - `evaluationTools.ts`：处理 callFrame 求值、作用域变量展开。
     - `sourceTools.ts`：处理脚本源码读取与黑盒过滤。
     - `index.ts` 仅保留工具注册清单与统筹导出。
  2. `DebuggerManager` 面向门面模式收敛：CDP 底层会话生命周期委托至 `CdpSessionManager`；调试执行状态委托至 `ExecutionController`。

### 4.3 `src/types/index.ts` 领域类型归位
- **问题定义**：974 行混合池，342 个入边。
- **拆分设计**：
  1. 将业务类型按属主就近原则下沉：
     - 调试相关类型 $\to$ `src/modules/debugger/types.ts`；
     - 采集相关类型 $\to$ `src/modules/collector/types.ts`；
     - 逆向任务类型 $\to$ `src/reverse/types.ts`；
     - 浏览器配置类型 $\to$ `src/modules/browser/types.ts`。
  2. `src/types/index.ts` 仅保留跨层通用基元（`ToolResult`, `ErrorCodes`, `ExecutionStatus`），原有符号通过类型重导出（`export type * from ...`）保持无缝兼容，文件本体精简至 150 行以内。

### 4.4 `src/worker/ToolContext.ts` 按需 Lazy 化与接口隔离
- **问题定义**：单体 Provider 为每个工具预先实例化全量依赖，且与 `runtime.ts` 形成双向循环依赖。
- **拆解设计**：
  1. 在 Level 2 定义 `IToolContext` 纯接口；`runtime.ts` 仅面向接口签名，不再引用 `ToolContext.ts` 的实现类（打破循环环 4）。
  2. `ToolContextProvider` 内部将各服务属性改造为 `Object.defineProperty` / TypeScript `get` 访问器，仅在工具实际读取该属性时才触发对应服务的延迟初始化或连接。

---

## 5. 服务访问契约、解环与生命周期规范

### 5.1 7 组循环依赖消除方案

1. **环 1 (resolver ⇄ servicesConfig ⇄ browser ⇄ stealth ⇄ logger ⇄ resolver)**：
   - `src/utils/logger.ts` 改为纯环境变量驱动（读取原生 `process.env.LOG_LEVEL`），移除对 `src/config/resolver.ts` 的静态依赖。
   - `src/config/resolver.ts` 剥离对 Level 1 `browser.ts` 的直接引用。
   - `StealthScripts2025.ts` 改为通过入参注入浏览器配置，不静态导入 `browser.ts`。
2. **环 2 (`websocketFormatter.ts` ⇄ `NetworkTypes.ts`)**：
   - 提取共享消息类型至 `src/modules/network/types.ts`，格式化器与网络模块单向引用该类型。
3. **环 3 (`SubPipelineRunner.ts` ⇄ `Deobfuscator.ts`)**：
   - 将子管线调度契约提取为抽象接口 `ISubPipelineRunner`，解开双向类引用。
4. **环 4 (`ServiceLocator.ts` ⇄ `runtime.ts` ⇄ `ToolContext.ts`)**：
   - `runtime.ts` 改为仅依赖 `IToolContext` 接口，解耦具体工厂实现。
5. **环 5 (`tools-meta.ts` ⇄ `tool-search-engine.ts`)**：
   - 提取工具元数据只读结构至 `src/tools/registry/types.ts`。
6. **环 6 (`ReverseTaskExecutor.ts` ⇄ `ReverseTaskCheckpoint.ts` ⇄ `ExecutionAdapters.ts`)**：
   - 拆解适配器状态映射，Checkpoint 模块仅依赖任务上下文接口。
7. **环 7 (`HeapSnapshotParser.ts` ⇄ `DominatorTreeBuilder.ts`)**：
   - 将节点支配树结构定义下沉至 `src/modules/v8-inspector/types.ts`。

### 5.2 消除分层倒置

1. **`src/utils/CacheAdapters.ts`**：
   - 迁离 `src/utils`，移至 `src/modules/collector/adapters/CacheAdapters.ts`。
   - 使 Level 0 的 `utils` 彻底摆脱对 `collector` 的非法引用。
2. **`src/modules/browser/BrowserTargetInspector.ts`**：
   - 移除对 `src/modules/collector/CollectedFileRegistry.ts` 常量的直接导入，改为通过参数配置注入。

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

2. **`getRuntime()` 适用边界**：
   - 仅限在 `src/index.ts`、Worker 启动引导、IPC Server 装配阶段使用。
   - 暴露的返回对象收敛为按需只读接口，禁止外部模块直接调用内部私有可变状态。

### 5.4 统一生命周期契约 (`IDisposable`)

1. **接口定义 (`src/types/lifecycle.ts`)**：

   ```typescript
   export interface IDisposable {
     dispose(): Promise<void> | void;
     readonly isDisposed: boolean;
   }
   ```

2. **资源释放治理**：
   - `BrowserManager`, `DebuggerManager`, `CodeCollector`, `WsHub`, `DatabaseManager` 统一实现 `IDisposable`。
   - Worker 启动时在 `LifecycleManager` 注册上述组件；进程退出信号（SIGINT/SIGTERM/IPC disconnect）触发时，按依赖拓扑倒序执行 `dispose()`，杜绝孤儿 Chrome 进程或端口占用。

---

## 6. 自动化静态架构门禁规范

在项目根目录引入 `.dependency-cruiser.cjs`，并配置 NPM 校验命令：

```json
{
  "scripts": {
    "check-arch": "depcruise src --config .dependency-cruiser.cjs"
  }
}
```

### 核心拦截规则集

1. **`no-circular` (Error)**：
   - 禁止项目中存在任何文件级别的循环依赖（`max-risk: 0`）。
2. **`strict-downward-layering` (Error)**：
   - 禁止 `src/utils/**` 或 `src/config/**` 或 `src/types/**` 引用 `src/modules/**`、`src/worker/**`、`src/tools/**`。
   - 禁止 `src/modules/**` 引用 `src/worker/**` 或 `src/tools/**`。
3. **`no-runtime-in-tools` (Error)**：
   - 禁止 `src/tools/**` 直接引用 `src/runtime.ts`。
4. **`no-ingress-inversion` (Error)**：
   - 禁止非 Level 3 模块引用 `src/tools/**`、`src/web/**`、`src/ipc/**`。

---

## 7. 四阶段分步实施路线图与验证门禁

```text
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: 基础设施解环与分层修正 (Milestone 1)                  │
│  - 引入 dependency-cruiser 初始配置                          │
│  - 改造 logger.ts 为纯环境变量驱动，切断配置大环             │
│  - 迁移 CacheAdapters.ts 出 utils，修正分层倒置             │
│  - 解除剩余 6 组循环引用，达成 SCC = 0                      │
│  - 验收：`npm run check-arch` 无环；`npm run test:unit` 全绿│
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: God 模块拆解与调用链收敛 (Milestone 2)              │
│  - 从 browser.ts 抽离 remote-connector.ts                   │
│  - 修复 CodeCollector.getActivePage()，砍断 9 层深调用链    │
│  - 拆解 tools/debugger/index.ts 为 4 个子模块               │
│  - DebuggerManager 门面化                                   │
│  - 验收：browser.ts 降至 350 行；全部调试器工具单测通过      │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 3: 调度与契约收敛 (Milestone 3)                        │
│  - 抽象 IToolContext 接口，实现按需 Lazy 属性               │
│  - 解体 types/index.ts，领域类型按模块下沉                  │
│  - 工具层全面改用 context，移除对 getRuntime 的直接调用     │
│  - 验收：tools -> runtime 直接依赖数归 0                     │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 4: DRY 与生命周期治理 (Milestone 4)                    │
│  - 抽取统一的 CdpScriptFetcher 服务                         │
│  - 统一实现 IDisposable 契约与优雅退出收集器                │
│  - dependency-cruiser 规则转为全量严格模式，基线清零        │
│  - 验收：全量测试套件全绿；无悬挂进程与端口泄漏              │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. 规范自检清单 (Spec Self-Review Checklist)

- [x] **Placeholder 扫描**：无任何 "TBD"、"TODO"、模糊不清的待定描述。
- [x] **一致性核验**：4 层拓扑与各组件拆分、依赖消除方案完全契合，无逻辑自相矛盾。
- [x] **范围边界核验**：界定了清晰的 4 个阶段里程碑，架构宪法覆盖全面且各阶段可独立交付。
- [x] **歧义排除核验**：对各层的调用权限、`getRuntime()` 适用边界、门禁硬性拦截规则给出了精确定义。
