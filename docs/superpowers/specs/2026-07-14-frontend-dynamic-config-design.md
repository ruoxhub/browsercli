# 设计文档：取消 config.json，改为前端控制面板动态配置

- **日期**：2026-07-14
- **状态**：已与用户确认（配置范围 / 启动时机 / 持久化策略 / 环境变量去留四项决策）
- **范围**：移除 `config.json`（用户级 `~/.browsercli/config.json`、项目级 `browsercli.config.json`、根目录 `config.json`）文件加载链路，改为 Worker 进程内存态的运行时配置，由前端控制面板读取/修改。浏览器连接实例（`BrowserManager`）改为完全懒启动，由面板显式触发连接/断开。

---

## 1. 背景与目标

### 1.1 现状

- `src/config/resolver.ts` 的 `loadFullConfig()` 依次读取用户级 / 项目级 / 根目录三个 JSON 文件并合并，`resolveConfig()` 再叠加环境变量与 CLI 参数，得到最终 `ResolvedConfig`。
- `src/config/servicesConfig.ts` 的 `getBrowserManagerConfig()` 同样读 `loadFullConfig()` 取 `browser` 字段，与环境变量合并成 `BrowserManagerConfig`。
- `src/index.ts` 的 `main()` 在启动时立即调用 `resolveConfig()` → `getRuntime()`（内部触发 `getBrowserManagerConfig()`）→ `runtime.browserManager.ensureBrowser()`，浏览器连接是启动时的强制副作用，且 `options.databaseUrl` 存在时立即 `dbService.connect()`。
- LLM Provider 配置（`openai`/`gemini`/`anthropic` 的 apiKey 等）经同一份 `GlobalConfig` 文件与环境变量解析，`createAIService()` 在每次 `LLMService.chat()` 时通过 `getAIConfig()` 重新读取。
- Web 控制台（`ConsoleServer` + `src/web-ui`）目前只读展示 worker/browser 状态，没有配置编辑能力。

### 1.2 目标

1. 彻底移除 config.json 三级文件加载逻辑，配置改为进程内存态，由前端面板管理。
2. 浏览器连接参数、LLM Provider 密钥、`databaseUrl` 等全部纳入前端动态配置范围。
3. Worker 启动不再自动连接浏览器/数据库，改为面板触发的显式动作。
4. 环境变量与 CLI 参数保留作为进程启动时的初始默认值（优先级最高的“种子值”），面板可在其基础上覆盖，重启后种子值重新生效、面板覆盖丢失。

### 1.3 非目标（本设计不做）

- 不做配置的磁盘持久化（重启即丢，已与用户确认）。
- 不做多用户/多租户配置隔离。
- 不改变浏览器懒启动之外的 `BrowserManager` 内部实现（stealth、CDP 等逻辑不动）。
- 不实现配置项的加密存储（LLM key 等敏感字段仅内存持有，同现状风险级别不做额外加固，但需在 API 响应中避免回显完整 key，见 §6）。

---

## 2. 总体架构

```
┌────────────────────────────┐        REST /api/config/*        ┌──────────────────────────────┐
│  Web 控制面板 (src/web-ui)   │ ────────────────────────────────▶ │  RuntimeConfigStore (内存)     │
│  设置页：浏览器/LLM/数据库    │ ◀── GET 当前配置 ──────────────── │  seed = env + CLI args        │
└────────────────────────────┘                                    └──────────────────────────────┘
              │ POST /api/browser/connect                                     │ 读取
              │ POST /api/database/connect                                     ▼
              ▼                                                  ┌──────────────────────────────┐
┌────────────────────────────┐                                   │ BrowserManager / dbService /  │
│ BrowserConnectionManager    │ ◀── 用最新配置 (re)connect ─────── │ createAIService()            │
└────────────────────────────┘                                   └──────────────────────────────┘
```

- **RuntimeConfigStore**：新增单例，持有当前生效的 `GlobalConfig`（复用现有 zod schema `src/config/schema.ts`），提供 `get()` / `update(partial)`。启动时用 `configFromEnv()` + `parseWorkerArgs()` 的结果播种，不读任何 JSON 文件。
- **Worker 启动**：只解析 env/CLI 播种 `RuntimeConfigStore`，启动 `ConsoleServer`，**不**调用 `ensureBrowser()`、**不**自动 `dbService.connect()`。
- **面板触发连接**：新增 `POST /api/browser/connect` / `disconnect`、`POST /api/database/connect`，读取 `RuntimeConfigStore` 当前值执行实际连接动作。
- **LLM 调用**：`createAIService()` 改为读取 `RuntimeConfigStore` 而非 `getAIConfig()`（后者当前也走 `loadFullConfig()`），面板改密钥后下一次 `chat()` 立即生效。

