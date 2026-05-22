# JSReverser-MCP 架构文档

> 基于知识图谱分析生成 (1660 节点 · 3869 边 · 81 社区)  
> 最后更新：2026-04-20

## 系统概述

JSReverser-MCP 是一个将前端 JavaScript 逆向流程标准化的 MCP (Model Context Protocol) 服务。通过 Puppeteer 接管 Chrome 浏览器，提供页面观察、Hook 采样、断点调试、网络分析、补环境复现等能力。

### 核心方法论

项目遵循以下逆向工程方法论：

- **Observe-first**: 先在浏览器里确认请求、脚本、函数和依赖来源
- **Hook-preferred**: 再做最小化 Hook 采样
- **Breakpoint-last**: 断点调试是最后手段
- **Rebuild-oriented**: 导出本地复现工程
- **Evidence-first**: 每一步都沉淀为 task artifact
- **Pure-extraction-after-pass**: env-pass 后再进入纯算法提纯

---

## 分层架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLI Layer (用户入口)                         │
│  ┌─────────────┐  ┌──────────────────┐  ┌─────────────┐            │
│  │ js-reverse  │  │ js-reverse-mcp   │  └─────────────┘            │
│  └─────────────┘  └──────────────────┘                              │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Unix Socket IPC
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Daemon Layer (后台守护进程)                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ daemon.ts: handleRequest(), startSocketServer(), cleanup()  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ MCP Protocol
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Runtime & Context Layer (核心编排层)                 │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────────┐   │
│  │ McpContext   │  │ DebuggerContext │  │ SessionManager       │   │
│  │ (56 edges)   │  │ (28 edges)      │  │                      │   │
│  └──────────────┘  └─────────────────┘  └──────────────────────┘   │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────────┐   │
│  │ Logger       │  │ McpResponse     │  │ CdpSessionProvider   │   │
│  │ (46 edges)   │  │ (33 edges)      │  │                      │   │
│  └──────────────┘  └─────────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌──────────────┐          ┌──────────────────┐        ┌──────────────┐
│  tools/      │          │   skills/        │        │  services/   │
│  (60+ tools) │          │   (3 core)       │        │              │
├──────────────┤          ├──────────────────┤        ├──────────────┤
│ - hook/      │          │ - observe-flow   │        │ - LLMService │
│ - debugger/  │          │ - auto-hook      │        │ - AIProvider │
│ - collector/ │          │ - rebuild-bundle │        │ - CryptoDet. │
│ - analyzer/  │          │                  │        │ - Deobfus.   │
└──────────────┘          └──────────────────┘        └──────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Modules Layer (功能模块封装)                     │
│  DebuggerManager(46) · CodeCollector(37) · Deobfuscator(30)          │
│  PageController(44) · HookManager · StealthScripts2025               │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Browser Layer (浏览器与 DevTools)                   │
│  browser.ts · DevToolsConnectionAdapter · Puppeteer CDP              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 核心模块详解

### 1. McpContext (56 edges - 最核心节点)

**职责**: 全局上下文管理，连接所有组件的中枢

**关键方法**:
```typescript
class McpContext {
  getDevToolsData(): Promise<DevToolsData>
  createPagesSnapshot(): Promise<PageSnapshot>
  detectOpenDevToolsWindows(): Promise<boolean>
  resolveCdpRequestId(id: number): Promise<any>
  tagPage(page: Page): void
  getExtensionFromMimeType(mime: string): string
}
```

**依赖关系**:
- → DebuggerContext (调试器上下文)
- → SessionManager (会话管理)
- → PageCollector (页面采集器)
- → WebSocketCollector (WebSocket 采集器)
- → NetworkCollector (网络采集器)
- → ConsoleCollector (控制台采集器)

---

### 2. DebuggerManager (46 edges)

**职责**: 断点、单步调试、调用栈管理

**关键方法**:
```typescript
class DebuggerManager {
  setBreakpoint(url: string, lineNumber: number): Promise<BreakpointId>
  setBreakpointOnText(text: string): Promise<void>
  resume(): Promise<void>
  pause(): Promise<void>
  stepOver(): Promise<void>
  stepInto(): Promise<void>
  stepOut(): Promise<void>
  findUserCodeFrame(callFrame: CallFrame): CallFrame | null
}
```

**依赖关系**:
- → XHRBreakpointManager (XHR 断点)
- → EventBreakpointManager (事件断点)
- → McpContext (上下文)
- → Logger (日志)

---

### 3. Logger (46 edges)

**职责**: 统一日志系统，支持级别控制、文件输出、订阅机制

