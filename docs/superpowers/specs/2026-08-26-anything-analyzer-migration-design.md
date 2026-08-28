# Anything Analyzer 功能模块与架构设计迁移规范（修订版）

- **日期**：2026-08-26
- **修订日期**：2026-08-26（v2）
- **设计状态**：已批准 (Approved)，含修订 —— 见 §0 修订记录
- **文档路径**：`docs/superpowers/specs/2026-08-26-anything-analyzer-migration-design.md`
- **目标项目**：Reverser-CLI

---

## 0. 修订记录与现状对齐

本版针对初版与代码库现状的漂移做了收敛。要旨：

1. **区分「已交付（as-built）」与「待交付（to-build）」**：MITM 代理链路已落地，但命名与初版 spec 不一致，本节回填实际命名，避免实现方重复造轮子。
2. **统一工具清单**：初版在 §2 架构图、§4 模块表、§5 契约三处工具名互相矛盾，本版收敛为 §6 的单一权威清单。
3. **闭合 SQLite 驱动决策点**：初版强制 SQLite 但未定义驱动，且代码库现有持久化全部是文件 JSON，无任何 SQLite 依赖；本版给出明确选型与兼容策略。
4. **消除模块撞名与目录冲突**：`SessionManager`、`src/tools/analyzer/`、`src/modules/analyzer/` 均已存在，本版重新规划命名并用「复用映射表」明确新旧组件关系。
5. **补齐 DDL 缺失与状态机缺口**：初版架构图引用了 `storage_snapshots` 表但 DDL 未定义；`status` 缺 error/stopped 态；流式（SSE）语义缺失；`hook_type` 枚举过窄。均已修正。

---

## 1. 目标与背景

### 1.1 背景

`anything-analyzer` 是一款一体化全场景抓包与 AI 逆向分析工具，具备内嵌浏览器（CDP）与 MITM 代理双链路捕获、Preload 加密 Hook、规则场景探测、两阶段提示词提纯、代码切片提取以及桌面系统代理联动等核心能力。

`Reverser-CLI` 目前拥有深度的 Patchright 浏览器自动化、零 JS 注入反检测分层、CDP / 内存网络流分析及 MCP 服务化底座。

### 1.2 迁移目标

将 `anything-analyzer` 的全场景抓包、统一会话存储、加密 Hook 与两阶段智能分析引擎迁移并融合到 `Reverser-CLI` 中，构建**混合全功能形态**：

1. **统一数据会话（Session & 持久化）**：将 CDP 浏览器请求、MITM 代理流量、前端 JS 加密 Hook 记录及 Storage 快照统一汇聚入 Session，支持本地持久化与离线回溯。
2. **两阶段智能分析引擎（AI Engine）**：移植 `SceneDetector`、`TrafficPurifier`、`CryptoScriptExtractor` 与 `PromptBuilder`。
3. **双通道分析消费**：
   - **MCP 通道**：提供原子工具输出提纯后的场景、高价值时序与加密切片，供驱动系统的外部 AI Agent 直接消费。
   - **Web UI 通道**：在 Web 控制台提供一键会话录制、多模式流式 Markdown 报告生成与多轮追问对话框。
4. **开箱即用代理与 Hook 联动**：支持跨平台系统代理一键托管（带崩溃安全自动还原）与通用加解密 Hook 自动捕获。

---

## 2. 现状与已交付对照

> 迁移是**增量叠加**，不是从零重写。下表把初版 spec 规划项对齐到当前代码库实际状态。凡「已交付」项，后续实现必须复用现有代码，不得重建。

