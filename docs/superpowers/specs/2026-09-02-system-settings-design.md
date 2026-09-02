# 系统设置模块重构设计 Spec

- **日期**：2026-09-02
- **状态**：可执行设计（已获批准，2026-09-02 经 brainstorming 四轮 AskUserQuestion 决策）
- **上游参照**：`open-source/anything-analyzer`（`src/renderer/components/SettingsModal.tsx` + `components/settings/*`）
- **目标模块**：`src/web/routes/`（后端）+ `src/web-ui/src/routes/settings.tsx`（前端）+ `src/config/`
- **前序约束**：`2026-07-14-frontend-dynamic-config-design.md`（RuntimeConfigStore 内存态 + 持久化三项白名单）

---

## 1. 背景与目标

### 1.1 现状

Web 控制台的「连接设置」页（`src/web-ui/src/routes/settings.tsx`，632 行单文件）只暴露
两个扁平区块：

- 浏览器连接：headless / channel / browserURL / wsEndpoint / executablePath / isolated
- LLM Provider：provider / apiKey / baseURL / model + 测试连接 + 获取模型列表

`GlobalConfigSchema`（`src/config/schema.ts`）中已有大量字段后端支持、UI 不可达：

- **反检测四层**：`cloak` / `jsStealth` / `fullStealthArgs` / `minimalStealth` / `useStealthScripts`
- **浏览器指纹**：`userAgent` / `viewport`
- **采集与限制**：`maxCollectedUrls` / `maxFilesPerCollect` / `maxTotalContentSize` /
  `maxSingleFileSize` / `timeout` / `waitForBrowserTimeoutMs`

且没有任何环境信息、日志、配置导入导出/重置能力。anything-analyzer 的同名模块提供了
左侧导航 + 分区组件 + 通用（版本/日志/管理工具）三个可借鉴的结构特征。

### 1.2 目标

1. 设置页从单文件扁平双区块改为「左侧导航 + 右侧分区」结构，分区拆成独立组件。
2. 补齐 schema 已有但 UI 不可达的字段，全部走现有 `/api/config/browser` 浅合并语义。
3. 新增环境信息 / 日志查看 / 配置导出·导入·重置能力。

### 1.3 非目标

- 不新增配置项（不扩 `GlobalConfigSchema` 的字段集合，只消费已有字段）。
- 不改任何默认值，尤其不动反检测四层的默认关闭语义（CLAUDE.md 硬约束）。
- 不引入前端表单库或 ConfigProvider —— 只用原生控件 + 两个 patch 回调。
- 不做前端单元测试（项目 vitest 配置不含 `web-ui`，前端无测试框架）。
- 不 spawn 任何子进程（非 Electron，无 `openExternal`）。

---

## 2. 决策纪要（已拍板）

| 议题 | 决策 |
|---|---|
| 改造范围 | C 档：结构 + 字段 + 新后端能力 |
| 导出 apiKey | 恒为掩码占位符（`sk-***1234`），复用现有 `isMaskPlaceholder()` |
| 日志能力 | 后端返回路径 + 文件列表 + 下载；不 spawn 桌面文件管理器 |
| 重置语义 | 删除缓存文件 + 回到启动种子值（`configFromEnv()` + CLI seed） |
| CLI 参数保不保 | 保 —— `ConsoleServerOptions` 新增 `configSeed`，`src/index.ts` 传入 `cliConfig` |
| 分区保存 | 每区独立保存按钮，只提交本区字段（复用 `update()` 浅合并） |
| 验证边界 | 后端 node:test 单测 + 前端 `web:typecheck` |

---

## 3. 后端设计

### 3.1 新增 `src/web/routes/system.ts`

```
createSystemRoutes(cfg: SystemRoutesConfig): Map<string, RouteHandler>
```