**关键方法**:
```typescript
class Logger {
  debug(message: string, ...args: any[]): void
  info(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  error(message: string, ...args: any[]): void
  success(message: string, ...args: any[]): void
  setLevel(level: LogLevel): void
  formatMessage(level: string, message: string): string
}
```

**设计模式**: 单例模式 + 观察者模式 (支持订阅)

---

### 4. CodeCollector (37 edges)

**职责**: 页面代码采集、摘要生成、差异比对

**关键方法**:
```typescript
class CodeCollector {
  collect(options: CollectOptions): Promise<CodeSummary>
  diffSummaries(before: CodeSummary, after: CodeSummary): DiffResult
  respondJson(data: any): McpResponse
}
```

**子模块**:
- CodeCache (代码缓存)
- CodeCompressor (代码压缩)
- SmartCodeCollector (智能采集)

---

### 5. Deobfuscator (30 edges)

**职责**: JavaScript 去混淆引擎

**关键方法**:
```typescript
class Deobfuscator {
  runSojsonDeobfuscation(code: string): string
  runObDeobfuscation(code: string): string
  runJSFuckDeobfuscation(code: string): string
  runAutoDeobfuscation(code: string): string
  runGeneralDeobfuscation(code: string): string
}
```

**去混淆管线**:
```
输入代码 → AST 解析 → 控制流平坦化还原 → 字符串解密 → 死代码消除
→ 未使用函数/变量移除 → 常量折叠 → 格式化输出
```

---

### 6. HookManager

**职责**: Hook 注入、采样记录、去重汇总

**关键方法**:
```typescript
class HookManager {
  injectAll(hooks: HookDefinition[]): Promise<void>
  syncHookRecordsFromPage(): Promise<HookRecord[]>
  normalizeHookRecord(record: RawRecord): HookRecord
  summarizeHookRecords(records: HookRecord[]): Summary
  inferCandidateEnvNeeds(records: HookRecord[]): EnvRequirement[]
}
```

**Hook 家族** (Hyperedge: console_protection_family):
- hookConsoleLog
- hookConsoleProtect
- hookConsoleClear
- hookConsoleTable

**Hook 家族** (Hyperedge: crypto_library_hooks):
- hookJSEncrypt
- hookCryptoJS
- hookSMCrypto

---

### 7. StealthScripts2025

**职责**: 浏览器隐身模式，绕过反自动化检测

**关键方法**:
```typescript
class StealthScripts2025 {
  injectAll(): Promise<void>
  setRealisticUserAgent(): void
}
```

**隐身能力**:
- User-Agent 模拟
- WebGL 指纹隐藏
- AudioContext 指纹隐藏
- Canvas 指纹保护
- 运行时特征隐藏

---

## 数据流与请求流

### 1. CLI → Daemon → MCP Server 三层架构

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  Claude Code │◄───────►│  js-reverse  │◄───────►│   js-reverse │
│  (MCP Client)│  MCP    │  -mcp        │  Unix   │  (CLI)       │
└──────────────┘ Protocol └──────────────┘ Socket  └──────────────┘
                                                          │
                                                          ▼
                                                   ┌──────────────┐
                                                   │   Browser    │
                                                   │  (Puppeteer) │
                                                   └──────────────┘