---

## 3. 移除范围（config.json 文件链路）

| 文件 | 改动 |
|---|---|
| `src/config/resolver.ts` | 删除 `loadUserConfig` / `loadProjectConfig` / `loadRootConfig` / `readConfigFile` / `writeConfigFile` / `loadFullConfig`；`resolveConfig()` 改为只合并 `configFromEnv()` + 传入的 CLI 覆盖值 |
| `src/config/servicesConfig.ts` | `getBrowserManagerConfig()` 改为从 `RuntimeConfigStore.get().browser` 取值（不再调用 `loadFullConfig()`）；`getAIConfig()`/`createAIService()` 同样改为读 `RuntimeConfigStore` |
| `src/config/constants.ts` | 删除 `USER_CONFIG_DIR_NAME` / `USER_CONFIG_FILENAME` / `PROJECT_CONFIG_FILENAME` / `ROOT_CONFIG_FILENAME`（`DEFAULT_GROUP`、`RUNTIME_DIR_NAME`、`DEFAULT_RPC_HOST` 保留，与本次改动无关） |
| `src/services/DatabaseService.ts` | 不改动实现，仅改变调用时机（由自动连接改为面板触发，见 §5） |
| `tests/unit/utils/config.test.ts` | 删除针对文件加载/合并优先级的用例，保留/新增针对 `RuntimeConfigStore` 与 env 播种的用例 |

`browsercli/src/commands/config.ts`（独立 CLI 包里管理 `workerUrl`/`apiToken` 的本地文件）不在本次范围内 —— 它管理的是 **CLI 连哪个 Worker**，与本设计要移除的 **Worker 自身业务配置** 是两个不同的文件，且用户未要求变更 CLI 包的行为。

---

## 4. RuntimeConfigStore 设计

新文件 `src/config/RuntimeConfigStore.ts`：

```ts
class RuntimeConfigStore {
  private config: GlobalConfig;

  constructor(seed: GlobalConfig) {
    this.config = validateGlobalConfig(seed);
  }

  get(): Readonly<GlobalConfig> {
    return this.config;
  }

  update(partial: Partial<GlobalConfig>): GlobalConfig {
    this.config = validateGlobalConfig({...this.config, ...partial});
    return this.config;
  }
}

export const runtimeConfigStore = new RuntimeConfigStore(configFromEnv());
```

- 单例导出，`src/index.ts` 启动时可选地用 `parseWorkerArgs()` 解析出的 CLI 覆盖值再 `update()` 一次（CLI > env，与现有优先级一致）。
- `update()` 复用现有 `GlobalConfigSchema`/`validateGlobalConfig` 做字段校验，保证面板传入的局部更新也经过同一套 zod 规则。
- 深层字段（`browser`、`openai`、`gemini`、`anthropic`、`toolResultRecording`）在 `update()` 时做浅合并（`{...old.browser, ...partial.browser}`），避免面板只改一个浏览器字段却清空其余字段。

---

## 5. Worker 启动与浏览器/数据库连接改造

### 5.1 `src/index.ts` 改动

- 删除启动时的 `await runtime.browserManager.ensureBrowser()` 及紧随其后的 `browserContext` 获取/注入逻辑。`ToolContextProvider` 改为以未连接状态初始化（`contextProvider.init()` 内部对 `context` 为空的分支已存在，行为不变）。
- 删除 `if (options.databaseUrl) { await dbService.connect(...) }` 自动连接块。
- 其余逻辑（`ConsoleServer` 启动、信号处理）不变。

### 5.2 新增 `src/worker/BrowserConnectionManager.ts`

封装“用最新配置重新连接浏览器”的协调逻辑（不改动 `BrowserManager` 内部实现，只调用其已有的 `getInstance` / `resetInstance` / `ensureBrowser`）：