```ts
export interface SystemRoutesConfig {
  /** package.json 版本号；ConsoleServer 读出后注入 */
  version: string;
  /** 进程启动时间戳（ms） */
  startedAt: number;
  /** 运行时配置文件路径，默认 RUNTIME_CONFIG_PATH */
  configPath?: string;
  /** 日志目录，默认 getLogDir()。测试注入 tmpdir。 */
  logDir?: string;
}
```

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/system/info` | GET | 见 §3.2 |
| `/api/system/logs` | GET | `?file=<name>`，省略取最新。JSON 信封 `LogContent` |
| `/api/system/logs/download` | GET | `?file=<name>`。`text/plain` + `Content-Disposition: attachment`，走浏览器原生下载 |

```ts
export interface LogContent {
  fileName: string;
  content: string;
  truncated: boolean;
}
```

**读取上限（两个接口共用）**：单次最多读 1 MiB（`MAX_LOG_READ_BYTES`）的尾部内容，
超出则 `truncated: true`。日志目录会随每次启动累积文件，不加限制会让一个请求吃满
内存。download 接口同样受此上限约束 —— 它返回的不是完整原始文件（见 §8 风险 2）。

**路径穿越防御（两个接口共用）**：`path.basename(file)` → `join(logDir, base)` →
`path.relative(logDir, resolved)`，凡以 `..` 开头或为绝对路径一律 400
（`LOG_PATH_FORBIDDEN`）。与 `ConsoleServer` 静态资源分派（`:242-247`）同一套手法。

日志读取上限：单次最多读 1 MiB（`MAX_LOG_READ_BYTES`），超出按尾部截断并在响应里带
`truncated: true`。日志目录可能积累大量文件，不加限制会让一个请求吃满内存。

文件不存在 → 404 `LOG_FILE_NOT_FOUND`；日志目录不存在 → `info` 返回
`logFiles: []`（不是错误，未产生日志是正常状态）。

### 3.2 `GET /api/system/info` 响应

```ts
export interface SystemInfo {
  version: string;
  node: string;        // process.version
  platform: string;    // process.platform
  arch: string;        // process.arch
  pid: number;
  uptimeMs: number;    // Date.now() - startedAt
  logDir: string;
  logFiles: LogFileInfo[];   // mtime 倒序，最多 20 条
  configPath: string;
  configExists: boolean;
}