```

**通信协议**:
- **MCP Protocol**: JSON-RPC 2.0 over stdio
- **Unix Socket**: JSON 消息序列化 (Windows 用 named pipe)

---

### 2. MCP 请求处理链路

```
handleMCPRequest(toolName, params)
  │
  ├─► ensureToolsLoaded()          # 懒加载 60+ 工具定义
  │
  ├─► ensureBrowserConnection()    # 懒启动浏览器/连接远程 Chrome
  │
  └─► handleRequest() [MCP Router]
        │
        ├─► tools/hook/* (Hook 相关工具)
        ├─► tools/debugger/* (断点调试工具)
        ├─► tools/collector/* (采集工具)
        ├─► tools/analyzer/* (分析工具)
        ├─► tools/rebuild/* (复现工具)
        ├─► tools/crypto/* (加密检测)
        └─► tools/anti-debug/* (反调试)
              │
              ▼
        调用对应模块 (DebuggerManager, CodeCollector 等)
              │
              ▼
        浏览器操作 (Puppeteer CDP)
              │
              ▼
        返回 McpResponse (格式化响应)
```

---

### 3. 逆向工作流链路

```
Phase 1: Observe (observe-flow skill)
  list_scripts → get_script_source → find_in_script → search_in_scripts
                              │
                              ▼
Phase 2: Hook (auto-hook skill)
  create_hook → inject_hook → get_hook_data → hook_function → trace_function
                              │
                              ▼
Phase 3: Rebuild (rebuild-bundle skill)
  export_rebuild_bundle → diff_env_requirements → record_reverse_evidence
                              │
                              ▼
Phase 4: Env-Patching
  env.js (基础宿主) → polyfills.js (代理诊断层) → entry.js (入口)
                              │
                              ▼
Phase 5: Pure Extraction
  first divergence 定位 → 算法提纯 → 参数生成
```

---

## 关键设计模式

### 1. 懒加载模式 (Lazy Loading)

**应用位置**: Daemon 启动流程

```typescript
async function ensureToolsLoaded(): Promise<void> {
  if (!toolsLoaded) {
    tools = await loadAllTools()
    toolsLoaded = true
  }
}

async function ensureBrowserConnection(): Promise<void> {
  if (!browserConnected) {
    await connectToBrowser()
    browserConnected = true
  }
}
```

**优势**: 减少启动时间，按需初始化资源

---

### 2. 单例模式 (Singleton)

**应用位置**: Logger, BrowserManager, SkillRegistry

```typescript
class Logger {
  private static instance: Logger
  private constructor() {}
  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger()
    }
    return Logger.instance
  }
}
```

---

### 3. 策略模式 (Strategy)

**应用位置**: LLM Provider 选择

```typescript
interface AIProvider {
  generate(prompt: string): Promise<string>
}

class AnthropicProvider implements AIProvider { /* ... */ }
class OpenAIProvider implements AIProvider { /* ... */ }
class GeminiProvider implements AIProvider { /* ... */ }

// 通过 DEFAULT_LLM_PROVIDER 环境变量选择
```

---

### 4. 工厂模式 (Factory)

**应用位置**: LLM Provider 创建、Hook 代码生成

```typescript
function createAIService(config: AIConfig): AIProvider {
  switch (config.provider) {
    case 'anthropic': return new AnthropicProvider()
    case 'openai': return new OpenAIProvider()
    case 'gemini': return new GeminiProvider()
    default: throw new Error('Unknown provider')
  }
}
```

---

### 5. 适配器模式 (Adapter)

**应用位置**: DevTools 连接适配、缓存适配器

```typescript
// DevToolsConnectionAdapter.ts
class DevToolsConnectionAdapter {
  private connection: PuppeteerDevToolsConnection
  // 适配 Puppeteer CDP 到内部接口
}

// utils/cache-adapters/
interface CacheAdapter {
  get(key: string): Promise<any>
  set(key: string, value: any): Promise<void>
}