```ts
export async function connectBrowser(
  runtime: Runtime,
  contextProvider: ToolContextProvider,
  config: BrowserManagerConfig,
): Promise<void> {
  await BrowserManager.resetInstance(); // 断开旧实例（若有）
  const manager = BrowserManager.getInstance(config);
  const browser = await manager.ensureBrowser();
  const context = manager.getContext() ?? browser.contexts()[0] ?? null;
  contextProvider.setBrowserManager(manager);
  if (context) contextProvider.setContext(context);
  await contextProvider.init();
}

export async function disconnectBrowser(): Promise<void> {
  await BrowserManager.resetInstance();
}
```

- `runtime.browserManager` 目前是 `getRuntime()` 里初始化时固定的引用；`connectBrowser` 通过 `contextProvider.setBrowserManager()` 更新 `ServiceLocator`/`BrowserContextProvider` 持有的引用，保证后续工具调用拿到新实例。`getRuntime()` 返回的 `Runtime.browserManager` 字段本身在重连后指向旧实例这一点是已知细节，工具层实际交互路径都经 `contextProvider`，不直接用 `runtime.browserManager`（已用 codegraph 核实调用方）。

### 5.3 未连接状态下的工具调用行为

- `ToolPrerequisiteChecker`（`src/worker/ToolContext.ts` 相关链路)已有前置检查机制；浏览器相关工具在未连接时应返回明确错误码 `BROWSER_NOT_CONNECTED`，提示“请先在控制面板连接浏览器”，而不是抛出底层 `Browser not initialized`。具体改动点在实现阶段通过 impact 分析确认后落地，不在本设计做代码级细化。

### 5.4 数据库连接

- `POST /api/database/connect`：读取 `RuntimeConfigStore.get().databaseUrl`，调用 `dbService.connect()` + `dbService.migrate()`（复用现有方法，不改动 `DatabaseService`）。
- 依赖数据库的路由（`site-experiences`）在未连接时的行为维持现状（`dbService.getDb()` 抛 `Database not connected`），面板需展示数据库连接状态提示用户先连接。

---

## 6. 新增 REST 路由 `src/web/routes/config.ts`

挂载在现有 `ConsoleServer.setupRoutes()`，风格与 `routes/worker.ts` 一致（`Map<string, RouteHandler>` + `sendJson`/`sendError`）。

| 方法 | 路径 | 请求体 | 响应 | 说明 |
|---|---|---|---|---|
| GET | `/api/config` | — | `{browser, llmProvider, openai, gemini, anthropic, databaseUrl, ...}`（敏感字段见下） | 返回当前 `RuntimeConfigStore` 快照 |
| PUT | `/api/config/browser` | `Partial<BrowserConfig>` | 更新后的 browser 配置 | zod 校验失败返回 `400` |
| PUT | `/api/config/llm` | `{llmProvider, openai?, gemini?, anthropic?}` | 更新后的 LLM 配置 | 同上 |
| PUT | `/api/config/database` | `{databaseUrl}` | 更新后的值 | 仅更新配置，不自动连接 |
| POST | `/api/browser/connect` | — | `{connected:true, mode}` | 调用 `connectBrowser()`；失败返回 `502` + 错误详情 |
| POST | `/api/browser/disconnect` | — | `{connected:false}` | 调用 `disconnectBrowser()` |
| POST | `/api/database/connect` | — | `{connected:true}` | 调用 `dbService.connect()+migrate()`；失败 `502` |

- **敏感字段处理**：`GET /api/config` 返回 apiKey 类字段时做掩码（如 `sk-***last4`），避免明文回显已保存的 key；面板“未修改则不清空”——`PUT /api/config/llm` 若传入的 apiKey 是掩码占位符（前端不回填真实值）则保留原值不更新，只有传入非掩码新字符串才覆盖。这是本设计对“面板显示密钥”场景的既定约定，前端表单需配合处理（密钥输入框默认留空，仅填写即覆盖）。
- 连接类操作（`connect`/`disconnect`）结果通过 `WsHub.broadcast('worker.status', ...)` 现有机制推送，前端无需额外轮询即可感知状态变化（复用 `buildFullStatus()` 逻辑扩展 `browser.connected`，已有字段）。

---

## 7. 前端改动（`src/web-ui`）