| 初版 spec 规划项 | 当前仓库现状 | 处置 |
| :--- | :--- | :--- |
| `src/modules/proxy/MitmProxyServer` | 已交付：`src/modules/proxy/MitmProxyServer.ts` | 复用 |
| `CaManager` | 已交付：`src/modules/proxy/CaManager.ts` | 复用 |
| MITM 门面 | 已交付：`src/modules/proxy/MitmModule.ts`（`runtime.mitmModule`，默认端口 8888） | 复用 |
| MITM 捕获存储 | 已交付但**内存环形缓冲**：`src/modules/proxy/ProxyStore.ts`（maxRecords 2000） | 复用为前端接入层；持久化走新 Session 层 |
| MITM MCP 工具 | 已交付：`src/tools/proxy/`（`start_mitm_proxy`、`stop_mitm_proxy`、`list_mitm_requests`、`get_mitm_request`、`clear_mitm_requests`、`export_mitm_ca`，domain=`proxy`，profile=`workflow`） | 复用 |
| `SystemProxyManager` / `proxy_set_system` | **未交付**（代码库无 `setSystemProxy` / `restoreSystemProxy` 痕迹） | 待交付（本版 §4.7、§7.1 明确） |
| `src/modules/session/SessionManager` | **未交付**；但已存在不同语义的 `src/modules/browser/SessionManager.ts`（浏览器上下文页面隔离） | 待交付，**改名**为 `CaptureSessionManager`（§5） |
| 统一 Session + 持久化 | **未交付**；现有 `ProxyStore` / `HookStore` 均为内存态，`ReverseTaskStore` 为文件 JSON | 待交付（§4） |
| `SceneDetector` / `TrafficPurifier` / 提纯两阶段 | **未交付**；但 `src/modules/analyzer/PatternDetector.ts` 已承担部分场景判定 | 待交付，**复用/扩展** `PatternDetector`（§5.2） |
| Web UI 会话面板 | 部分交付：`src/web-ui/` 已有 proxy 监控路由（`src/web-ui/src/routes/proxy.tsx` 等） | 扩展，不新建壳 |
| 报告生成 | 部分交付：`src/tools/analyzer/reports.ts`、`analyze_target.ts` 已具备分析+报告 | 扩展 |

---

## 3. 总体架构与数据流设计

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       1. 统一流量捕获接入层（双链路）                          │
│   ┌───────────────────────────────┐     ┌───────────────────────────────┐   │
│   │       浏览器链路 (CDP/Page)     │     │      MITM 代理链路 (Network)   │   │
│   │  • PageCollector (网络/Console)│     │  • MitmModule (已交付)         │   │
│   │  • Preload Hook (Crypto/XHR)  │     │  • CaManager (动态自签证书)    │   │
│   │  • Storage 快照 (Cookie/Local) │     │  • SystemProxyManager (系统代) │   │
│   └──────────────┬────────────────┘     └───────────────┬───────────────┘   │
└──────────────────┼──────────────────────────────────────┼───────────────────┘
                   │                                      │
                   ▼ (标准化事件 Stream)                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    2. 统一会话与持久化引擎 (CaptureSessionEngine)             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  CaptureSessionManager (activeSessionId, Sequence, 状态机)          │   │
│   │  CaptureEngine (统一解析、格式标准化、去重/截断、分发)              │   │
│   │  持久化 (sessions, captured_requests, hook_records,                 │   │
│   │          storage_snapshots, ai_reports)                            │   │
│   └──────────────────────────────────┬──────────────────────────────────┘   │
└──────────────────────────────────────┼──────────────────────────────────────┘
                                       │
                                       ▼ (查询 / 过滤 / 关联)
┌─────────────────────────────────────────────────────────────────────────────┐
│                          3. 智能分析与逆向提纯层                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  • SceneDetector (O(N) 规则场景预判: OAuth/Token/AI-SSE/Crypto/Login) │   │
│   │  • TrafficPurifier (Phase 1 降噪过滤: 剔除静态资源/探针/提取核心流)  │   │
│   │  • CryptoScriptExtractor (基于 Hook 堆栈的源码回溯定位与切片提取)    │   │
│   │  • PromptBuilder (5 种分析模式的 System/User Prompt 组装)           │   │
│   └──────────────────────────────────┬──────────────────────────────────┘   │
└──────────────────────────────────────┼──────────────────────────────────────┘
                                       │
                  ┌────────────────────┴─────────────────────┐
                  ▼                                          ▼