class CodeCacheAdapter implements CacheAdapter { /* ... */ }
class DetailedDataManagerAdapter implements CacheAdapter { /* ... */ }
```

---

## 核心依赖 (God Nodes)

| 节点 | 边数 | 说明 |
|------|------|------|
| McpContext | 56 | 全局上下文，连接所有组件 |
| DebuggerManager | 46 | 调试器管理中枢 |
| Logger | 46 | 日志系统，贯穿全局 |
| PageController | 44 | 页面控制核心 |
| CodeCollector | 37 | 代码采集器 |
| HookCodeBuilder | 35 | Hook 代码生成器 |
| McpResponse | 33 | 响应格式定义 |
| Deobfuscator | 30 | 去混淆引擎 |
| AdvancedDeobfuscator | 29 | 高级去混淆器 |
| DebuggerContext | 28 | 调试器上下文 |

---

## 社区 Hubs (Top 10)

1. **AI Continuous Debugger** - 13 节点
2. **Hook & Session Management** - 41 节点
3. **Code Analysis & AI Summary** - 23 节点
4. **Anti-Hook & Debug Utils** - 19 节点
5. **Hook Toggle & MCP Context** - 22 节点
6. **Browser & DevTools Core** - 38 节点
7. **CLI Args & Daemon Client** - 49 节点
8. **Advanced Deobfuscator** - 4 节点
9. **Cache Adapters** - 10 节点
10. **Auto Hook Skills** - 41 节点

---

## 超边 (Hyperedges) - 组关系

### 1. CLI Command Dispatch Flow
- js-reverse.ts (入口)
- cli/index.ts (模块导出)
- cli/commands/start.ts (启动命令)
- daemon/client.ts (Daemon 客户端)

### 2. Browser Connection Establishment Flow
- browser.ts/BrowserManager
- ensureBrowserLaunched()
- connectToRemoteBrowser()
- CdpSessionProvider

### 3. daemon_ipc_protocol
- daemon/client.sendCommand
- daemon/daemon.handleRequest
- daemon/daemon.startSocketServer
- daemon/types.DaemonMessage

### 4. he_deobfuscator_pipeline
- Deobfuscator
- PackerDeobfuscator
- JSVMPDeobfuscator
- AdvancedDeobfuscator
- ASTOptimizer

### 5. he_llm_dependency
- LLMService
- AISummarizer
- CodeAnalyzer
- CryptoDetector
- Deobfuscator
- AdvancedDeobfuscator

### 6. hyperedge_console_protection_family
- hookConsoleLog
- hookConsoleProtect
- hookConsoleClear
- hookConsoleTable

### 7. hyperedge_crypto_library_hooks
- hookJSEncrypt
- hookCryptoJS
- hookSMCrypto

---

## 工具层分类 (60+ 工具)

### Hook 系统 (hook/)
| 工具 | 职责 |
|------|------|
| create_hook | 创建 Hook 定义 |
| inject_hook | 注入 Hook 到页面 |
| get_hook_data | 获取 Hook 采样数据 |
| hook_function | Hook 全局函数 |
| trace_function | 函数调用追踪 |
| hookFetch | Hook Fetch API |
| hookWebSocket | Hook WebSocket |
| hookLocalStorage | Hook LocalStorage |
| hookCookie | Hook Document.cookie |
| hookXhrOpen | Hook XHR.open() |
| hookDateNow | Hook Date.now() |
| hookPromise | Hook Promise |
| hookConsoleLog | Hook console.log |
| hookConsoleProtect | Hook console 保护 |
| hookJSEncrypt | Hook JS-Encrypt |
| hookCryptoJS | Hook CryptoJS |
| hookSMCrypto | Hook SM 加密 |

### 调试系统 (debugger/)
| 工具 | 职责 |
|------|------|
| set_breakpoint | 设置断点 |
| set_breakpoint_on_text | 按文本设置断点 |
| resume | 继续执行 |
| pause | 暂停执行 |
| step_over | 单步跳过 |
| step_into | 单步进入 |
| step_out | 单步跳出 |
| break_on_xhr | XHR 断点 |

### 采集系统 (collector/)
| 工具 | 职责 |
|------|------|
| collect_code | 采集页面代码 |
| list_scripts | 列出页面脚本 |
| get_script_source | 获取脚本源码 |
| find_in_script | 脚本内搜索 |
| search_in_scripts | 多脚本搜索 |
| list_network_requests | 网络请求列表 |
| get_network_request | 单个请求详情 |
| get_request_initiator | 请求发起者追踪 |
| list_console_messages | 控制台消息 |
| get_storage | 存储读取 |

### 分析系统 (analyzer/)
| 工具 | 职责 |
|------|------|
| understand_code | 代码理解 (AI) |
| deobfuscate_code | 去混淆 |
| detect_crypto | 加密检测 |
| analyze_target | 目标分析 |
| risk_panel | 风险面板 |

### 复现系统 (rebuild/)
| 工具 | 职责 |
|------|------|
| export_rebuild_bundle | 导出复现包 |
| diff_env_requirements | 环境差异比对 |
| record_reverse_evidence | 证据记录 |

### 反调试 (anti-debug/)
| 工具 | 职责 |
|------|------|
| anti_anti_debug | 绕过反调试 |
| bypass_debugger | 绕过 debugger 语句 |

---

## 技能层 (Skills)

### 三大核心技能

#### 1. observe-flow (观察模式)
```typescript
async function observeFlow(url: string): Promise<ObserveReport> {
  // 1. 收集页面脚本
  // 2. 识别加密算法和混淆代码
  // 3. 生成安全风险评估报告
}
```

#### 2. auto-hook (自动 Hook)
```typescript
async function autoHook(url: string): Promise<HookReport> {
  // 1. 检测加密库 (CryptoJS, JSEncrypt, SM)
  // 2. 注入对应 Hook
  // 3. 记录运行时调用链
  // 4. 推断环境需求
}
```

#### 3. rebuild-bundle (本地复现)
```typescript
async function rebuildBundle(url: string): Promise<RebuildArtifact> {
  // 1. 导出 env.js, polyfills.js, entry.js
  // 2. 记录 runtime-evidence.jsonl
  // 3. 生成 run-local.mjs
}
```

---

## 服务层 (Services)

### LLMService
```typescript
class LLMService {
  private provider: AIProvider
  
  async generate(prompt: string): Promise<string>
  async analyze(code: string): Promise<AnalysisResult>
  async summarize(text: string): Promise<string>
}
```

### CryptoDetector
```typescript
class CryptoDetector {
  detectByAST(code: string): CryptoDetection[]
  detectByPattern(code: string): CryptoDetection[]
  evaluateSecurity(detection: CryptoDetection): SecurityScore
}
```

---

## 缓存架构 (Hyperedge: cache_architecture)

```
UnifiedCacheManager (单例)
  │
  ├─► CodeCacheAdapter
  ├─► CodeCompressorAdapter
  └─► DetailedDataManagerAdapter
