# Browser-CLI 项目全面技术分析文档

> **生成日期**: 2026-05-20
> **项目**: Browser-CLI (js-reverse-mcp)
> **版本**: 2.0.3
> **许可证**: Apache-2.0

---

## 目录

- [1. 项目概览](#1-项目概览)
- [反检测哲学（与 jshookmcp 对齐）](#反检测哲学与-jshookmcp-对齐)
- [2. 目录结构解析](#2-目录结构解析)
- [3. 核心模块分析](#3-核心模块分析)
- [4. 设计模式与架构风格分析](#4-设计模式与架构风格分析)
- [5. 可视化图表](#5-可视化图表)
- [6. 二次开发与架构优化建议](#6-二次开发与架构优化建议)
- [7. 新开发者实战入门指南](#7-新开发者实战入门指南)

---

## 1. 项目概览

Browser-CLI 是一个**前端 JavaScript 逆向流程标准化的 MCP（Model Context Protocol）服务**。其核心目标不是简单的页面调试，而是将**页面观察→运行时采样→本地复现→补环境→证据沉淀**串成一套可复用工作流。

### 核心方法论

| 原则 | 含义 |
|------|------|
| **Observe-first** | 先在浏览器里确认请求、脚本、函数和依赖来源 |
| **Hook-preferred** | 先做最小化 Hook 采样，而非直接断点 |
| **Breakpoint-last** | 只有 Hook 不够时才进入暂停式调试 |
| **Rebuild-oriented** | 以本地可复现为最终产出目标 |
| **Evidence-first** | 每一步都沉淀为 task artifact，不留在对话里 |
| **Pure-extraction-after-pass** | 环境通过（env-pass）后才进入纯算法提纯 |

### 技术栈

| 领域 | 技术选型 |
|------|----------|
| **语言** | TypeScript 5.9 (ESM, ES2023 target) |
| **运行时** | Node.js ^20.19.0 \|\| ^22.12.0 \|\| >=23 |
| **浏览器自动化** | patchright (Playwright fork) |
| **构建** | SWC (编译) + Rollup (打包) |
| **CDP 协议** | Chrome DevTools Protocol 原生集成 |
| **AI 集成** | OpenAI / Anthropic / Gemini (可选) |
| **ORM** | Drizzle ORM (PostgreSQL pg-core) |
| **RPC 协议** | Sekiro (WebSocket) |
| **CLI 框架** | yargs |
| **运行时校验** | Zod |
| **代码分析** | Babel (parser/traverse/generator) |
| **混淆处理** | javascript-obfuscator, terser |
| **WASM 处理** | wabt |
| **国密** | sm-crypto |
| **测试** | node:test + fast-check (属性测试) + Vitest |

---

## 反检测哲学（与 jshookmcp 对齐）

Browser-CLI 与兄弟项目 [jshookmcp](https://github.com/zhizhuodemao/js-reverse-mcp)
共享同一套反检测哲学：**默认零 JS 注入，反检测下沉到协议层和（可选的）源码层**。

`Object.defineProperty` hack 本身就是反爬系统的检测信号 —— 一旦页面检测到
"有人在覆盖 navigator / canvas / WebGL API"，整个隐身努力反而暴露。所以默认
启动时 JSReverser **不会**向页面注入任何 JS，分四层提供反检测能力：

| 层 | 默认模式 | `--cloak` 模式 |
| --- | --- | --- |
| **协议层**（CDP） | Patchright：不调 `Runtime.enable` / `Console.enable`，不在 isolated world 外 evaluate | 同 |
| **源码层**（C++ 二进制 patch） | 无 —— 直接用系统 Google Chrome | CloakBrowser 二进制（49 个 C++ patch：`navigator.webdriver`、canvas、WebGL、audio、GPU、字体、屏幕、WebRTC、TLS） |
| **Profile 目录** | `~/.cache/chrome-devtools-mcp/chrome-profile` | `~/.cache/chrome-devtools-mcp/cloak-profile`（与默认物理隔离） |
| **实际浏览器** | 你装的 Google Chrome（带 Web Store、扩展、sync） | 定制 Chromium 编译版（无 Google 服务、无 Web Store） |

导航级措施（两种模式都生效）：

- **最小启动参数集**：默认只下 `--test-type`（banner 抑制器，不是检测信号）+
  `--hide-crash-restore-bubble`。历史 60+ 参数集（`FULL_STEALTH_ARGS`，其中
  多个 flag 本身已是反爬检测信号）通过 `--full-stealth-args` 回退启用。
- **Viewport `null`**：关掉 Playwright 默认的 1280×720 假视口，暴露真实 OS
  屏幕尺寸（1280×720 是自动化框架的常见 bot 信号）。

### 三个隐身相关 CLI flag

| Flag | 作用 | 默认 |
|---|---|---|
| `--cloak` | CloakBrowser 二进制 + 49 C++ patch + cloak-profile | `false` |
| `--js-stealth` | 页面里 opt-in 注入 `StealthScripts2025`（覆盖 navigator/canvas/WebGL/audio） | `false` |
| `--full-stealth-args` | 使用历史 60+ Chromium 启动参数集 | `false` |

`--cloak` 是强反爬的逃生通道，详见 [`docs/cloak.md`](./docs/cloak.md)。
`--js-stealth` 是历史兼容 opt-in（旧代码依赖 `navigator.webdriver === false`
等覆盖时显式启用）。`--full-stealth-args` 不推荐：多个 flag 已是反爬检测信号。

---

## 2. 目录结构解析

```
Browser-CLI/
├── src/                              # 核心源码
│   ├── index.ts                      # ★ Worker 进程入口 — RPC Worker 启动主函数
│   ├── runtime.ts                    # ★ 运行时核心 — 单例，聚合所有模块实例
│   ├── config.ts                     # 配置出口 (re-export config/index)
│   ├── DebuggerContext.ts            # ★ CDP Debugger 会话上下文 (869 行)
│   ├── PageCollector.ts              # ★ 泛型页面数据收集器基类 (模板方法)
│   │
│   ├── bin/                          # CLI 二进制入口
│   │   └── js-reverse.ts             # ★ js-reverse 命令入口 (yargs CLI)
│   │
│   ├── cli/                          # CLI 交互层
│   │   ├── app.ts                    # CLI 应用主逻辑
│   │   ├── args-parser.ts           # 参数解析器
│   │   ├── commands/                # 命令实现:
│   │   │   ├── start.ts             #   - start (启动 daemon)
│   │   │   ├── stop.ts              #   - stop
│   │   │   ├── status.ts            #   - status
│   │   │   ├── repl.ts              #   - repl (交互式 REPL)
│   │   │   ├── scaffold.ts          #   - scaffold (任务脚手架)
│   │   │   ├── tool-dispatcher.ts   #   - call (工具调用)
│   │   │   ├── list-tools.ts        #   - list-skills / list-tools
│   │   │   └── config.ts            #   - config 管理
│   │   ├── tools-meta.ts            # ★ 工具元信息注册表 — 动态从 defineTool 加载
│   │   ├── tool-arg-validator.ts    # 工具参数校验器
│   │   ├── tool-aliases.ts          # 工具别名管理
│   │   ├── zod-introspect.ts        # Zod schema 自省工具
│   │   ├── sekiro-invoker.ts        # Sekiro RPC 调用器
│   │   ├── worker-manager.ts        # Worker 进程管理器
│   │   ├── worker-guardian.ts       # Worker 守护进程
│   │   ├── types.ts                 # CLI 类型定义
│   │   ├── errors.ts                # CLI 错误处理
│   │   ├── output.ts                # CLI 输出格式化
│   │   └── help.ts                  # CLI 帮助生成
│   │
│   ├── config/                       # 配置系统
│   │   ├── resolver.ts              # ★ 核心解析管线 (830行) — CLI > Env > JSON > 默认值
│   │   ├── constants.ts             # 文件名常量与默认值
│   │   └── schema.ts                # 占位 — 尚未实现
│   │
│   ├── browser/                      # 浏览器管理层
│   │   ├── browser.ts               # ★ BrowserManager (1229行) — 单例 + 双模式连接/启动
│   │   ├── SessionManager.ts        # 多会话页面隔离管理
│   │   ├── CDPErrorMapper.ts        # CDP 错误模式匹配 → ToolError
│   │   ├── DevToolsConnectionAdapter.ts # Playwright CDPSession → CDPConnection 适配器
│   │   ├── stealth-args.ts          # 反检测启动参数 (60+ 项)
│   │   └── polyfill.ts              # core-js polyfills
│   │
│   ├── protocol/                     # RPC 协议层
│   │   └── Client.ts                # ★ RpcClient — Sekiro WebSocket 客户端 (508行)
│   │
│   ├── worker/                       # Worker 层
│   │   ├── ToolAdapter.ts           # ★ 工具适配器 — defineTool → Sekiro Action (464行)
│   │   ├── ToolContextProvider.ts   # ★ 执行上下文 Facade — 聚合4个子模块 (420行)
│   │   ├── BuiltinActions.ts        # 内置 Sekiro Action (_list_tools, _status)
│   │   ├── ToolResponseAccumulator.ts # 工具响应累加器
│   │   ├── WorkerArgs.ts            # Worker 参数解析
│   │   ├── WorkerLifecycle.ts       # ★ 优雅关闭生命周期
│   │   ├── collectors.ts            # 数据收集器定义
│   │   └── context/                 # ToolContextProvider 子模块:
│   │       ├── PageManager.ts       #   页面/Frame/Dialog/网络CPU节流管理
│   │       ├── DebuggerSessionManager.ts # CDP DebuggerContext 创建与释放
│   │       ├── DataCollectorManager.ts   # Network/Console/WebSocket 收集与查询
│   │       └── ServiceLocator.ts    #   分析服务惰性装配
│   │
│   ├── tools/                        # ★ MCP 工具实现 (33个子目录, ~100+ 工具)
│   │   ├── ToolDefinition.ts        # ★ defineTool() — 工具定义 DSL
│   │   ├── categories.ts            # ★ ToolCategory 枚举 (10个分类)
│   │   ├── manifest.ts              # 工具清单接口
│   │   ├── generated-tools-index.ts # ★ 自动生成工具索引 — 引用所有工具文件
│   │   ├── hook/                    # Hook 工具 (create_hook, inject_hook, get_hook_data...)
│   │   ├── debugger/                # 调试器工具 (set_breakpoint, resume, step_into...)
│   │   ├── network/                 # 网络分析工具 (list_network_requests, trace_signature_generation...)
│   │   ├── script/                  # 脚本管理工具 (list_scripts, get_script_source...)
│   │   ├── dom/                     # DOM 操作工具
│   │   ├── page/                    # 页面管理工具 (navigate_page, query_dom...)
│   │   ├── input/                   # 输入自动化工具 (click, type_text, fill...)
│   │   ├── console/                 # 控制台工具 (list_console_messages)
│   │   ├── navigation/              # 导航工具
│   │   ├── screenshot/              # 截图工具
│   │   ├── emulation/              # 设备仿真工具 (emulate_network, emulate_mobile...)
│   │   ├── performance/            # 性能分析工具
│   │   ├── websocket/ (network/)   # WebSocket 观察工具
│   │   ├── storage/ (page/)        # 会话状态工具 (save_session_state...)
│   │   ├── crypto/                  # 加密检测工具 (detect_crypto)
│   │   ├── analyzer/               # 深度分析工具 (understand_code, risk_panel)
│   │   ├── collector/              # 代码采集工具 (collect_code)
│   │   ├── rebuild/                # 本地复现工具 (export_rebuild_bundle, diff_env_requirements)
│   │   ├── stealth/                # 隐身注入工具
│   │   ├── pipeline/               # 工作流管道工具
│   │   ├── wasm/                   # WASM 分析工具
│   │   ├── workflow/               # 工作流编排工具
│   │   ├── frames/                 # Frame 管理工具
│   │   ├── dialog/                 # 弹窗处理工具
│   │   ├── anti-debug/             # 反调试工具
│   │   ├── site-experience/        # 站点体验 CRUD 工具
│   │   ├── extensions/             # 扩展工具
│   │   └── shared/                 # 共享辅助函数
│   │
│   ├── modules/                     # ★ 核心逆向模块
│   │   ├── collector/              # 代码收集
│   │   │   ├── CodeCollector.ts    #   CDP 网络拦截 + 脚本采集 + 依赖图
│   │   │   ├── CodeCache.ts        #   代码缓存
│   │   │   ├── CodeCompressor.ts   #   代码压缩
│   │   │   ├── SmartCodeCollector.ts # 智能收集策略
│   │   │   ├── PageController.ts   #   页面控制 (导航/刷新/回退)
│   │   │   ├── DOMInspector.ts     #   DOM 检查器
│   │   │   └── comboUrlParser.ts   #   Combo URL 解析
│   │   ├── hook/                   # Hook 系统
│   │   │   ├── HookManager.ts      #   Hook 管理器 (Facade)
│   │   │   ├── HookCodeBuilder.ts  #   Hook 脚本构建器
│   │   │   ├── HookTypeRegistry.ts #   Hook 类型注册表 (插件式)
│   │   │   ├── HookStore.ts        #   Hook 数据存储
│   │   │   ├── HookHeartbeat.ts    #   心跳检测
│   │   │   └── AIHookGenerator.ts  #   AI 辅助 Hook 生成
│   │   ├── analyzer/               # 代码分析
│   │   │   ├── CodeAnalyzer.ts     #   代码理解 (静态 + AI)
│   │   │   └── AISummarizer.ts     #   AI 摘要
│   │   ├── deobfuscator/           # 反混淆
│   │   │   ├── Deobfuscator.ts     #   主管道 (策略调度)
│   │   │   ├── PackerDeobfuscator.ts   # Packer/AAEncode
│   │   │   ├── JSVMPDeobfuscator.ts    # JSVMP 虚拟机
│   │   │   ├── AdvancedDeobfuscator.ts # 高级混淆
│   │   │   └── ASTOptimizer.ts     #   AST 优化
│   │   ├── crypto/                 # 加密检测
│   │   │   ├── CryptoDetector.ts   #   加密检测器
│   │   │   ├── CryptoDetectorEnhanced.ts # 增强检测
│   │   │   └── CryptoRules.ts      #   规则引擎
│   │   ├── wasm/                   # WASM 分析
│   │   │   ├── WasmCollector.ts    #   WASM 收集 (CDP + 插桩)
│   │   │   ├── WasmAnalyzer.ts     #   WASM 二进制分析
│   │   │   ├── WasmDecompiler.ts   #   WASM 反编译
│   │   │   ├── WasmRuntimeInspector.ts # 运行时检查
│   │   │   └── WasmTypes.ts        #   类型定义
│   │   └── stealth/                # 隐身模块
│   │       └── StealthScripts2025.ts # 反检测脚本引擎
│   │
│   ├── services/                    # 服务层
│   │   ├── LLMService.ts           # ★ LLM 服务封装 (chat, 提示词生成)
│   │   ├── AIService.ts            # ★ AI 服务基类 (重试, 错误分类)
│   │   ├── OpenAIProvider.ts       #   OpenAI API 实现
│   │   ├── AnthropicProvider.ts    #   Anthropic API 实现
│   │   ├── GeminiProvider.ts       #   Gemini API + CLI 实现
│   │   ├── DatabaseService.ts      # ★ PostgreSQL 连接 + Drizzle ORM
│   │   ├── SiteExperienceService.ts # 站点体验 CRUD
│   │   └── index.ts                #   导出
│   │
│   ├── reverse/                     # 逆向任务存储
│   │   └── ReverseTaskStore.ts     # ★ 文件系统任务持久化
│   │
│   ├── database/                    # 数据库模式
│   │   ├── schema.ts               #   Drizzle ORM 模式 (site_experiences)
│   │   └── index.ts                #   导出
│   │
│   ├── utils/                       # 工具层
│   │   ├── EventBus.ts             # ★ 事件总线 (Pub/Sub + Zod 校验)
│   │   ├── UnifiedCacheManager.ts  # ★ 统一缓存协调器 (单例)
│   │   ├── CacheAdapters.ts        #   缓存适配器
│   │   ├── detailedDataManager.ts  #   分层数据存储 (LRU + TTL)
│   │   ├── TokenBudgetManager.ts   #   Token 预算 (三级预警)
│   │   ├── ToolExecutionScheduler.ts # 读写调度器
│   │   ├── AdaptiveDataSerializer.ts # 自适应序列化 (7种类型)
│   │   ├── Mutex.ts                #   FIFO 互斥锁
│   │   ├── logger.ts               #   日志器
│   │   ├── errors.ts               #   错误类型 (ToolError)
│   │   ├── safeJson.ts             #   安全 JSON 序列化
│   │   ├── pagination.ts           #   分页工具
│   │   ├── fsSafe.ts               #   文件安全校验
│   │   ├── keyboard.ts             #   按键校验
│   │   ├── projectPaths.ts         #   路径解析
│   │   ├── config.ts               #   旧配置别名 (即将废弃)
│   │   ├── features.ts             #   功能开关
│   │   └── DevtoolsUtils.ts        #   DevTools 工具
│   │
│   ├── types/                       # 类型定义
│   │   ├── index.ts                # ★ ~860行, 85+接口, 核心类型
│   │   ├── events.ts               #   AppEventMap + Zod 校验器
│   │   ├── platform.ts             #   平台类型
│   │   ├── rpc.ts                  #   Sekiro RPC 协议类型
│   │   ├── devtools.ts             #   DevTools 抽象类型
│   │   └── chrome-devtools-frontend.d.ts
│   │
│   ├── third_party/                 # 第三方包装层
│   │   ├── index.ts                # ★ 统一导出入口 (185文件引用)
│   │   ├── playwright.ts           #   patchright 重导出 + 兼容别名
│   │   ├── puppeteer-compat.ts     #   Puppeteer 兼容层
│   │   ├── cdp.ts                  #   CDP 协议类型
│   │   └── stubs.ts                #   chrome-devtools-frontend 桩
│   │
│   ├── formatters/                  # 格式化器
│   │   ├── networkFormatter.ts     #   HTTP 请求/响应格式化
│   │   ├── websocketFormatter.ts   #   WebSocket 帧分析 + 分组 + 格式化
│   │   └── consoleFormatter.ts     #   控制台消息格式化
│   │
│   └── trace-processing/           # 性能追踪
│       └── parse.ts                #   TraceEngine 解析器
│
├── tests/                           # 测试
│   ├── unit/                       # 单元测试 (node:test)
│   │   ├── browser/               # BrowserManager 测试
│   │   ├── tools/                  # 工具测试
│   │   ├── services/               # 服务测试
│   │   └── utils/                  # 工具测试
│   ├── integration/                # 集成测试
│   ├── property/                   # 属性测试 (fast-check)
│   └── performance/                # 性能测试
│
├── scripts/                         # 脚本
│   ├── cases/                      # 公开逆向案例 (JD/KS/Douyin)
│   └── generate-tools-index.ts    # 工具索引自动生成
│
├── docs/                            # 文档
│   ├── guides/                     # 使用指南
│   └── reference/                  # 参考文档
│
├── artifacts/tasks/                 # 任务产物 (本地保留, git 忽略)
│   └── _TEMPLATE/                  # 模板目录
│
├── package.json                    # 依赖与脚本
├── tsconfig.json                   # TypeScript 配置
├── rollup.config.mjs              # Rollup 打包配置
├── .swcrc                          # SWC 编译器配置
└── PROJECT-ANALYSIS.md            # 本文件
```

---

## 3. 核心模块分析

### 3.1 系统架构分层

```
┌─────────────────────────────────────────────────────────┐
│                     CLI 层 (src/cli/)                    │
│    js-reverse start/stop/status/call/repl/scaffold      │
│    yargs 解析 → SekiroInvoker → WorkerManager           │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                  RPC 协议层 (src/protocol/)              │
│            RpcClient — Sekiro WebSocket 通信             │
│      心跳/重连(指数退避)/Action 注册/消息路由            │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                  Worker 层 (src/worker/)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ ToolAdapter   │  │ ToolContext  │  │  Builtin      │ │
│  │ defineTool →  │  │  Provider    │  │  Actions      │ │
│  │ Sekiro Action │  │ (Facade)     │  │ (_list_tools) │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────────┘ │
└─────────┼─────────────────┼──────────────────────────────┘
          │                 │
┌─────────▼─────────────────▼──────────────────────────────┐
│                    Runtime 核心 (src/runtime.ts)          │
│     单例模式 — 聚合所有模块实例 (BrowserManager + 各模块) │
└──┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┘
   │      │      │      │      │      │      │      │
┌──▼──┐ ┌▼────┐ ┌▼───┐ ┌▼───┐ ┌▼──┐ ┌▼───┐ ┌▼──┐ ┌▼────┐
│Tools │ │Modules│ │Svc │ │Brsr│ │DB │ │Utils│ │Fmt│ │Types│
│100+  │ │ 6域  │ │LLM │ │Mgr │ │ORM │ │Cache│ │rtr│ │85+  │
│MCP   │ │分析  │ │+DB │ │CDP │ │Pg  │ │Bus  │ │   │ │接口  │
└──────┘ └──────┘ └────┘ └────┘ └───┘ └─────┘ └───┘ └─────┘
```

### 3.2 模块职责与实现分析

#### 3.2.1 配置系统 (src/config/)

| 方面 | 分析 |
|------|------|
| **职责** | 统一管理所有运行时配置 — 浏览器连接、AI 提供商、数据库、RPC 通信 |
| **实现逻辑** | `resolveConfig()` 实现 CLI 参数 > 环境变量 (dotenv) > config.json > js-reverse.config.json > ~/.jsreverse/config.json > 内置默认值的优先级合并 |
| **关键函数** | `resolveConfig()` — 返回扁平 `ResolvedConfig`; `getSystemConfig()` — 构建 `SystemConfig` (AI+Browser+Debug); `getBrowserManagerConfig()` — 解析 25 个浏览器参数; `createAIService()` — 从配置实例化 AI 服务 |
| **被调用方** | `src/index.ts` (Worker入口)、`src/cli/commands/start.ts`、`src/cli/app.ts`、`src/runtime.ts` |
| **隐式耦合** | `LLMProvider` 类型仅限 `'openai'`，但 AI 层已支持 Anthropic/Gemini，配置系统尚未暴露对应选项; `schema.ts` 为空占位文件 |
| **改进空间** | 扩展 `LLMProvider` 联合类型; 使用 Zod 对 `GlobalConfig` 做运行时校验 |

#### 3.2.2 浏览器管理层 (src/browser/)

| 方面 | 分析 |
|------|------|
| **职责** | 浏览器的启动、连接、会话管理、崩溃恢复、隐身注入 |
| **实现逻辑** | **双模式连接**: 已有浏览器 (connectOverCDP) / 自动启动新浏览器 (launch)。**三层端口发现**: DevToolsActivePort > 常见端口扫描 > 默认候选列表。**崩溃自愈**: 双重检测 (事件 + 5s 轮询) → close → 1s 延迟 → 重启 |
| **关键类** | `BrowserManager` (单例) — 核心; `SessionManager` — 多会话页面隔离; `DevToolsConnectionAdapter` — Playwright→CDPConnection 适配器; `CDPErrorMapper` — 10 种错误模式映射 |
| **被调用方** | `Runtime` 在 `getRuntime()` 中 init; `ToolContextProvider.PageManager` 持有引用 |
| **隐式耦合** | `BrowserManager` 直接依赖 `patchright` 的 `Browser` / `BrowserContext` / `Page` 具体类型, 而不是抽象接口; 测试通过 `resetInstance()` 进行，但方案较脆弱 |
| **设计模式** | **单例模式、适配器模式 (Playwright→CDPConnection)、策略模式 (端口发现三层策略)、观察者模式 (崩溃监听)** |

#### 3.2.3 MCP 工具层 (src/tools/)

| 方面 | 分析 |
|------|------|
| **职责** | 实现 100+ 个 MCP 工具，覆盖页面观察、Hook、断点、网络分析、WebSocket、代码分析、反混淆、加密检测、WASM、设备仿真、性能分析等全部能力 |
| **实现逻辑** | 工具通过 `defineTool()` DSL 定义 (name + description + Zod schema + handler)。索引在 `generated-tools-index.ts` 中自动生成，通过 `tools-meta.ts` 动态加载并缓存。`ToolAdapter.wrapTool()` 将 `ToolDefinition` 包装为 Sekiro ActionHandler |
| **关键文件** | `ToolDefinition.ts` — 工具定义接口; `generated-tools-index.ts` — 索引; `categories.ts` — 10 个分类枚举; `ToolAdapter.ts` — 包装器 |
| **被调用方** | RpcClient 收到 Sekiro 请求 → 路由到对应 ActionHandler |
| **边界问题** | 定义和使用之间有一层间接性 (modulePath → 动态 import)，加载失败时以警告非阻断方式处理 |
| **改进空间** | 考虑将工具调用模式 (`frame`/`context`/`direct`) 表示为统一的 DSL 属性, 而非 ToolAdapter 中的条件分支 |

#### 3.2.4 代码收集模块 (src/modules/collector/)

| 方面 | 分析 |
|------|------|
| **职责** | 采集页面所有 JavaScript 代码 (外部脚本、内联脚本、Service Worker、Web Worker) |
| **实现逻辑** | CDP `Network.enable` 网络拦截 + `Page.enable` 脚本事件监听。支持 summary/priority/incremental 三种智能收集模式。收集后自动构建依赖图，支持按优先级获取|
| **关键类** | `CodeCollector` — 主收集器; `CodeCache` — 内存缓存; `CodeCompressor` — 按需压缩; `SmartCodeCollector` — 智能策略 |
| **被调用方** | Runtime → `collect_code` 工具 |
| **改进空间** | 对大网站 (1000+ 脚本) 的收集性能需优化，当前智能模式可能仍会超时 |

#### 3.2.5 Hook 系统 (src/modules/hook/)

| 方面 | 分析 |
|------|------|
| **职责** | 声明式 Hook 定义、注入、数据回传、反调试绕过 |
| **实现逻辑** | **Facade 模式**: `HookManager` 聚合 `HookCodeBuilder` (脚本生成) + `HookTypeRegistry` (类型注册) + `HookStore` (数据存储)。支持 `create()` (声明式) 和 `createWithBuilder()` (链式 Builder) 两种创建方式 |
| **关键类** | `HookManager` — 外观; `HookTypeRegistry` — 插件式扩展点; `AIHookGenerator` — AI 辅助生成 |
| **设计模式** | **Facade 模式、Builder 模式、Plugin 模式 (通过 `registerType()` 注册自定义 Hook 类型)** |
| **改进空间** | HookTypeRegistry 内置类型以硬编码方式加载，未来可考虑完全插件化 |

#### 3.2.6 反混淆模块 (src/modules/deobfuscator/)

| 方面 | 分析 |
|------|------|
| **职责** | 多策略反混淆管道，支持多种混淆类型 |
| **实现逻辑** | **Pipeline + Strategy 模式**: 检测混淆类型 → 解包 Packer/AAEncode/URLEncode → JSVMP 虚拟化还原 → 高级混淆 (控制流平坦化、不透明谓词) → 基础管线 → AST 优化 → 变量重命名 → LLM 辅助分析。每个阶段独立 try-catch，非致命失败不阻断后续环节 |
| **关键类** | `Deobfuscator` — 管道调度; `PackerDeobfuscator` / `JSVMPDeobfuscator` / `AdvancedDeobfuscator` — 策略实现; `ASTOptimizer` — AST 优化 |
| **设计模式** | **Pipeline 模式、Strategy 模式** |
| **改进空间** | 阶段间数据共享通过 `DeobfuscationContext` 进行，接口可更明确 |

#### 3.2.7 调试器 (DebuggerContext / src/tools/debugger/)

| 方面 | 分析 |
|------|------|
| **职责** | CDP Debugger 域的封装：脚本追踪、断点管理、暂停状态、调用帧检查、自动断点循环恢复 |
| **实现逻辑** | `DebuggerContext` 管理 CDP Session 事件监听 (scriptParsed/paused/resumed)，提供脚本搜索 `searchInScripts()`、断点管理 `setBreakpoint/removeBreakpoint`、执行控制 `pause/resume/stepOver/stepInto/stepOut`、作用域变量获取 `getScopeVariables()`、调用帧表达式求值 `evaluateOnCallFrame()`。**断点循环检测**: 2s 窗口内同一断点命中 3 次 → 自动恢复 (resume + 移除断点) |
| **关键类** | `DebuggerContext` — 869 行; DebuggerManager (src/modules/debugger/) — 子管理器延迟加载 |
| **设计模式** | **薄封装模式** — 对 CDP Debugger 域的 1:1 方法包装 |
| **改进空间** | DebuggerContext 与 DebuggerManager 之间存在职责重叠 |

#### 3.2.8 AI 服务层 (src/services/)

| 方面 | 分析 |
|------|------|
| **职责** | 提供统一的 LLM 调用封装，支持多提供商、重试、错误分类 |
| **实现逻辑** | `AIProvider` 接口定义 `chat()` 和 `analyzeImage()`。三个提供商实现: `OpenAIProvider`、`AnthropicProvider`、`GeminiProvider` (支持 API 和本地 CLI 两种模式)。`AIService` 包装器提供指数退避重试 (max 3 次) + 错误分类 (网络错误/429/5xx)。`LLMService` 提供业务级提示词模板 |
| **关键类** | `AIProvider` 接口、`AIService` (重试封装)、`LLMService` (提示词工厂) |
| **被调用方** | `CodeAnalyzer` / `AISummarizer` / `Deobfuscator` / `CryptoDetector` 等分析模块 |
| **设计模式** | **策略模式 (不同 LLM 提供商的统一接口)、装饰器模式 (AIService 封装重试逻辑)** |
| **隐式耦合** | `GeminiProvider` 对 `DEFAULT_LLM_PROVIDER` 有圈复杂度较高的条件分支 (API vs CLI 模式) |
| **改进空间** | 配置系统应暴露 Anthropic/Gemini 的配置键; 考虑引入请求缓存减少重复调用 |

#### 3.2.9 事件总线 (src/utils/EventBus)

| 方面 | 分析 |
|------|------|
| **职责** | 提供模块间松耦合的事件通信机制 |
| **实现逻辑** | 泛型 `EventBus<TMap>` 将事件名到 payload 类型通过类型参数 TMap 关联。`on()` 返回取消订阅函数。`emit()` 时通过 Option 中传入的 Zod validators 对 payload 进行运行时校验。异步 handler 以 `void` 调用，不阻塞 emit 调用方 |
| **事件映射** | 9 个全局事件: `browser:launched/closed`、`hook:injected/triggered`、`network:captured`、`debugger:paused/resumed`、`tool:called/error` |
| **设计模式** | **观察者模式 / Pub/Sub 模式** |
| **改进空间** | 无异步事件中间件能力 (如日志、过滤、重试); 有些事件 (如 `hook:triggered`) 实际未被任何模块使用 |

#### 3.2.10 缓存系统 (src/utils/)

| 方面 | 分析 |
|------|------|
| **职责** | 统一协调多级缓存，提供全局统计、智能清理、预警 |
| **实现逻辑** | `UnifiedCacheManager` (单例) 通过 `CacheAdapter` 适配器协调 3 个缓存: `DetailedDataManager` (LRU + TTL 自动续期)、`CodeCache` (代码文件)、`CodeCompressor` (压缩结果)。智能清理三阶段: 过期 → 低命中率 → 大体积 |
| **关键类** | `UnifiedCacheManager` (协调者)、`DetailedDataManager` (分层存储 + LRU + 30min TTL + 自动续期) |
| **设计模式** | **单例模式、适配器模式 (3 个异构缓存统一接口)、协调者模式** |
| **改进空间** | 500MB 上限未软配置; `DetailedDataManager` 的大小估算不精确 (50KB/条固定); 预热 `preheat()` 仅为空壳 |

#### 3.2.11 RPC 协议层 (src/protocol/)

| 方面 | 分析 |
|------|------|
| **职责** | Worker 与 RPC Server 之间的 WebSocket 通信 |
| **实现逻辑** | `RpcClient` 通过 Sekiro 协议连接到 RPC Server。Action 注册表管理 `Map<string, ActionHandler>`。心跳 30s 一次 ping，10s pong 超时断开触发重连。重连策略: 指数退避 (2s base × 2^attempts, max 30s)。请求处理: JSON.parse → action 路由 → handler(request, resolve, reject) |
| **关键类** | `RpcClient` — 508 行 |
| **被调用方** | Worker 主函数 `registerBuiltinActions()` + `ToolAdapter.registerAll()` |
| **设计模式** | **命令模式 (Action Handler 注册表)、指数退避重连** |
| **改进空间** | `_execjsHandler` 的安全性 (使用 `new Function()` 执行任意代码); 无请求超时机制; 响应序列化可优化 |

#### 3.2.12 Worker 层 (src/worker/)

| 方面 | 分析 |
|------|------|
| **职责** | 将所有 MCP 工具注册为 Sekiro Actions，管理执行上下文和生命周期 |
| **实现逻辑** | `ToolAdapter` 从 `generated-tools-index.ts` 动态加载工具定义，`wrapTool()` 建立 `defineTool → Sekiro ActionHandler` 的桥接。三个调用模式: `frame` (在页面 frame 上执行)、`context` (在 contextProvider 上执行)、`direct` (仅参数)。`ToolContextProvider` (Facade) 聚合 4 个子模块: PageManager + DebuggerSessionManager + DataCollectorManager + ServiceLocator |
| **关键类** | `ToolAdapter` (464 行)、`ToolContextProvider` (420 行)、`WorkerLifecycle.createGracefulShutdown()` |
| **设计模式** | **外观模式 (ToolContextProvider 统一 4 个子模块)、桥接模式 (ToolAdapter 桥接工具定义与 Sekiro 协议)** |
| **改进空间** | Frame evaluate 超时 (10s) 通过 Proxy 实现，调试器暂停时 10s 可能不够 |

---

## 4. 设计模式与架构风格分析

### 4.1 已使用的设计模式

| 模式 | 使用位置 | 解决的问题 | 评价 |
|------|---------|-----------|------|
| **单例模式** | `Runtime.getRuntime()`, `BrowserManager.getInstance()`, `UnifiedCacheManager.getInstance()`, `DetailedDataManager.getInstance()`, `TokenBudgetManager.getInstance()`, `DatabaseService` 导出实例 | 确保全局唯一实例，避免重复初始化浏览器连接、缓存、数据库连接 | ⚠️ 使测试略复杂，需 `resetInstance()` 方案 |
| **外观模式** | `ToolContextProvider` 聚合 PageManager / DebuggerSessionManager / DataCollectorManager / ServiceLocator; `HookManager` 聚合 HookCodeBuilder / HookTypeRegistry / HookStore | 为 Tool handler 提供统一入口，隐藏底部 4 个子模块的复杂性 | ✅ 职责分离好，单个入口降低耦合 |
| **适配器模式** | `DevToolsConnectionAdapter` (Playwright CDPSession → CDPConnection); `CacheAdapters` (3 个缓存 → CacheInstance); `third_party/puppeteer-compat.ts` (Puppeteer 兼容) | 在不同接口间转换，实现 Puppeteer→Playwright 迁移、异构缓存统一 | ✅ 适配层干净，零侵入 |
| **策略模式** | `BrowserManager` 双模式 (connect vs launch) + 端口发现三层策略; `Deobfuscator` 通过子模块实现不同混淆策略; `AIProvider` 接口 (OpenAI/Anthropic/Gemini) | 算法/策略的可替换性，运行时选择 | ✅ Strategy 接口定义清晰 |
| **模板方法模式** | `PageCollector<T>` 抽象基类: `attachListeners()` / `detachListeners()` 由子类实现 | 多个收集器 (Network/Console/WSC) 共享导航分组和生命周期逻辑 | ✅ 减少大量重复代码 |
| **管道模式** | `Deobfuscator` 反混淆管线: 检测 → 解包 → JSVMP → 高级 → 基础 → AST → 重命名 → AI | 多阶段处理，每阶段独立失败 | ✅ 高容错: 每步独立 try-catch |
| **观察者模式** | `EventBus` (Pub/Sub 9 个事件); `DebuggerContext` CDP 事件监听 (scriptParsed/paused/resumed); `BrowserManager.on('disconnected')` 崩溃监听 | 模块间松散通信，事件驱动 | ✅ EventBus 有 Zod 校验加分 |
| **桥接模式** | `ToolAdapter` 将 `defineTool` 定义桥接到 Sekiro ActionHandler 协议 | 分离工具定义和传输协议 | ✅ 可独立替换协议层 |
| **命令模式** | `RpcClient` 注册 `Map<string, ActionHandler>`, 按 action 名路由 | 请求封装为命令对象，支持注册/注销/路由 | ✅ 标准实现 |
| **工厂模式** | `createAIService()` 根据 provider 创建对应实现; `getRuntime()` 首次创建所有实例 | 对象创建的集中管理 | ✅ 创建逻辑集中 |
| **Builder 模式** | `HookManager.createWithBuilder()` 链式构建 Hook | 复杂 Hook 配置的逐步构建 | ✅ 链式 API 清晰 |
| **协调者模式** | `UnifiedCacheManager` 协调 3 个缓存实例 | 多个缓存的全局管理，不替代它们 | ✅ 非侵入式 |
| **装饰器模式** | `AIService` 封装重试逻辑 + 错误分类，不影响 `AIProvider` 实现 | 在透明外层添加重试能力 | ✅ 关注点分离好 |
| **代理模式** | `Frame evaluateWithTimeout` Proxy 拦截 `frame.evaluate()` 添加超时保护 | 在不修改 Playwright 对象的情况下扩展超时 | ✅ Proxy 方案轻量 |

### 4.2 可以引入但尚未使用的设计模式

| 模式 | 建议位置 | 理由 |
|------|---------|------|
| **工厂方法模式** | `ToolAdapter.loadHandler()` | 当前动态 import + `if-else` 分派创建不同模式 handler，可抽象为 `HandlerFactory.create(meta)` |
| **访问者模式** | JS AST 分析 (CodeAnalyzer / CryptoDetector) | Babel traverse 已隐含访问者模式，但 `CodeAnalyzer` 的静态分析可封装为更细粒度的 AST Visitor |
| **状态模式** | `BrowserManager` 状态管理 | 当前通过布尔 flags (`isRestarting`/`isConnected`) 控制，可引入显式状态机 (disconnected/connecting/connected/closing/closed) |
| **责任链模式** | `ToolAdapter.wrapTool()` 的调用前/后处理 | 当前参数校验、执行、日志记录在单个函数中线性展开，可拆为独立中间件 |
| **命令队列模式** | `ToolExecutionScheduler` | 当前只有简单读写分离，未来可扩展为带优先级、延迟执行、取消的任务队列 |
| **空对象模式** | `SiteExperienceService\` 搜索返回 | 数据库未配置时统一返回空数组/空对象，减少消费者 if-null 检查 |
| **规格模式** | `CryptoDetector` 规则引擎 | 当前规则是简单 if-else 判断，可用规格模式组合复杂检测条件 |

### 4.3 架构层级模式分析

项目采用一种**改良的分层架构**，接近于 **Hexagonal Architecture (Ports and Adapters)** 的变体:

| 层级 | 对应目录 | Ports (接口) | Adapters (实现) |
|------|---------|-------------|----------------|
| **基础设施层** | `src/browser/`, `src/protocol/`, `src/services/DatabaseService.ts` | CDPSession, RPC protocol | BrowserManager (Chrome CDP), RpcClient (Sekiro WS), DatabaseService (pg) |
| **核心领域层** | `src/modules/` | HookTypePlugin, AIProvider, DeobfuscatorStrategy (隐式) | HookManager, CodeAnalyzer, Deobfuscator |
| **应用层** | `src/tools/` + `src/worker/` | ToolDefinition, Context | ~100 个具体工具 + ToolAdapter |
| **配置层** | `src/config/` | — | 多源合并 + 环境变量 |

**不符合纯 Hexagonal 的地方**: 
- `BrowserManager` 直接暴露 `patchright.Browser` 具体类型（而非抽象接口）
- 领域层模块之间硬编码的引用关系 (如 `WasmCollector` 接收 `PageController` 具体类)
- 没有明确的 UseCase / Interactor 层来编排复杂业务流程

---

## 5. 可视化图表

### 5.1 系统架构图

```mermaid
graph TB
    subgraph CLI_SRC["CLI层 (src/cli/)"]
        JSREV[js-reverse命令]
        YARGS[yargs CLI解析]
        START[start命令]
        CALL[call命令]
        REPL[REPL模式]
    end

    subgraph RPC["RPC协议层 (src/protocol/)"]
        CLIENT[RpcClient<br/>Sekiro WebSocket]
        WS[WebSocket 连接]
        HB[心跳 30s/ping<br/>10s pong超时]
        RECONNECT[指数退避重连<br/>2s base × 2^n, max 30s]
    end

    subgraph WORKER["Worker层 (src/worker/)"]
        ADAPTER[ToolAdapter<br/>defineTool → Sekiro Action]
        CONTEXTPROV[ToolContextProvider<br/>(Facade)]
        subgraph SUBMODULES["子模块"]
            PM[PageManager]
            DSM[Debugger<br/>SessionManager]
            DCM[DataCollector<br/>Manager]
            SL[ServiceLocator]
        end
        LIFECYCLE[WorkerLifecycle<br/>优雅关闭]
    end

    subgraph RUNTIME["Runtime核心<br/>单例模式聚合所有模块"]
        BM[BrowserManager]
        COLL[CodeCollector]
        HM[HookManager]
        AN[CodeAnalyzer]
        DEO[Deobfuscator]
        WD[WasmDetector]
        RT[ReverseTaskStore]
        EB[EventBus<br/>9 events]
        CACHE[UnifiedCacheManager<br/>500MB max]
    end

    subgraph MODULES["核心模块 (src/modules/)"]
        CC[collector模块<br/>代码收集/缓存/压缩]
        HK[hook模块<br/>Hook注入/管理/存储]
        AZ[analyzer模块<br/>静态+AI代码分析]
        DO[deobfuscator模块<br/>Packer→JSVMP→AST管线]
        CR[crypto模块<br/>加密检测/AST/AI]
        WS[wasm模块<br/>WASM收集/分析/反编译]
    end

    subgraph TOOLS["MCP工具层 (~100+工具)"]
        TG[generated-tools-index<br/>自动生成索引]
        TD[ToolDefinition<br/>defineTool DSL]
        CAT[ToolCategory<br/>10个分类]
        HOOK[hook/ 工具集]
        DEBUG[debugger/ 工具集]
        NET[network/ 工具集]
        DOM[dom/ 工具集]
        PERF[performance/ 工具集]
        WASM[wasm/ 工具集]
        OTHER[其他 20+ 子目录]
    end

    subgraph SERVICES["服务层 (src/services/)"]
        AI[AIService<br/>重试/错误分类]
        LLM[LLMService<br/>提示词模板]
        OP[OpenAIProvider]
        ANP[AnthropicProvider]
        GP[GeminiProvider<br/>API + CLI]
        DB[DatabaseService<br/>pg + Drizzle ORM]
        SES[SiteExperienceService<br/>站点经验CRUD]
    end

    subgraph THIRDPARTY["第三方层 (src/third_party/)"]
        PW[patchright<br/>Playwright fork]
        CDP[CDP Protocol Types]
        PP[PuppeteerCompat]
        STUBS[DevTools Stubs]
    end

    subgraph CONFIG["配置管道 (src/config/)"]
        ENV[环境变量<br/>dotenv]
        FILE[JSON配置文件<br/>3个层级]
        DEF[内置默认值]
        RESOLVER[resolveConfig<br/>合并管线]
    end

    subgraph AI_SYSTEM["外部AI系统<br/>(可选)"]
        OPENAI[OpenAI API]
        ANTHROPIC[Anthropic API]
        GEMINI[Gemini API/CLI]
    end

    subgraph BROWSER["浏览器引擎"]
        CHROME[Chrome/Edge<br/>CDP协议]
        WS2[WebSocket]
    end

    %% 连接关系
    JSREV --> YARGS
    YARGS --> START
    YARGS --> CALL
    YARGS --> REPL
    START --> RESOLVER
    RESOLVER --> ENV & FILE & DEF
    START --> CLIENT
    CLIENT --- WS
    WS --- HB
    WS --> RECONNECT
    RESOLVER --> RUNTIME
    CALL --> ADAPTER
    ADAPTER -.- TG
    TG --> TD
    TD --> CAT
    TG --> HOOK & DEBUG & NET & DOM & PERF & WASM & OTHER
    ADAPTER --> CONTEXTPROV
    CONTEXTPROV --> PM & DSM & DCM & SL
    RUNTIME --- BM & COLL & HM & AN & DEO & WD & RT & EB & CACHE
    BM --- THIRDPARTY
    BM <---> CHROME
    CHROME --- WS2
    BM --- STUBS
    SL --> MODULES
    MODULES --- CC & HK & AZ & DO & CR & WS
    SERVICES --> AI
    AI --> OP & ANP & GP
    GP -.- GEMINI
    OP -.- OPENAI
    ANP -.- ANTHROPIC
    AI --- LLM
    AZ --- AI
    DO --- AI
    CR --- AI
    HK --> LLM
    DB --> SES
    CONFIG --> BM
    CONFIG --> RUNTIME
    LIFECYCLE --> BM & CLIENT
    THIRDPARTY --- PW & CDP & PP & STUBS
    THIRDPARTY --> TOOLS
```

### 5.2 核心业务流程图 — 一次 MCP 工具调用的完整生命周期

```mermaid
sequenceDiagram
    participant Client as MCP Client<br/>(IDE/CLI)
    participant Sekiro as Sekiro RPC Server
    participant RPC as RpcClient<br/>(Worker端)
    participant Adapter as ToolAdapter
    participant Meta as tools-meta.ts
    participant Handler as Tool Handler
    participant CP as ToolContextProvider
    participant Page as Browser Page

    Client->>Sekiro: WebSocket 请求<br/>{action: "hook_function", params: {...}}
    Sekiro->>RPC: 向分组内广播请求
    RPC->>RPC: handleRpcRequest()<br/>JSON解析 + action路由

    RPC->>Adapter: wrapTool() 入口
    Adapter->>Meta: loadHandler(meta)<br/>动态 import defineTool
    Meta-->>Adapter: ToolDefinition 对象
    Adapter->>Adapter: validateToolArgs()<br/>Zod schema 参数校验

    alt defineTool 模式
        Adapter->>CP: buildDefineToolContext()
        CP-->>Adapter: Context (含有选中的 Page/Frame)
        Adapter->>Handler: handler({params}, response, context)
        Handler->>Page: CDP 操作 (evaluate/click等)
        Page-->>Handler: 结果
        Handler->>Adapter: 通过 Accumulator 累加响应
    else frame 模式 (旧式)
        Adapter->>Page: 获取选中 Frame (带超时 Proxy)
        Adapter->>Handler: handler(frame, params)
        Page-->>Handler: 结果
    else context 模式 (旧式)
        Adapter->>CP: 传递 contextProvider
        Adapter->>Handler: handler(contextProvider, params)
        CP-->>Handler: 服务实例
    else direct 模式 (旧式)
        Adapter->>Handler: handler(params)
    end

    Handler->>Handler: 业务逻辑处理
    Handler-->>Adapter: 返回结果

    Adapter->>Adapter: 记录成功调用<br/>TokenBudgetManager.recordToolCall()
    Adapter->>CP: eventBus.emit('tool:called',<br/>{name, durationMs, success})
    Adapter-->>RPC: resolve(responsePayload)

    RPC->>RPC: sendSuccess()<br/>序列化为 JSON
    RPC-->>Sekiro: WebSocket 响应
    Sekiro-->>Client: 返回结果
```

### 5.3 页面逆向标准流程

```mermaid
flowchart TB
    START([开始]) --> OBSERVE[1. 页面观察<br/>list_scripts / search_in_scripts<br/>获取脚本列表和代码位置]
    OBSERVE --> HOOK[2. 运行时采样<br/>create_hook / inject_hook<br/>最小侵入式观测]
    HOOK --> CHECK_HOOK{检查 Hook 数据<br/>get_hook_data}
    CHECK_HOOK -->|已采集到数据| NETWORK[3. 网络分析<br/>trace_signature_generation<br/>从请求追踪签名生成过程]
    CHECK_HOOK -->|无数据| DEBUG[3b. 断点调试<br/>xhr_to_js_breakpoint<br/>set_breakpoint + resume]
    DEBUG --> NETWORK
    NETWORK --> EXPORT[4. 导出本地复现<br/>export_rebuild_bundle<br/>导出入口+补环境+证据]
    EXPORT --> ENV[5. 逐项补环境<br/>diff_env_requirements<br/>env.js + polyfills.js]
    ENV --> VERIFY{运行 entry.js<br/>验证是否有分歧}
    VERIFY -->|有运行时错误| ENV
    VERIFY -->|env-pass 通过| PURE[6. 纯算法提纯<br/>deobfuscate_code + understand_code<br/>剥离风控逻辑]
    PURE --> EVIDENCE[7. 证据沉淀<br/>record_reverse_evidence<br/>写入 task artifact]
    EVIDENCE --> DONE([完成])
```

---

## 6. 二次开发与架构优化建议

### 🏆 建议 1: 引入显式状态机管理浏览器连接生命周期

| 维度 | 内容 |
|------|------|
| **目标模块** | `src/browser/browser.ts` — BrowserManager |
| **当前问题** | 浏览器状态通过分散的布尔标志管理 (`isRestarting` / `isConnected`), 状态转换在条件分支中隐式发生, 并发重启保护和边界条件依赖多个标志组合, 新增状态容易漏掉旧状态转换 |
| **具体方案** | 引入显式有限状态机 (可用 `typescript-state-machine` 或纯 TypeScript 实现) |
| | **状态**: `DISCONNECTED → CONNECTING → CONNECTED → RESTARTING → CLOSING` |
| | **迁移**: 每个状态转换有明确的 guard 条件和副作用, 不合法状态转换为编译错误 |
| | **继承**: 保留现有 API 签名, 内部将布尔标志替换为状态机 |
| **预期收益** | 崩溃恢复路径 100% 可预测; 新增状态 (如 MAINTENANCE) 零风险; 并发竞态条件消除; 错误报告精确到具体状态 |
| **风险与成本** | 中等: 需要仔细映射现有 ~15 种状态相关方法; 短期部分重写 `BrowserManager`; 测试用例需重新覆盖所有状态转换路径 |

### 🏆 建议 2: 将 `BrowserManager` 接口抽象化, 解耦核心领域层对 `patchright` 的直接依赖

| 维度 | 内容 |
|------|------|
| **目标模块** | `src/browser/` / `runtime.ts` / 所有通过 Runtime 获取 Page/BrowserContext 的模块 |
| **当前问题** | `BrowserManager` 直接导出 `patchright.Page`, `patchright.BrowserContext` 等具体类型; 整个 ~185 个文件通过 `third_party/index.ts` 引入 Playwright 具体类型; 更换浏览器引擎 (如 Puppeteer 换回) 或引入无头模式替换方案需要修改所有引用 |
| **具体方案** | 在 `src/browser/` 中定义纯 TypeScript 接口: `IBrowserPage {navigate, evaluate, screenshot, ...}`, `IBrowser {launch, close, createPage, ...}`; `BrowserManager` 实现这些接口 + 适配器适配到具体引擎; 目前通过 `third_party/` 的兼容层可作为过渡 |
| **预期收益** | 核心模块不依赖具体浏览器实现; 可同时支持多种浏览器引擎; 测试时可注入 Mock Page 无需启动真实浏览器 |
| **风险与成本** | 高: 涉及全仓库 185+ 文件引用链; 需定义完整接口 (Page/Browser/Frame/BrowserContext 各 20+ 方法); 实施需分层推进, 不能一次性替换 |

### 🏆 建议 3: 完善配置系统的 Zod schema 验证

| 维度 | 内容 |
|------|------|
| **目标模块** | `src/config/schema.ts` |
| **当前问题** | `schema.ts` 为空占位文件; 配置验证分散在 `resolver.ts` 的条件分支中; 对无效配置仅在运行时暴露 (如 LLM Provider 拼写错误); 嵌套配置对象 (OpenAI/浏览器) 处理不统一 |
| **具体方案** | 使用 Zod 定义 `GlobalConfigSchema`, 在 `resolveConfig()` 最终合并后调用 `schema.parse()`; 利用 Zod 的能力: 默认值、类型强制、联合类型、`refine` 跨字段校验; 为空字段提供友好错误消息; 在 `getSystemConfig()` 和 `createAIService()` 中重复使用 |
| **预期收益** | 启动时验证, 配置错误立即暴露; 自文档化的 Schema (Zod 自动推导类型); 减少 `resolver.ts` 中 ~100 行条件校验代码 |
| **风险与成本** | 低: 纯新增, 不影响现有功能; 项目已在广泛使用 Zod (仅工具层就 185+引用), 无新增依赖; 两个工时 + 测试时间 |

### 🏆 建议 4: 为数据库引入 drizzle-kit 正式迁移系统

| 维度 | 内容 |
|------|------|
| **目标模块** | `src/database/` |
| **当前问题** | 使用内联 `CREATE TABLE IF NOT EXISTS` 在运行时执行迁移; 无版本控制、无回滚、无迁移历史; 无法处理数据库模式变更; 多 Worker 实例同时启动时存在竞态 |
| **具体方案** | 添加 `drizzle.config.ts`; 将当前 schema 转换为首个正式迁移; 在 `package.json` 添加 `drizzle-kit generate`/`push`/`migrate` 脚本; 将 `DatabaseService.migrate()` 切换到基于文件的迁移执行 |
| **预期收益** | 模式变更可审计、可回滚; 多实例安全; 支持未来添加更多表 |
| **风险与成本** | 低: drizzle-kit 已在 devDependencies 中, 只需配置即可; 添加新表即可看到迁移效果 |

### 🏆 建议 5: 引入 Design System / UI 规范 (如未来构建前端的备选)

| 维度 | 内容 |
|------|------|
| **目标模块** | 跨架构 — 构建 Web UI 时 |
| **当前问题** | 当前项目为纯 CLI/MCP 模式; 如果未来需要构建 Dashboard/Web UI, 目前无 UI 架构约定 |
| **具体方案** | 预留前端架构: 独立前端包 (如 `frontend/`); 使用 React + Tailwind CSS; MCP 工具 API 作为后端数据源; 工具执行结果标准化 JSON 格式 |
| **预期收益** | 前端/后端分离; MCP 工具层天然是 RESTful 数据源 |
| **风险与成本** | 仅备选建议; 当前无需实施 |

---

## 7. 新开发者实战入门指南

### 7.1 本地环境搭建

**所需软件**:

| 软件 | 版本要求 | 说明 |
|------|---------|------|
| **Node.js** | ^20.19.0 \|\| ^22.12.0 \|\| >=23.0.0 | 推荐使用 v22 LTS |
| **npm** | ~10.x (随 Node 分发) | 包管理器 |
| **Git** | 任意现代版本 | 版本控制 |
| **Chrome/Edge** | 最新稳定版 | 浏览器调试目标 (可选, 程序会自动启动) |

**依赖安装**:

```bash
# 克隆仓库
git clone https://github.com/zhizhuodemao/js-reverse-mcp.git
cd js-reverse-mcp

# 安装项目依赖
npm install

# 构建项目 (SWC 编译 TypeScript → build/)
npm run build

# 类型检查 (可选)
npm run typecheck
```

**环境变量配置** (可选, 用于 LLM / 数据库):

```bash
# 复制 .env.example (如果存在) 或新建
# 最少配置 — 只需浏览器调试功能则完全不需要

# AI 提供商 (三选一)
DEFAULT_LLM_PROVIDER=openai   # 或 anthropic / gemini
OPENAI_API_KEY=sk-xxx

# 数据库 (可选, 用于持久化站点经验)
DATABASE_URL=postgresql://user:pass@localhost:5432/js_reverse
```

### 7.2 从 0 到运行

```bash
# 1. 构建
npm run build

# 2. 启动 Worker (直接模式)
npm run start

# 3. 或者: 接管已有浏览器
# 先手动启动 Chrome: chrome.exe --remote-debugging-port=9222
npm run start -- --browserUrl http://127.0.0.1:9222

# 4. 查看 CLI 交互 (新终端)
# 查看可用命令
node build/src/bin/js-reverse.js --help

# 启动交互式 REPL
node build/src/bin/js-reverse.js repl

# 查看所有可用工具
node build/src/bin/js-reverse.js list-skills
```

### 7.3 最小改动示例 (Hello World)

**场景**: 新增一个获取当前页面标题的 MCP 工具

**步骤 1: 定义工具**

新建 `src/tools/page/pageTitle.ts`:

```typescript
import {z} from 'zod';
import {defineTool, ToolCategory} from '../ToolDefinition.js';

export const getPageTitle = defineTool({
  name: 'get_page_title',
  description: '获取当前页面的标题 (title)',
  annotations: {
    title: '获取页面标题',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
  },
  schema: {},  // 无需参数
  handler: async (_request, response, context) => {
    const frame = context.getSelectedFrame();
    const title = await frame.evaluate(() => document.title);
    response.appendResponseLine(`页面标题: ${title}`);
  },
});
```

**步骤 2: 注册到工具索引**

在 `src/tools/generated-tools-index.ts` 的数组中加入:

```typescript
{modulePath: './page/pageTitle.js', handlerName: 'getPageTitle'},
```

> **说明**: `generated-tools-index.ts` 通过 `scripts/generate-tools-index.ts` 自动生成。你也可以手动添加，或者运行:
>
> ```bash
> node --experimental-strip-types scripts/generate-tools-index.ts
> ```

**步骤 3: 构建并测试**

```bash
npm run build

# 验证工具已注册
node build/src/bin/js-reverse.js call get_page_title --help

# 启动 Worker 并调用
npm run start  # 后台运行
node build/src/bin/js-reverse.js call get_page_title
```

### 7.4 常见开发任务

| 任务 | 命令 |
|------|------|
| 构建项目 | `npm run build` |
| 类型检查 | `npm run typecheck` |
| 运行单元测试 | `npm run test:unit` |
| 运行所有测试 | `npm test` |
| 代码格式化 | `npm run format` |
| 检查格式 | `npm run check-format` |
| 运行覆盖率 | `npm run coverage` |

### 7.5 项目贡献指南

1. **核心原则**: 遵循 `Observe-first`、`Hook-preferred`、`Breakpoint-last`、`Evidence-first` 方法论
2. **代码风格**: TypeScript ESM, `singleQuote: true`, `trailingComma: all`, `arrowParens: avoid`
3. **提交风格**: Conventional Commits (`feat:` / `fix:` / `build:` / `docs:`)
4. **安全规范**: 不提交真实 Cookie、Storage、生产参数
5. **测试要求**: 新增代码补对应层级测试 (单元/集成/属性), 覆盖率目标 80%
6. **开发前必读**: `docs/reference/reverse-bootstrap.md`

---

## Tool Profiles

`Browser-CLI` 通过 `JS_REVERSE_TOOL_PROFILE` 环境变量在三档工具集中切换，用 token 成本换取覆盖范围。

| Profile    | 工具数     | 适用场景                                                |
| ---------- | ---------- | ------------------------------------------------------- |
| `search`   | 1          | 上下文极紧的 LLM 宿主：仅暴露 `search_tools`，按需发现工具 |
| `workflow` | ~110       | 浏览器自动化 + JS 逆向日常：分析、Hook、采集、网络观察   |
| `full`     | 全量 (126) | 加上 debugger / wasm / anti-debug / perf / rebuild       |

默认值是 `full`，与既有行为一致。示例：

```bash
JS_REVERSE_TOOL_PROFILE=workflow npm run cli:start
JS_REVERSE_TOOL_PROFILE=search node build/src/bin/js-reverse.js list-tools
```

档位继承关系：`search ⊂ workflow ⊂ full`。即 `workflow` 包含所有 `search` 工具，`full` 包含所有 `workflow` 工具。

---

## 附录 A: 数据库 Schema

```sql
-- 当前唯一表: site_experiences
CREATE TABLE site_experiences (
  id            SERIAL PRIMARY KEY,
  domain        VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  aliases       TEXT[] DEFAULT '{}',
  platform_features   TEXT,
  valid_patterns      TEXT,
  known_pitfalls      TEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_site_experiences_name ON site_experiences(name);
CREATE INDEX idx_site_experiences_domain ON site_experiences(domain);
```

## 附录 B: AppEventMap (9 个全局事件)

```typescript
interface AppEventMap {
  'browser:launched':    {url: string; mode: string};
  'browser:closed':      {reason: string};
  'hook:injected':       {hookId: string; target: string; url: string};
  'hook:triggered':      {hookId: string; data: unknown};
  'network:captured':    {requestId: string; url: string; method: string};
  'debugger:paused':     {reason: string; scriptId: string};
  'debugger:resumed':    Record<string, never>;
  'tool:called':         {name: string; durationMs: number; success: boolean};
  'tool:error':          {name: string; code: string; message: string};
}
```

## 附录 C: GitNexus Code Intelligence

```
项目索引状态 (AGENTS.md):
- 6825 个符号
- 15334 个关系
- 300 个执行流
```

有 GitNexus 索引支持, 开发者在修改符号前应运行 `gitnexus_impact()` 分析影响范围。