export interface LogFileInfo {
  name: string;
  sizeBytes: number;
  mtimeMs: number;
}
```

### 3.3 `src/utils/logger.ts` 改动（仅两处）

1. 新增导出 `getLogDir(): string`，返回 `path.join(os.homedir(), '.browsercli', 'log')`。
2. `createDefaultLogFileName()`（`:70-75`）改为 `path.join(getLogDir(), \`${datetime}.log\`)`，
   消除目录字面量重复 —— 否则前端展示的目录和实际写入的目录会各自漂移。

`getLogDir()` 不参与 `defaultLogHome` 状态判断，保持纯函数。

### 3.4 `src/config/runtimeConfigPersistence.ts` 改动

- 导出 `PERSISTED_KEYS`（现有模块私有常量，`export`/`import` 需共用同一份白名单）。
- 新增 `deleteRuntimeConfig(): void` —— `unlinkSync(RUNTIME_CONFIG_PATH)`，`ENOENT` 静默，
  其他错误 `console.error` 后继续（与 `persistRuntimeConfig` 的静默风格一致）。

### 3.5 `src/web/routes/config.ts` 追加三条路由

`ConfigRoutesConfig` 新增两个可注入字段（均为可选，现有测试不受影响）：

```ts
/** 重置时的 CLI 种子值；src/index.ts 传入 parseWorkerArgs() 结果 */
configSeed?: Partial<GlobalConfig>;
/** 删除缓存文件，默认 deleteRuntimeConfig。测试注入 no-op。 */
deleteConfig?: () => void;
```

| 接口 | 方法 | 行为 |
|---|---|---|
| `/api/config/export` | GET | 从 `store.get()` 中按 `PERSISTED_KEYS` 过滤 → `maskSensitiveFields()` → 返回。apiKey 恒掩码 |
| `/api/config/import` | POST | body 经 `GlobalConfigSchema.safeParse` 校验（失败 400 `VALIDATION`）→ 按 `PERSISTED_KEYS` 过滤 → `mergeLlmProvider()` 跳过掩码占位符 → `store.update()` → `persist()` → 返回掩码后的最新配置 |
| `/api/config/reset` | POST | `deleteConfig()` → `resetRuntimeConfigStore({...configFromEnv(), ...configSeed})` → 返回重置后配置 |

**`import` 是合并语义，不是替换。** 选定理由：替换需要给 `RuntimeConfigStore` 新增
`replace()` 方法（新代码 + 新语义）；合并直接复用现有 `update()` 的 `DEEP_MERGE_KEYS`
浅合并，零新语义。已知代价：跨版本导入时，导出文件中没有的字段会保留当前值 —— 而
导出文件总是包含完整的 `PERSISTED_KEYS` 三项，该角只在跨版本导入时命中。

### 3.6 `ConsoleServerOptions` + `src/index.ts`

- `ConsoleServerOptions` 新增 `configSeed?: Partial<GlobalConfig>`。
- `ConsoleServer` 在 `setupRoutes()` 里透传给 `createConfigRoutes`。
- `src/index.ts` 构造 `ConsoleServer` 时补一行 `configSeed: cliConfig`（`:117-127` 的
  构造参数块）。`cliConfig` 是 `parseWorkerArgs(process.argv.slice(2))` 的返回值，
  `main()` 作用域内已可用。

`resetRuntimeConfigStore` 从 `RuntimeConfigStore.js` 导入到 `config.ts` 路由。

---

## 4. 前端设计

### 4.1 文件结构

沿用 `src/web-ui/src/components/proxy/` 的既有组织模式：

```
src/web-ui/src/routes/settings.tsx                 ← 瘦身为 shell：左侧导航 + 右侧渲染
src/web-ui/src/components/settings/
  Field.tsx              ← Field 组件 + inputClass / labelClass 共享 className
  GeneralSection.tsx
  BrowserSection.tsx
  AntiDetectSection.tsx
  LlmSection.tsx
  CollectionSection.tsx
```

`App.tsx` 的 `import SettingsPage from './routes/settings'` **无需改动**。

### 4.2 shell 职责

`settings.tsx` 保留：一次 `api.getConfig()` 拉取、一次 `api.getWorkerStatus()` +
`wsClient.subscribe('worker.status')` 订阅连接状态、`error` 条、以及 5 个分区的
懒挂载（导航切换时才渲染对应分区）。

向下传两个回调，这是消除重复的关键 —— 现状每个字段都手写一遍
`setConfig(prev => ({...prev, browser: {...prev.browser, x: v}}))`，5 个分区会让这段
样板复制几十遍：

```ts
patchBrowser: (patch: Partial<BrowserConfig>) => void
patchRoot:    (patch: Partial<RuntimeConfig>) => void
```

`Field.tsx` 只导出 `Field`（label + hint 包装）与 `inputClass` / `labelClass` 两个
className 常量，输入控件仍是原生 `<input>` / `<select>` —— 不造 Input/Select/Switch
四个包装组件，不引入表单库。

### 4.3 分区与字段

| 分区 | 字段 | 保存目标 |
|---|---|---|
| 通用 | 版本 / Node / 平台 / 架构 / PID / uptime、配置路径 + 文件是否存在、日志目录路径 + 复制按钮、日志文件列表（名称/大小/时间）+ 下载、导出配置 / 导入配置 / 重置配置 | — |
| 浏览器连接 | headless、channel、browserURL、wsEndpoint、executablePath、isolated；顶部连接状态徽标 + 连接/断开按钮 | `PUT /api/config/browser` |
| 反检测 | cloak、jsStealth、fullStealthArgs、minimalStealth、useStealthScripts、userAgent、viewport（宽 × 高） | `PUT /api/config/browser` |
| LLM Provider | provider、apiKey、baseURL、model；获取模型列表 + 测试连接 | `PUT /api/config/llm` |
| 采集与限制 | maxCollectedUrls、maxFilesPerCollect、maxTotalContentSize、maxSingleFileSize、timeout、waitForBrowserTimeoutMs | `PUT /api/config/browser` |

**viewport 的「未设置」处理**：schema 里 `viewport` 是 `{width, height}` 正整数，
无 null 分支。UI 上空字符串视为「不提交该字段」—— 两个数字框任一为空，整个
`viewport` 不进 patch。这是 UI 层特判，不动 schema。

**反检测分区字段全部默认关闭**（`cloak` / `jsStealth` / `fullStealthArgs` /
`useStealthScripts`），每项带 tooltip 说明其检测面代价。CLAUDE.md 的反检测分层
硬约束不在本次改动范围内，UI 只暴露开关、不改任何默认值。

### 4.4 协议与 API 客户端

- `src/web/types.ts` 新增 `SystemInfo` / `LogFileInfo` / `LogContent` / `ExportedConfig`。
  `src/web-ui/src/lib/protocol.ts` 已 `export * from '../../../web/types.js'`，前端
  自动可见，无需双源维护。
- `src/web-ui/src/lib/api.ts` 按现有 proxy 模块的写法补 6 个方法：
  `getSystemInfo()` / `getSystemLog(file?)` / `exportConfig()` / `importConfig(cfg)` /
  `resetConfig()`。下载不走 `api.ts` —— 直接用 `<a href="/api/system/logs/download?file=...">`
  触发浏览器原生下载（与 `CaCertModal` 的证书下载一致）。

---

## 5. 数据流

```
设置页 shell
  ├─ GET /api/config          → RuntimeConfig（敏感字段已掩码）
  ├─ GET /api/system/info     → SystemInfo（版本/环境/日志目录/配置路径）
  └─ ws: worker.status        → browser.connected 徽标

分区保存（每区独立）
  ├─ PUT /api/config/browser  → store.update({browser: patch})  浅合并
  ├─ PUT /api/config/llm      → store.update({openai, llmProvider}) 跳过掩码占位符
  └─ persist()                → ~/.browsercli/runtime-config.json

通用区动作
  ├─ GET  /api/config/export  → 掩码 JSON → Blob 下载
  ├─ POST /api/config/import  → 校验 + 白名单过滤 + 合并 + 落盘
  └─ POST /api/config/reset   → 删文件 + resetRuntimeConfigStore(env + CLI seed)
```

---

## 6. 错误处理约定

| 场景 | code | HTTP |
|---|---|---|
| 日志文件路径穿越 | `LOG_PATH_FORBIDDEN` | 400 |
| 日志文件不存在 | `LOG_FILE_NOT_FOUND` | 404 |
| 日志目录读取失败 | `LOG_DIR_READ_FAILED` | 500 |
| 日志文件读取失败 | `LOG_FILE_READ_FAILED` | 500 |
| 导入 payload 非法 JSON | `INVALID_JSON` | 400 |
| 导入 payload 校验失败 | `VALIDATION` | 400 |

全部经 `sendError()`（`src/web/middleware/error.js`）返回统一信封，与
`config.ts` 现有路由一致。

---

## 7. 测试计划

| 文件 | 新增用例 |
|---|---|
| `tests/unit/web/routes/system.test.ts`（新） | info 字段齐全且 `logFiles` 按 mtime 倒序；日志目录不存在时 `logFiles: []`；路径穿越（`../`、绝对路径）被拒；正常读取返回内容；文件不存在 404 |
| `tests/unit/web/routes/config.test.ts` | export 只含 `PERSISTED_KEYS` 三项且 apiKey 掩码；import 与现有值合并（非替换）；import 遇掩码占位符保留真值；import 非法 payload 400；import 后调用 `persist`；reset 删缓存文件 + 回到 `configFromEnv()` + `configSeed` 合并结果 |
| `tests/unit/config/runtimeConfigPersistence.test.ts` | `deleteRuntimeConfig()` 删除已存在文件；文件不存在时不抛 |

测试注入约定沿用 `config.test.ts` 现状：`persist` 注入 no-op 避免污染
`~/.browsercli/runtime-config.json`；`system.ts` 的 `logDir` 注入 `node:os.tmpdir()`
下的临时目录，`after` 中清理。

**验证命令（收尾必跑）**：

```
npm run typecheck && npm run web:typecheck && npm run test:unit && npm run check-format
```

---

## 8. 风险与已知取舍

1. **import 合并 vs 替换**（§3.5）—— 选定合并以复用 `update()`。跨版本导入时旧文件
   缺失的字段保留当前值。
2. **日志读取 1 MiB 上限**（§3.1）—— 大日志文件尾部截断。若后续需要完整导出，
   改为流式 `createReadStream().pipe(res)`（download 接口本就该这么做，当前按
   readFile 处理以保持与 `logs` 接口一致的截断语义）。
3. **`configSeed` 只覆盖 `parseWorkerArgs()` 认识的 flag**（`WorkerArgs.ts` 的
   `BOOLEAN_FLAGS` / `VALUE_FLAGS` 两张表）。未登记的 CLI 参数不会出现在种子值里，
   重置后丢失 —— 与启动时 `update(cliConfig)` 的行为一致，不算回归。
4. **apiKey 掩码导出使导出文件不可用于迁移**（用户已在决策中选 A）。需要迁移时
   手动填一次 key，或直接复制 `~/.browsercli/runtime-config.json`。