```

---

## 序列化管线 (Hyperedge: serialization_pipeline)

```
AdaptiveDataSerializer
  │
  ├─► DataType (类型识别: Primitive/Object/Array/Function/Circular)
  ├─► SerializationContext (序列化上下文)
  └─► DetailedDataManager
        │
        ├─► safeStringify() (安全 JSON 化)
        └─► DataSummary (数据摘要)
```

---

## 扩展点

### 1. 添加新工具

```typescript
// src/tools/my-tool.ts
import { defineTool } from './ToolDefinition'

export const myTool = defineTool({
  name: 'my_tool',
  description: '工具描述',
  inputSchema: { /* JSON Schema */ },
  async execute(params, ctx) {
    // 实现逻辑
    return { content: [...] }
  }
})

// 注册到 src/tools/index.ts
```

### 2. 添加新技能

```typescript
// src/skills/my-skill.ts
export async function mySkill(url: string, options: SkillOptions) {
  // 1. 页面观察
  // 2. Hook 采样
  // 3. 证据记录
  // 4. 生成报告
}

// 注册到 src/skills/index.ts
```

### 3. 添加新 Hook 类型

```typescript
// src/tools/hook/hookMyApi.ts
export function buildHookMyApi(): string {
  return `
    (function() {
      const original = window.MyAPI.prototype.encrypt
      window.MyAPI.prototype.encrypt = function(...args) {
        console.log('[hook] MyAPI.encrypt', args)
        return original.apply(this, args)
      }
    })()
  `
}

// 注册到 src/tools/hook/index.ts
```

---

## 任务产物结构 (artifacts/tasks/)

```
artifacts/tasks/<task-id>/
├── task.json              # 任务配置
├── runtime-evidence.jsonl # 运行时证据 (JSONL)
├── network.jsonl          # 网络请求记录
├── scripts.jsonl          # 脚本采集记录
├── env/
│   ├── env.js             # 基础宿主对象
│   ├── polyfills.js       # 代理诊断层
│   ├── entry.js           # 运行入口
│   └── capture.json       # 环境捕获
├── run/
│   └── run-local.mjs      # 本地运行脚本
└── report.md              # 逆向报告
```

---

## 环境变量配置

```bash
# LLM Provider 选择
DEFAULT_LLM_PROVIDER=anthropic

# Anthropic
ANTHROPIC_API_KEY=your_key
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# OpenAI
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4o

# Gemini (支持 API + CLI 双模式)
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-2.0-flash-exp
GEMINI_CLI_PATH=gemini-cli  # 可选，无 API key 时用 CLI
```

---

## 性能指标

基于知识图谱统计:

- **代码库规模**: 181 文件 · ~149,017 词
- **图谱规模**: 1660 节点 · 3869 边 · 81 社区
- **边类型分布**:
  - EXTRACTED: 65% (直接从代码提取)
  - INFERRED: 35% (推断关系，平均置信度 0.8)
  - AMBIGUOUS: 0%
- **Token 成本**: 70,000 input · 3,300 output

---

## 已知问题与 FIXME

### FIXME

1. **src/browser.ts:321** - 日志订阅时机可能过晚 (浏览器启动后才订阅)

### TODO

1. **src/skills/observe-flow.ts:265** - 技能系统需浏览器上下文功能未完全实现

### 缺失配置

1. **Rollup 配置** - `npm run bundle` 引用 `rollup.config.mjs` 但该文件不存在
2. **CI/CD** - 文档提到 CI 流水线，但无 `.github/workflows/`

---

## 参考文档

- [逆向工作流](./reference/reverse-workflow.md)
- [补环境规范](./reference/env-patching.md)
- [任务产物说明](./reference/reverse-artifacts.md)
- [工具参数总表](./reference/tool-reference.md)
- [案例安全政策](./reference/case-safety-policy.md)

---

## 图谱导航

知识图谱输出位于 `graphify-out/`:

- `graph.html` - 交互式图谱 (浏览器打开)
- `GRAPH_REPORT.md` - 详细分析报告
- `graph.json` - 原始图谱数据
- `obsidian/` - Obsidian 笔记本 (需 `--obsidian` 参数)

**查询示例**:
```bash
/graphify query "如何处理 WebSocket 消息分组"
/graphify path "HookManager" "Deobfuscator"
/graphify explain "McpContext"
```
