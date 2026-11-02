# Browser-CLI

> 前端 JavaScript 逆向流程标准化的浏览器自动化与调试工具集。

[![Node.js Version](https://img.shields.io/badge/node-%5E20.19.0%20%7C%7C%20%5E22.12.0%20%7C%7C%20%3E%3D23-brightgreen)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9%20ESM-blue)](tsconfig.json)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

---

## 目录

- [1. 项目概览与架构](#1-项目概览与架构)
- [2. 核心逆向方法论](#2-核心逆向方法论)
- [3. 反检测哲学（Anti-Detection）](#3-反检测哲学anti-detection)
- [4. 快速上手](#4-快速上手)
- [5. CLI 核心用法与工具调用](#5-cli-核心用法与工具调用)
- [6. 项目工程结构](#6-项目工程结构)
- [7. 公开逆向实战链路](#7-公开逆向实战链路)
- [8. 开发、测试与文档矩阵](#8-开发测试与文档矩阵)

---

## 1. 项目概览与架构

**Browser-CLI** 是面向现代 Web 前端逆向工程、安全分析与自动化调试的专业工具集。

不同于传统的单一爬虫框架或通用浏览器自动化测试工具，Browser-CLI 将**“页面观察 → 运行时采样 → 本地复现 → 补环境 → 证据沉淀”**串联为一套标准化的闭环工程工作流。

### 架构设计：Daemon + CLI 模式

系统采用**常驻守护进程（Daemon）+ CLI 客户端（`browsercli`）**的分离架构，二者通过本地命名管道（POSIX 下为 Unix Domain Socket，Windows 下为 Named Pipe）基于 NDJSON 帧协议进行低延迟通信：

```
┌───────────────────────────────────────────────────────────────┐
│                     CLI 客户端 (browsercli)                    │
│   yargs 解析 → daemonClient → 本地命名管道 / Unix Domain Socket  │
│        (自动按 workspace-hash 探活；连不上则自动拉起 Daemon)       │
└───────────────────────────────┬───────────────────────────────┘
                                │ NDJSON IPC (tool.invoke / browser.*)
┌───────────────────────────────▼───────────────────────────────┐
│                  Daemon Worker (src/worker/)                  │
│  ┌──────────────────────┐  ┌───────────────────────────────┐  │
│  │     daemonServer     │  │     ToolExecutionPipeline     │  │
│  │ 命名管道协议解析 / 路由 │  │ 参数校验 → 上下文装配 → 管道执行│  │
│  └──────────┬───────────┘  └───────────────┬───────────────┘  │
│             │                              │                  │
│  ┌──────────▼──────────────────────────────▼───────────────┐  │
│  │                 Runtime 核心 (src/runtime.ts)            │  │
│  │        BrowserManager (CDP/Patchright) + 核心逆向模块     │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

- **纯本地 IPC 通信**：根据 [ADR 0006](docs/adr/0006-remove-mcp-entry-and-position-as-daemon-cli.md)，彻底移除了多余的 MCP stdio 与 HTTP 传输层，专注于高响应度、多会话隔离、支持打断与流式监听的守护进程架构。
- **生命周期对齐**：根据 [ADR 0007](docs/adr/0007-align-lifecycle-commands-with-chrome-devtools.md)，全面对齐 `chrome-devtools` 交互标准，通过 `start`、`stop`、`status` 三大核心命令实现进程与浏览器的平滑管控。
- **丰富的逆向工具面**：内置 90 个针对 JS 逆向深度定制的标准化工具（Covering Hook、网络、DOM、断点调试、WASM、反反调试等）。

---

## 2. 核心逆向方法论

项目在开发与逆向实践中严格遵循以下六大方法论原则：

| 原则                                           | 含义与执行准则                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Observe-first（先观察）**                    | 先在真实浏览器中确认请求、脚本、函数以及依赖加载来源（Navigation Bucket、Request Initiator），不盲目下断点。                            |
| **Hook-preferred（优先 Hook）**                | 优先采用无侵入/最小化 Hook 采样（Console / Fetch / XHR / Storage / 对象属性拦截），避免直接暂停破坏页面时序。                           |
| **Breakpoint-last（断点垫后）**                | 仅在 Hook 采样无法还原复杂的执行逻辑或上下文状态时，才接入 CDP 单步断点调试。                                                           |
| **Rebuild-oriented（面向复现）**               | 逆向分析的最终交付产物必须以本地可脱机复现（Node.js / Python 脚本）为标准。                                                             |
| **Evidence-first（证据沉淀）**                 | 每次关键操作（点击、跳转、注入）均关联网络请求、控制台日志与 DOM 变更，生成 Operation Evidence 并沉淀至 task artifact，不在对话中丢失。 |
| **Pure-extraction-after-pass（过环境后提纯）** | 先通过轻量补环境（env-pass）跑通业务逻辑，再进入纯净核心算法提取与翻译阶段。                                                            |

---

## 3. 反检测哲学（Anti-Detection）

Browser-CLI 与兄弟项目 [jshookmcp](https://github.com/zhizhuodemao/js-reverse-mcp) 秉承同一套反检测哲学：**默认零 JS 注入，反检测深度下沉至协议层与源码层**。

> **核心认知**：粗暴的 `Object.defineProperty` 原型链覆盖本身就是现代反爬系统的关键检测特征。一旦页面扫描到 `navigator`、`canvas`、`WebGL` 存在 Proxy 或被篡改，自动化指纹即刻暴露。

### 多层防护体系

| 防护层级                | 默认模式（常规/推荐）                                                                                               | `--cloak` 源码级模式（强风控逃生通道）                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **协议层（CDP）**       | 基于 Patchright：不调 `Runtime.enable` / `Console.enable`，不在 isolated world 外直接 evaluate，阻断 CDP 特征泄漏。 | 同左                                                                                                                                                             |
| **源码层（C++ 补丁）**  | 使用宿主安装的真实 Google Chrome / Edge 浏览器。                                                                    | 采用 CloakBrowser 二进制，内置 49 个 C++ 源码补丁（彻底抹除 `navigator.webdriver`，重构 Canvas、WebGL、AudioContext、GPU、系统字体、屏幕、WebRTC 及 TLS 指纹）。 |
| **用户目录（Profile）** | `~/.cache/chrome-devtools-mcp/chrome-profile`                                                                       | `~/.cache/chrome-devtools-mcp/cloak-profile`（与默认目录物理隔离，防止 Cookie 与缓存交叉污染）。                                                                 |
| **视口策略**            | **Viewport `null`**：禁用 1280×720 假视口，直接暴露操作系统真实屏幕分辨率。                                         | 同左                                                                                                                                                             |
| **启动参数**            | **最小化参数集**：仅保留 `--test-type`（抑制提示栏）和 `--hide-crash-restore-bubble`，丢弃已被风控识别的历史参数。  | 同左                                                                                                                                                             |

### 隐身控制相关 Flag

- `--cloak`：启用 CloakBrowser 定制二进制及 49 个 C++ 补丁（针对 Cloudflare、Akamai、各大厂滑块验证等强风控场景）。
- `--js-stealth`：显式开启页面端 JS 注入（向后兼容需要覆盖 `navigator.webdriver === false` 的旧版脚本）。
- `--full-stealth-args`：回退使用历史 60+ Chromium 启动参数（不推荐，部分参数已成为检测信号）。

---

## 4. 快速上手

### 4.1 环境准备

- **Node.js**：`^20.19.0 || ^22.12.0 || >=23`
- **浏览器**：本地已安装 Google Chrome 或 Microsoft Edge

### 4.2 安装与编译

```bash
# 克隆仓库并安装依赖
git clone https://github.com/zhizhuodemao/js-reverse-mcp.git browser-cli
cd browser-cli
npm install

# 编译项目 (SWC 编译至 build/)
npm run build
```

你可以通过 `npm link` 将 `browsercli` 注册到系统全局 PATH，或通过相对路径 `node build/src/cli/bin/browsercli.js` 直接运行。

### 4.3 生命周期管理（对齐 chrome-devtools）

根据 [ADR 0007](docs/adr/0007-align-lifecycle-commands-with-chrome-devtools.md)，CLI 提供统一的生命周期命令：

#### 启动并连接浏览器 (`browsercli start`)

`start` 命令负责拉起或重置 Daemon 守护进程。支持直接传递浏览器启动或连接选项，实现“单条命令完成进程启动 + 浏览器就绪”：

```bash
# 启动 daemon 并自动打开系统 Chrome
browsercli start --channel chrome

# 启动 daemon 并接管本地已有 Chrome 调试端口 (9222)
browsercli start --browser-url http://127.0.0.1:9222

# 无头模式启动系统 Chrome
browsercli start --channel chrome --headless

# 启动源码级反检测 CloakBrowser
browsercli start --cloak
```

#### 查看运行状态 (`browsercli status`)

```bash
browsercli status
```

输出当前 Daemon 会话 PID、监听的命名管道路径、Console 端口、浏览器连接状态以及当前页面 URL。

#### 停止守护进程 (`browsercli stop`)

```bash
# 停止当前工作区对应的 Daemon 会话
browsercli stop

# 停止系统中所有正在运行的 browsercli Daemon 会话并清理注册表
browsercli stop --all
```

---

## 5. CLI 核心用法与工具调用

### 5.1 工具调用规范：`browsercli call`

在 Browser-CLI 中，**Tool 是能力的唯一暴露单元**（定义于 `src/tools/`），通过 `browsercli call <tool_name> [options]` 调用：

```bash
# 1. 页面导航
browsercli call navigate_page --url "https://example.com"

# 2. 检索当前页面的所有网络请求
browsercli call list_network_requests

# 3. 追踪特定网络请求的发起调用栈 (Request Initiator)
browsercli call get_request_initiator --requestId "<REQUEST_ID>"

# 4. 向页面注入加密算法拦截 Hook
browsercli call inject_hook --code "window.__hooked = true;"

# 5. 读取 Hook 拦截并回传的结构化数据
browsercli call get_hook_data --hookId "crypto-hook-1"

# 6. 读取页面控制台捕获的日志
browsercli call list_console_messages

# 7. 在页面上下文中执行自定义 JS
browsercli call evaluate_script --function "() => document.title"
```

### 5.2 工具发现与分类 (`browsercli list-tools`)

```bash
# 查看所有可用工具列表
browsercli list-tools

# 查看指定分类下的工具
browsercli list-tools --category network
```

### 5.3 Tool Profiles（工具档位）

Browser-CLI 支持通过 `JS_REVERSE_TOOL_PROFILE` 环境变量在两档工具集合中切换，在 Token 成本与能力丰富度之间按需权衡：

| Profile        | 工具数 | 适用场景                                                                                    |
| -------------- | ------ | ------------------------------------------------------------------------------------------- |
| `workflow`     | 53     | 浏览器自动化 + JS 逆向日常高频：页面导航、DOM 查询、输入交互、网络监听、基础 Hook、脚本抓取 |
| `full`（默认） | 90     | 涵盖全部能力：CDP 断点单步调试、WASM 逆向分析、反反调试绕过、屏幕与视频录制等               |

切换示例：

```bash
JS_REVERSE_TOOL_PROFILE=workflow browsercli start --channel chrome
```

### 5.4 其他辅助命令

- `browsercli jobs`：查看或取消异步长耗时逆向任务。
- `browsercli config`：查看、设置或初始化全局与运行时配置。
- `browsercli scaffold`：快速创建标准化的逆向分析任务目录骨架。

---

## 6. 项目工程结构

```
Browser-CLI/
├── src/
│   ├── cli/                         # CLI 客户端实现 (browsercli 可执行程序)
│   │   ├── bin/browsercli.ts        # CLI 二进制入口 (基于 axi-sdk-js)
│   │   ├── commands/                # CLI 子命令 (start, stop, status, call, list-tools 等)
│   │   └── daemonClient.ts          # IPC Socket 客户端与连接池
│   ├── ipc/                         # 本地命名管道 / Unix Socket 通信层
│   │   ├── socketConnection.ts      # NDJSON 帧编解码协议
│   │   ├── daemonServer.ts          # IPC 服务端方法分发 (tools/browser/jobs)
│   │   └── registry.ts              # 会话注册表 (workspace-hash 隔离)
│   ├── worker/                      # Daemon Worker 运行时
│   │   ├── daemonMain.ts            # Worker 启动入口与就绪握手
│   │   ├── ToolExecutionPipeline.ts # 工具执行管线 (校验 → 上下文装配 → 管道执行)
│   │   └── ToolAdapter.ts           # defineTool 到管线适配层
│   ├── tools/                       # 90 个核心能力工具 (按 20 个领域划分)
│   │   ├── ToolDefinition.ts        # defineTool DSL 核心定义
│   │   ├── generated-tools-index.ts # 自动生成的全量工具注册索引
│   │   ├── hook/                    # JS Hook 注入与数据管理工具
│   │   ├── network/                 # 网络请求与 WebSocket 抓包分析工具
│   │   ├── debugger/                # CDP 断点与单步调试工具
│   │   ├── collector/               # 页面所有 JS 脚本收集与依赖分析工具
│   │   ├── wasm/                    # WebAssembly 逆向与探针工具
│   │   ├── anti-debug/              # 反反调试与无限 debugger 绕过工具
│   │   └── input/, dom/, page/...   # DOM 拟人化交互、截图、视频录制等工具
│   ├── modules/                     # 底层逆向与浏览器核心引擎
│   │   ├── browser/                 # BrowserManager (单例，连接管理与崩溃自愈)
│   │   ├── collector/               # CodeCollector (脚本拦截与缓存引擎)
│   │   ├── hook/                    # HookManager (代码构建器与采样存储)
│   │   ├── deobfuscator/            # 反混淆主管道 (AST 优化、Packer、JSVMP)
│   │   └── wasm/                    # WASM 收集、二进制分析与反编译
│   ├── utils/                       # EventBus、统一缓存、安全序列化与日志
│   ├── config/                      # 配置解析管线 (CLI > Env > Config File > Defaults)
│   └── types/                       # 全局领域类型与 AppEventMap 定义
├── docs/                            # 官方文档库
│   ├── adr/                         # 架构决策记录 (ADR 0001 - ADR 0007)
│   ├── guides/                      # 使用指南与排错手册
│   └── reference/                   # 全量工具参考与逆向规范
├── scripts/
│   ├── cases/                       # 公开沉淀的实战逆向案例 (JD / 快手 / 抖音)
│   └── generate-tools-index.ts      # 工具清单与索引自动生成脚本
├── tests/                           # 测试套件 (unit / integration / property / performance)
├── GLOSSARY.md                      # 领域核心统一词汇表
└── package.json
```

---

## 7. 公开逆向实战链路

仓库在 `scripts/cases/` 中沉淀了常见工业级站点的逆向案例、抽象骨架与验收口径（不包含未脱敏的生产密钥与私有资产）：

- **通用纯 Node 工作流骨架**：[scripts/cases/mcp-reverse-pure-node-workflow.mjs](scripts/cases/mcp-reverse-pure-node-workflow.mjs)
- **高密度抽象案例模板**：[scripts/cases/abstract-case-template.mjs](scripts/cases/abstract-case-template.mjs)
- **某东 `h5st` 签名参数复现**：[scripts/cases/jd-h5st-pure-node.mjs](scripts/cases/jd-h5st-pure-node.mjs)
  - 可直接运行验证：`npm run case:jd:h5st:pure-node`
- **某手 `falcon` 风控参数逆向**：[scripts/cases/ks-hxfalcon-pure-node.mjs](scripts/cases/ks-hxfalcon-pure-node.mjs)
- **某音 `a-bogus` 算法提取**：[scripts/cases/douyin-a-bogus-pure-node.mjs](scripts/cases/douyin-a-bogus-pure-node.mjs)

> **任务产物规范**：真实的逆向任务过程证据统一沉淀在本地 `artifacts/tasks/<task-id>/` 目录下（遵循 `_TEMPLATE/` 规范，git 默认忽略私有任务内容）。

---

## 8. 开发、测试与文档矩阵

### 8.1 常用开发命令

| 命令                   | 职责说明                                       |
| ---------------------- | ---------------------------------------------- |
| `npm run build`        | 全量编译构建（生成索引 → SWC 编译 → 后置处理） |
| `npm run typecheck`    | 执行 TypeScript 静态类型检查                   |
| `npm run test:unit`    | 运行单元测试（基于 Node.js 原生 `node:test`）  |
| `npm test`             | 运行全量测试套件（单元、契约、集成测试）       |
| `npm run format`       | 执行 ESLint 修复与 Prettier 代码格式化         |
| `npm run check-format` | 检查代码格式与 ESLint 规范                     |
| `npm run docs`         | 重新生成并同步全量工具参考文档                 |

### 8.2 文档索引

- **领域术语规范**：[GLOSSARY.md](GLOSSARY.md)
- **架构决策记录**：
  - [ADR 0006: 移除 MCP stdio 传输层，确立 Daemon + CLI 架构](docs/adr/0006-remove-mcp-entry-and-position-as-daemon-cli.md)
  - [ADR 0007: 对齐 chrome-devtools 核心生命周期命令](docs/adr/0007-align-lifecycle-commands-with-chrome-devtools.md)
  - [ADR 0005: DevToolsActivePort 发现与自动连接探针机制](docs/adr/0005-devtools-active-port-discovery-and-autoconnect.md)
  - [ADR 0004: 浏览器连接配置继承与优先级级联](docs/adr/0004-browser-connection-config-precedence.md)
  - [ADR 0002: 结构化表格提取与操作因果证据沉淀](docs/adr/0002-adopt-structured-extraction-and-operation-evidence.md)
  - [ADR 0001: 异步栈剪枝与导航分桶隔离](docs/adr/0001-prune-initiator-async-stacks-and-isolate-navigation-buckets.md)
- **操作指南与参考**：
  - 快速开始：[docs/guides/getting-started.md](docs/guides/getting-started.md)
  - 浏览器连接指南：[docs/guides/browser-connection.md](docs/guides/browser-connection.md)
  - 故障排查手册：[docs/guides/troubleshooting.md](docs/guides/troubleshooting.md)
  - 全量工具参考（自动同步）：[docs/reference/tool-reference.md](docs/reference/tool-reference.md)
  - 工具输入输出契约：[docs/reference/tool-io-contract.md](docs/reference/tool-io-contract.md)
  - 逆向任务索引：[docs/reference/reverse-task-index.md](docs/reference/reverse-task-index.md)
  - 补环境规范手册：[docs/reference/env-patching.md](docs/reference/env-patching.md)

---

## 许可证

本项目采用 [Apache-2.0](LICENSE) 许可证开源。