┌─────────────────────────────────┐      ┌─────────────────────────────────┐
│     4. MCP / CLI 暴露层          │      │     5. Web UI & 独立 LLM 分析层   │
│  • session_create / session_list│      │  • 会话管理与实时流量监控面板    │
│  • session_get_data             │      │  • Crypto/Hook 日志与堆栈树      │
│  • session_analyze_purified     │      │  • 内置 LLM 流式报告生成与追问   │
│  • session_generate_report      │      │  • 一键配置/切换系统代理与证书   │
└─────────────────────────────────┘      └─────────────────────────────────┘
```

> 工具名以 §6 为唯一权威。架构图中的 `session_switch` 由 `session_create` 直接激活新会话承担（见 §6.1），不再单列一个冗余的 switch 按钮语义。

---

## 4. 存储与持久化设计

### 4.1 驱动选型（本版闭合的决策点）

初版要求「本地 SQLite」，但未定义驱动，且与仓库现状冲突：

- `package.json` 无任何 SQLite 依赖；`src/` 全仓无 `node:sqlite` / `better-sqlite3` 使用。
- 现有持久化统一走**文件 JSON**（`src/reverse/ReverseTaskStore.ts`），`ProxyStore` / `HookStore` 均为内存环形缓冲。
- 引擎 floor（`AGENTS.md`）为 `^20.19.0 || ^22.12.0 || >=23`，而 `node:sqlite` 仅 Node ≥ 22.5 提供（实验态），Node 20.x 不可用。

**决策（D1 已定）**：持久化层抽象为 `SessionStore` 接口，首期提供**单一后端 `SqliteSessionStore`**，驱动使用 **`better-sqlite3`**（同步 API、生态成熟，**保留 Node 20.x 支持**）。代价：需新增原生编译依赖，构建/CI 需在 `npm install` 阶段预编译、或在发布镜像中内嵌 prebuilt 二进制。

> 已拍板：选 `better-sqlite3`，不做 `node:sqlite`（会把 Node 下限抬到 22.12）与文件 JSON 双后端并存——并存会引入 DRY 冲突与双份测试成本。`package.json` 需新增 `better-sqlite3` 与 `@types/better-sqlite3`。

默认数据库路径：`.cache/reverser/reverser.db`（沿用 `.cache` 现有惯例）。

### 4.2 Schema（修订）

```sql
-- 1. 会话表 (sessions)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_url TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('idle', 'capturing', 'paused', 'analyzing', 'completed', 'stopped', 'error')
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  meta TEXT
);

-- 2. 统一捕获请求表 (captured_requests)
CREATE TABLE IF NOT EXISTS captured_requests (
  id TEXT PRIMARY KEY,               -- 格式: ${sessionId}-${sequence}
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,         -- 单会话内自增序号 (1, 2, 3...)
  timestamp INTEGER NOT NULL,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('cdp', 'proxy')),
  request_headers TEXT NOT NULL,     -- JSON string
  request_body TEXT,
  status_code INTEGER DEFAULT 0,
  response_headers TEXT,             -- JSON string
  response_body TEXT,                -- 解压后的文本 (大体积做安全截断)
  content_type TEXT,
  initiator TEXT,                    -- JSON string (发起调用堆栈)
  duration_ms INTEGER DEFAULT 0,
  is_streaming INTEGER DEFAULT 0,
  is_websocket INTEGER DEFAULT 0,
  truncated INTEGER DEFAULT 0,       -- 初版缺此列，用于大包体截断标记
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, sequence)      -- 防同会话序号重号
);
CREATE INDEX IF NOT EXISTS idx_requests_session ON captured_requests(session_id, sequence);

-- 3. 前端 JS Hook 记录表 (hook_records)
--    hook_type 由 CHECK 枚举放宽为 TEXT + 应用层值域校验（见 §4.5），避免每次新增类型都改表。
CREATE TABLE IF NOT EXISTS hook_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  hook_type TEXT NOT NULL,           -- 值域: fetch|xhr|crypto|crypto_lib|cookie|storage|websocket|wasm
  function_name TEXT NOT NULL,
  arguments TEXT NOT NULL,           -- JSON string (入参，二进制以 Hex 表达)
  result TEXT,                       -- JSON string (返回值，如签名或解密结果)
  call_stack TEXT,                   -- 堆栈追踪文本
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_hooks_session ON hook_records(session_id, timestamp);