- 新增导航项“连接设置”，路由 `src/web-ui/src/routes/settings.tsx`，加入 `App.tsx` 的 `<Routes>` 与侧边栏 `<nav>`。
- 页面分三个区块，复用现有卡片视觉风格（`overview.tsx` 的卡片布局）：
  1. **浏览器连接**：`headless`/`channel`/`browserURL`/`wsEndpoint`/`isolated` 等字段表单，「连接」「断开」按钮，状态徽标复用 `status.browser.connected`。
  2. **LLM Provider**：Provider 下拉（openai/gemini/anthropic）+ 对应字段（apiKey 用密码框、baseURL、model）。
  3. **数据库**：`databaseUrl` 输入 + 「连接」按钮 + 连接状态。
- 数据流：页面加载 `GET /api/config` 填充表单；「保存」调用对应 `PUT`；「连接」调用对应 `POST connect`；均通过 `src/web-ui/src/lib/api.ts` 新增方法（同现有 `api.getWorkerStatus()` 风格）。
- 不引入新的状态管理库，复用现有 `useState`/`useEffect` 模式（与 `overview.tsx`/`tools.tsx` 一致）。

---

## 8. 错误处理

| 场景 | 处理 |
|---|---|
| `PUT /api/config/*` 字段校验失败（zod） | `400` + `{error:{code:'VALIDATION', message, details}}`（复用 `formatConfigValidationError`） |
| `POST /api/browser/connect` 失败（浏览器启动/连接异常） | `502` + 错误信息；`RuntimeConfigStore` 中的配置不回滚（用户可修正后重试） |
| `POST /api/database/connect` 失败 | `502` + 错误信息，`dbService` 保持未连接 |
| 浏览器未连接时调用浏览器相关工具 | 返回 `BROWSER_NOT_CONNECTED` 业务错误（非 5xx），提示去面板连接 |
| 数据库未连接时调用站点经验相关接口 | 维持现状抛错（`Database not connected`），面板层通过状态展示提前预警 |

---

## 9. 测试策略

- **unit**：
  - `RuntimeConfigStore`：env 播种、`update()` 浅合并语义、zod 校验失败抛错。
  - `routes/config.ts`：GET 掩码逻辑、PUT 校验失败矩阵、掩码占位符不覆盖真实值的逻辑。
  - `BrowserConnectionManager`：mock `BrowserManager.getInstance`/`resetInstance`，验证 `contextProvider` 绑定顺序。
- **integration**：
  - Worker 无 env 配置启动 → `GET /api/config` 返回 schema 默认值 → `PUT` 更新 → `POST /api/browser/connect` → mock 浏览器成功连接 → `GET /api/worker/status` 的 `browser.connected` 为 `true`。
  - 未连接状态下调用浏览器工具 → 返回 `BROWSER_NOT_CONNECTED`。
- **回归**：删除 `tests/unit/utils/config.test.ts` 中针对三级文件合并优先级的用例；`tests/unit/browser/BrowserManager*.test.ts` 现有用例不受影响（`BrowserManager` 内部实现未改动）。

---

## 10. 迁移与落地顺序

1. 新增 `RuntimeConfigStore`，改造 `getBrowserManagerConfig()` / `createAIService()` 读取来源（先不删旧文件加载代码，保证可对比验证）。
2. 改造 `src/index.ts` 移除启动时自动连接浏览器/数据库。
3. 新增 `BrowserConnectionManager` + `routes/config.ts` + `POST /api/browser|database/connect|disconnect`。
4. 删除 `resolver.ts` 中的文件加载函数与 `constants.ts` 中对应常量，清理死代码引用。
5. 前端新增设置页与 API 方法。
6. 更新/删除相关测试，跑通全量测试。
7. 提交遵循 Conventional Commits；不提交任何真实 apiKey / databaseUrl。

---

## 11. 已知限制（v1 边界，不阻塞）

- 配置纯内存，Worker 重启后面板配置丢失，回落到 env/CLI 种子值（已与用户确认为期望行为）。
- 敏感字段（apiKey、databaseUrl）明文存于进程内存，未做额外加密，风险级别与现状（明文写入 config.json）相当，不在本设计范围内加固。
- 未实现多会话/多用户各自独立配置；面板配置是进程级全局态。
- `browsercli` 独立 CLI 包中管理 `workerUrl`/`apiToken` 的本地文件配置不受本设计影响。