-- 4. Storage 快照表 (storage_snapshots) —— 初版架构图引用但 DDL 缺失，这里补上
CREATE TABLE IF NOT EXISTS storage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cookie', 'local', 'session')),
  origin TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,                        -- 截断/加密前体，敏感值见 §7.4
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_storage_snapshots_session ON storage_snapshots(session_id, timestamp);

-- 5. AI 报告与对话历史表 (ai_reports)
CREATE TABLE IF NOT EXISTS ai_reports (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  scene_hints TEXT,                  -- JSON string (SceneDetector 输出)
  purified_summary TEXT,             -- JSON string (Phase 1 降噪请求摘要)
  report_markdown TEXT NOT NULL,
  messages TEXT NOT NULL,            -- JSON string (多轮对话)
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

### 4.3 流式 / SSE 语义（初版缺失，补上）

`SceneDetector` 明确要识别 `AI-SSE`，`captured_requests.is_streaming` 存在但落地语义未定义。约定：

- 流式响应（SSE/`text/event-stream`/chunked）在捕获期内**按帧累积**进内存，捕获结束时落库。
- 单条流式记录优先落**帧分片表**而非无限增长的 `response_body`；首期简化：仅存 `response_body` 摘要 + `is_streaming=1`，完整帧序列走 `request_id` 关联的旁路文件（`.cache/reverser/sessions/<sessionId>/streams/`）。
- WebSocket 帧同理：不落 `response_body`，存消息计数 + 摘要（见 `is_websocket=1`）。

### 4.4 大包体截断（明确阈值与标记）

- 超过 `1 MiB` 的请求/响应体做 UTF-8 安全截断，并置 `truncated=1`。
- 二进制流（`Content-Type` 非文本）只记录 `content_type` 与 `size`，`response_body` 置空，不写无意义乱码。

### 4.5 `hook_type` 值域管理

去掉初版的硬编码 `CHECK`，改为 `TEXT` + 应用层枚举校验，值域初始为：`fetch | xhr | crypto | crypto_lib | cookie | storage | websocket | wasm`。新增类型改一处常量即可，不触发 table migration。

### 4.6 状态机

```
idle → capturing → paused ⇄ capturing
                   → analyzing → completed
                   → stopped （用户主动结束）
                   → error    （捕获/分析异常，携带 error 原因入 meta）
```

- `stopped` 与 `completed` 均为终态；`error` 为异常终态。
- 从 `capturing` 进入 `analyzing` 前必须保证本轮捕获的流式帧已 flush（§4.3）。

---

## 5. 核心子系统与模块规划

> 路径强调两点：① 与现有 `src/modules/browser/SessionManager.ts`、`src/modules/analyzer/`、`src/tools/analyzer/` 的命名/职责边界不得重叠（见 §5.2 复用映射）。② `session_*` 工具不进 `src/tools/analyzer/`（该目录已被通用分析工具占用），独立放 `src/tools/session/`。

| 目录/文件 | 核心职责 | 关键方法/组件 |
| :--- | :--- | :--- |
| `src/database/DatabaseManager.ts` | SQLite 初始化与 Schema 迁移管理（驱动 `better-sqlite3`） | `init()`, `getDb()`, `close()`, `migrate()` |
| `src/modules/session/CaptureSessionManager.ts` | 会话状态机生命周期调度（**改名**，避开 `browser/SessionManager`） | `createSession()`, `switchSession()`, `pauseCapture()`, `stopCapture()`, `getActiveSession()` |
| `src/modules/session/CaptureEngine.ts` | 多源（CDP/Proxy）流量与 Hook 事件统一聚合 | `handleRequestCaptured()`, `handleHookCaptured()`, `sendToWs()` |
| `src/modules/session/SessionStore.ts` | 持久化接口定义（§4.1 抽象） | `archiveRequest()`, `archiveHook()`, `archiveSnapshot()`, `query()` |
| `src/modules/proxy/SystemProxyManager.ts` | 跨平台系统代理设置与异常崩溃自动还原守护（**待交付**） | `setSystemProxy()`, `restoreSystemProxy()`, `registerCleanupGuards()` |
| `src/modules/hook/presets/CryptoHookScript.ts` | 前端加解密、XHR、Cookie 拦截脚本预设 | `crypto.subtle`, `CryptoJS`, `SM2/SM3/SM4`, `JSEncrypt` Hook |
| `src/modules/analyzer/ai/SceneDetector.ts` | 单次 $O(N)$ 遍历规则预判业务场景 | `detect(requests): SceneHint[]` |
| `src/modules/analyzer/ai/TrafficPurifier.ts` | Phase 1 流量清洗与降噪 | `purify(requests): FilteredRequest[]` |
| `src/modules/analyzer/ai/CryptoScriptExtractor.ts` | 根据 Hook 堆栈回溯提取脚本加密函数切片 | `extractSnippets(hooks, codeCollector): CryptoSnippet[]` |
| `src/modules/analyzer/ai/PromptBuilder.ts` | 组装 5 种预设模式的结构化提示词 | `buildPrompt(sceneHints, purified, snippets, mode)` |
| `src/tools/session/` | Session 管理与数据查询 MCP 工具 | `session_create`, `session_list`, `session_get_data` |
| `src/tools/session/` | 提纯分析与报告生成 MCP 工具 | `session_analyze_purified`, `session_generate_report` |
| `src/tools/proxy/SystemProxy.ts` | 系统代理托管工具（**待交付**，与已交付的 `src/tools/proxy/*` 同 domain） | `proxy_set_system` |
| `src/web-ui/src/` | Web 控制台 UI 界面（扩展，复用 proxy 监控路由） | 会话列表、双轨流量监控、Hook 树、AI 报告渲染与多轮追问 |

> 目录说明：初版写 `src/db/`，本版改为 `src/database/` 以对齐 `src/` 下全词命名的现有惯例（config / injects / modules / tools 均非缩写）。示例：`src/database/DatabaseManager.ts`。

### 5.1 命名消歧（必读）

- 新增的是 `CaptureSessionManager`，与现有 `src/modules/browser/SessionManager.ts`（多上下文页面隔离）**语义不同、互不复用**。导入处必须显式区分，禁止 `import {SessionManager}` 二义化。
- `session_*` 工具放 `src/tools/session/`，**不放** `src/tools/analyzer/`（已存在 `analyze_target` 等 15 个通用分析工具）。

### 5.2 新组件 ↔ 既有模块复用映射（DRY 约束）

| 新组件 | 既有可复用模块 | 关系 |
| :--- | :--- | :--- |
| `SceneDetector` | `src/modules/analyzer/PatternDetector.ts`、`PatternDetectorAuthPatterns.ts` | **扩展**：新增场景规则接入现有 Pattern 判定，不另起一套规则引擎 |
| `TrafficPurifier` | `src/trace-processing/`、`src/tools/analyzer/normalize.ts` | **复用**其静态资源/探针判定启发式 |
| `CryptoScriptExtractor` | `src/modules/crypto/`、`src/modules/deobfuscator/`、`CodeCollector` | **组合**：`CodeCollector` 取源码，`crypto/deobfuscator` 提供切片准则，叠加 Hook 堆栈回溯 |
| `session_*` 持久化 | `src/reverse/ReverseTaskStore.ts`（文件 JSON 模式） | **借鉴**其 id/时间戳/meta 约定，驱动换 SQLite |
| `ProxyStore` | （现有内存环形缓冲） | **保留**作为捕获接入层，持久化下沉到 `SessionStore`，不重写 |
| Web UI 会话面板 | `src/web-ui/src/routes/proxy.tsx` 等 | **扩展** |
| 报告生成 | `src/tools/analyzer/reports.ts`、`analyze_target.ts` | **扩展**，`session_generate_report` 的渲染复用现有 Markdown 报告管线 |

---

## 6. MCP 工具契约（唯一权威清单）

> 本清单是工具名的唯一权威；任何架构图/表格不得使用其他变体。
> - **已交付**（domain `proxy`）：`start_mitm_proxy`、`stop_mitm_proxy`、`list_mitm_requests`、`get_mitm_request`、`clear_mitm_requests`、`export_mitm_ca`。
> - **待交付**（本 spec）：`session_create`、`session_list`、`session_get_data`、`session_analyze_purified`、`session_generate_report`、`proxy_set_system`。

### 6.1 `session_create`
- **描述**：创建并激活新的抓包与逆向分析会话。**不再隐式托管系统代理**——系统代理由 `proxy_set_system` 单独控制（SRP：会话管捕获，代理管系统级网络）。
- **参数**：
  - `name` (string, required)：会话名称。
  - `targetUrl` (string, optional)：目标网页 URL。
- **返回值**：`{ sessionId: string, status: 'capturing' }`

### 6.2 `session_list`
- **描述**：列出会话及其状态（初版表格已列但 §5 缺失，补入）。
- **参数**：无。
- **返回值**：`{ sessions: Array<{ id, name, status, targetUrl, updatedAt }> }`

### 6.3 `session_get_data`
- **描述**：获取当前或指定会话的结构化请求列表、Hook 拦截日志及 Storage 快照。
- **参数**：
  - `sessionId` (string, optional)：默认当前活动会话。
  - `sources` (array of `'cdp' | 'proxy'`, optional)：来源过滤。
  - `urlFilter` (string, optional)：URL 关键字过滤。
  - `includeHooks` (boolean, optional, default: true)：是否包含加解密 Hook 日志。
  - `includeSnapshots` (boolean, optional, default: true)：是否包含 Storage 快照。
- **返回值**：`{ session: SessionDetail, requests: CapturedRequest[], hooks: HookRecord[], snapshots: StorageSnapshot[] }`

### 6.4 `session_analyze_purified`
- **描述**：执行 Phase 1 规则探测与降噪提纯，输出结构化的高价值请求、场景推断与加密代码切片，供 AI Agent 消费。
- **参数**：
  - `sessionId` (string, optional)：会话 ID。
  - `mode` (enum, optional, default `auto`)：`auto` | `api_reverse` | `security` | `perf` | `js_crypto`。
- **返回值**：
  ```json
  {
    "sceneHints": [{ "scene": "auth-token", "confidence": "high", "evidence": "Bearer Token in Auth Header" }],
    "purifiedRequests": [{ "sequence": 1, "method": "POST", "url": "...", "keyHeaders": {}, "bodyPreview": "..." }],
    "cryptoSnippets": [{ "functionName": "sign", "file": "app.js", "sourceSnippet": "..." }],
    "recommendedPrompt": "..."
  }
  ```

### 6.5 `session_generate_report`
- **描述**：基于提纯结果与选中 mode 触发 LLM 报告生成（初版表格已列但 §5 缺失，补入）。流式输出经 WebSocket 推送，返回时落库 `ai_reports`。
- **参数**：
  - `sessionId` (string, optional)：会话 ID。
  - `mode` (enum, optional, default `auto`)：同 §6.4。
- **返回值**：`{ reportId: string, reportMarkdown: string }`

### 6.6 `proxy_set_system`
- **描述**：开启或还原操作系统全局代理设置。跨平台还原机制见 §7.1。
- **参数**：
  - `enable` (boolean, required)：是否开启系统代理。
  - `port` (number, optional, default: 8888)：代理端口（与 `MitmModule.DEFAULT_PORT` 一致）。
- **返回值**：`{ success: boolean, originalProxy: string, currentProxy: string }`

---

## 7. 安全、反检测与健壮性保障

### 7.1 系统代理安全保护（Auto-Revert Guarantee）—— 跨平台具体化

> 初版只写「备份 + 信号还原」，未定义每 OS 的执行方式。本节补齐，`SystemProxyManager` 按此验收。

| 平台 | 设置方式 | 还原要点 |
| :--- | :--- | :--- |
| Windows | 注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的 `ProxyEnable` / `ProxyServer` / `AutoConfigURL`（PAC）三项 | 必须原子还原**三项**（enable + server 或 PAC），任一遗漏都会导致「代理半关」 |
| macOS | `networksetup -setwebproxy` / `-setsecurewebproxy`（按网卡） | 记录原 scope（每张活动网卡），逐网卡还原 |
| Linux (GNOME) | `gsettings set org.gnome.system.proxy mode` | 还原 `mode` 及 `http/https/socks` host/port |

通用兜底：

1. 接管前将原始设置备份写入 `.cache/system_proxy_backup.json`。
2. 注册 `process.on('SIGINT')`、`SIGTERM`、`exit` 及 `uncaughtException`，在非正常终止时**无条件原子还原**；还原失败写告警日志并尝试再次还原一次。
3. `setSystemProxy(false)` / 进程退出后做**幂等校验**：再读一次当前系统代理，若与备份不一致则记录到 stderr。

### 7.2 大包体截断与内存保护

同 §4.4：阈值 1 MiB，`truncated=1`，二进制只记元数据。

### 7.3 Preload Hook 隔离保护

页面 Hook 脚本全量包裹于 `try-catch`，序列化异常静默丢弃，严禁干扰目标站点原生 JS 执行。

### 7.4 敏感数据脱敏（本次新增）

`storage_snapshots.value` / `hook_records.arguments` / `hook_records.result` 可能含 Cookie / token / 密钥。落库前对已知敏感键（`cookie`、`token`、`authorization`、`sk-`、私钥等）做**摘要或掩码**，脱敏规则集中于单一 utils 模块，避免散落。真实证据仍按仓库约定保留在 `artifacts/tasks/<task-id>/`，`reverser.db` 不承载明文私有任务内容。

### 7.5 反检测分层契约

遵循 `AGENTS.md` 中的反检测分层（组件表见 `docs/AGENTS.md`）：浏览器链路默认最小指纹，Hook 机制作为分析增强链路按需或受控注入，**不得**在默认启动路径 eager 注入（`StealthScripts2025` 仍需 opt-in）。

---

## 8. 待拍板决策项（落地前必须关闭）

| ID | 决策项 | 现状 | 建议 |
| :-- | :-- | :-- | :-- |
| D1 | **SQLite 驱动 + Node floor** | ✅ 已定：`better-sqlite3`，保留 Node 20.x 支持 | 落地：`package.json` 增 `better-sqlite3` + `@types/better-sqlite3`，CI 配 prebuilt/预编译（§4.1） |
| D2 | `storage_snapshots` 落库粒度 | ✅ 已定：仅落「发生变更」的 key | 落地：CaptureEngine 对快照做 diff 后仅归档变更项（§4.2） |
| D3 | SSE/WebSocket 帧持久化层级 | ✅ 已定：旁路文件 | 落地：帧序列存 `.cache/reverser/sessions/<id>/streams/`，DB 只存摘要 + `is_streaming/is_websocket`（§4.3） |
| D4 | `session_create` 移除 `setSystemProxy` 参数 | ✅ 已定：移除，会话/代理解耦 | 落地：`session_create` 仅含 `name`/`targetUrl`，代理经 `proxy_set_system` 独立控制（§6.1） |
| D5 | `session_switch` 是否为独立工具 | ✅ 已定：不单列 | 落地：`session_create` 激活新会话即为「切换」；如需显式语义在 `session_list` 选结果上复开（§6.1） |

---

## 附：修订要点对照（v1 → v2）

1. 新增 §0 修订记录、§2 现状对照、§5.2 复用映射、§8 决策项。
2. 工具清单三处不一致 → 收敛为 §6 单表，删除 `session_get_requests` / `switch` 歧义名。
3. `storage_snapshots` 表补入 DDL；`captured_requests` 增加 `truncated` 列与 `UNIQUE(session_id, sequence)`。
4. `status` 增加 `paused`/`stopped`/`error`；`hook_type` 由硬 CHECK 改 TEXT + 值域。
5. SQLite 驱动选型闭合（§4.1、§8·D1）：选定 `better-sqlite3`，保留 Node 20.x 支持。
6. 模块：`src/db/` → `src/database/`；`SessionManager` → `CaptureSessionManager`；`session_*` 工具独立 `src/tools/session/`。
7. 系统代理跨平台机制补齐（§7.1）；敏感数据脱敏新增（§7.4）。
8. 文档引用 `CLAUDE.md` → `AGENTS.md`。