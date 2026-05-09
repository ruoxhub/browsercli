---
name: jsreverser-toolkit
description: JSReverser CLI 工具导航与选择指南。在需要查询 js-reverse 可用的 161 个 MCP 工具、选择合适的工具组合完成逆向任务、理解工具分类与参数时使用。涵盖观察取证、Hook 注入、调试器、代码分析、反调试、加密库拦截、Wasm 逆向、本地复现等全部功能域。当用户提到 js-reverse 工具、需要知道某个逆向操作该用哪个工具、或在 JSReverser-CLI 上下文中需要工具选型指导时触发。
---

# JSReverser Toolkit — 工具导航

## 工具总览

js-reverse 提供 161 个 MCP 工具，按 26 个功能域组织：

| 域 | 工具数 | 核心用途 |
|----|--------|---------|
| Workflow | 5 | 端到端自动化（observe_flow, auto_hook, rebuild_bundle, analyze_target, trace_signature_generation） |
| DOM | 3 | 元素查询与结构分析 |
| Network | 2 | HTTP 请求监控与详情 |
| Input | 9 | 用户交互模拟（点击/输入/拖拽/上传） |
| Page | 12 | 页面操作与会话管理 |
| Navigation | 4 | 页面切换与导航 |
| Debugger | 22 | 断点/步进/脚本/调用栈/暂停态检查 |
| Hook | 28 | 通用 Hook 管理 + 专项 Hook（XHR/Fetch/Cookie/WebSocket/Storage/时间/控制台） |
| Anti-Debug | 2 | 一键反调试 + debugger 绕过 |
| Crypto | 3 | 加密库 Hook（CryptoJS/JSEncrypt/SMCrypto） |
| Analyzer | 7 | 代码分析/去混淆/加密检测/风险评估 |
| Collector | 3 | 代码收集/差异/搜索 |
| Rebuild | 2 | 本地复现导出/环境差异对比 |
| Wasm | 9 | Wasm 模块分析/反编译/离线执行 |
| Stealth | 4 | 反检测注入 |
| Vue | 3 | Vue.js DevTools/路由/守卫 |
| VJSTools | 5 | AST 去混淆/转译/差异 |
| Emulation | 4 | 设备/网络/CPU 模拟 |
| WebSocket | 4 | WS 连接监控与消息分析 |

完整工具清单与参数：`references/tool-catalog.md`

## CLI 命令

`js-reverse` 提供以下 CLI 命令，覆盖从启动服务到工具调用的完整流程：

### start — 启动 Worker

```bash
js-reverse start [--browserUrl <url>] [--wsEndpoint <endpoint>] \
  [--rpcHost <host>] [--group <name>] \
  [--headless] [--wait-for-browser] [--executablePath <path>] [--databaseUrl <url>]
```

- 启动 Worker 进程并注册到 Sekiro Server
- `--browserUrl`：Chrome DevTools Protocol 地址（如 `http://127.0.0.1:9222`）
- `--wsEndpoint`：WebSocket 端点（CDP 直连模式）
- `--headless`：无头模式启动浏览器
- `--wait-for-browser`：阻塞等待浏览器可达后再继续
- 首次使用流程：启动 Chrome（`--remote-debugging-port=9222`）→ 启动 rpc-go Server → `js-reverse start --browserUrl http://127.0.0.1:9222`

### stop — 停止 Worker

```bash
js-reverse stop
```

停止当前运行的 Worker 进程。

### status — 查看状态

```bash
js-reverse status
```

查看 Worker 运行状态和 Sekiro Server 连接信息。

### call — 调用 MCP 工具

```bash
js-reverse call <tool-name> [--param value] [--url <url>] [--data <json>]
```

- 直接从命令行调用任意 MCP 工具
- 工具名支持连字符自动转下划线（`observe-flow` → `observe_flow`）
- 输入错误工具名时会返回模糊匹配建议
- 示例：`js-reverse call hook_fetch --url https://example.com`

### list-tools — 列出工具

```bash
js-reverse list-tools [--json]
```

列出所有可用的 MCP 工具名称及描述，`--json` 输出 JSON 格式。

### config — 配置管理

```bash
js-reverse config [--init] [--set key=value] [--get key] [--unset key] [--list]
```

- 无参数：显示当前生效的完整配置
- `--init`：初始化用户级配置文件
- `--set key=value`：设置配置项（如 `--set rpcHost=ws://127.0.0.1:5612`）
- `--get key`：获取单个配置项
- `--unset key`：删除配置项
- `--list`：列出配置文件路径和来源
- 支持嵌套键：`openai.apiKey`、`browser.headless` 等

### repl — 交互模式

```bash
js-reverse repl
```

进入交互式 REPL，支持 Tab 补全工具名。内置命令：

| 命令 | 作用 |
|------|------|
| `tool <name> [args...]` | 调用指定工具 |
| `status` | 查看 Worker 状态 |
| `list-tools` | 列出可用工具 |
| `help` | 显示帮助 |
| `exit` / `quit` | 退出 REPL |

### scaffold — 任务脚手架

```bash
js-reverse scaffold --name <name> [--desc <desc>] [--url <url>] [--output <dir>]
```

- 创建逆向任务目录，包含 `config.json`、`README.md`、`hook.js`、`bundle.js` 模板
- `--name` 必填，格式：小写字母开头，仅含小写字母/数字/连字符（如 `jd-h5st`）
- `--output` 指定输出目录，默认在当前目录下创建 `tasks/<name>/`

## 快速选型

### 按场景选工具

详见 `references/decision-guide.md`，核心决策路径：

1. **定位签名参数**：`analyze_target` 一键 → 或手动 `collect_code` → `list_network_requests` → `hook_fetch`/`hook_xhr_open` → `trace_function` → `get_script_source`
2. **反调试对抗**：`anti_anti_debug` 一键 → 或按类型选 `bypass_debugger`/`hook_date_now`/`hook_console_clear`/`inject_stealth`
3. **本地复现**：`observe_flow` → `auto_hook` → `record_reverse_evidence` → `export_rebuild_bundle` → `diff_env_requirements`
4. **代码去混淆**：`deobfuscate_code_vj`（AST）/ `deobfuscate_code`（AI）/ `understand_code`
5. **WebSocket 逆向**：`list_websocket_connections` → `analyze_websocket_messages` → `get_websocket_messages`
6. **Wasm 逆向**：`wasm_capabilities` → `wasm_dump` → `wasm_inspect_sections` → `wasm_decompile`

### Hook vs 断点决策

| 需要 | 选 | 不选 |
|------|----|------|
| 参数/返回值 | `hook_function` / `trace_function` | 断点 |
| 局部变量 | `set_breakpoint_on_text` + `inspect_locals` | Hook |
| 不知函数名 | `hook_fetch` / `hook_xhr_open` | 断点 |
| 自动化流程 | Hook（不暂停） | 断点（需协调暂停/恢复） |


## 核心原则

- **Observe-first**：先 `collect_code`/`list_network_requests`，再 Hook
- **Hook-preferred**：`hook_function`/`trace_function` 优先于断点
- **Breakpoint-last**：仅在需要检查局部变量时使用断点
- **Rebuild-oriented**：先 `observe_flow` → `auto_hook` → `record_reverse_evidence` → `export_rebuild_bundle` → `diff_env_requirements`
- **Evidence-first**：所有重要步骤用 `record_reverse_evidence` 记录

## 目标场景

默认主场景是：

1. 定位接口签名、加密参数、关键请求字段
2. 在页面里确认哪个请求、哪个脚本、哪个函数参与参数生成
3. 导出本地复现材料
4. 在 Node 里按“代理 env log + first divergence + 最小因果单元”补环境跑通
5. 跑通后再做 AST 去混淆、VMP 插桩或逻辑提纯

## 五阶段工作流

### 1. Observe

目标：

- 先确认目标请求、相关脚本、候选函数，不猜环境。

默认入口：

- `references/automation-entry.md`
- `references/mcp-task-template.md`

必须产出：

- 目标请求
- initiator 线索
- 可疑脚本 URL / scriptId
- 初始 task artifact

### 2. Capture

目标：

- 对目标请求做最小侵入采样，拿到参数样例、调用顺序、运行时证据。

规则：

- 优先 fetch/xhr hook
- 如果目标发生在首屏初始化、首个请求前参数装配、页面首次执行阶段，先用 `inject_preload_script` 挂早期采样或补环境脚本
- 命中后先看 summary，再按需看 raw
- Hook 不足时再考虑断点

### 3. Rebuild

目标：

- 把页面证据导出为本地可迭代的 Node 复现工程。

参考：

- `references/local-rebuild.md`
- `references/task-artifacts.md`

规则：

- 本地补环境必须以页面观测证据为依据
- 不允许空想式补 `window/document/navigator/crypto/storage`

### 4. Patch

目标：

- 按代理日志和 `first divergence` 驱动补环境，直到本地脚本能稳定跑出目标参数。

规则：

- 先读代理 env log，再记录当前 `first divergence`
- 一次只做一个补丁决策，不是机械地一次只改一个属性
- 一个补丁决策对应一个最小因果单元：值 / 函数壳 / 返回对象 / 最小对象契约
- `diff_env_requirements` 仅作辅助，不替代代理日志
- 每次补丁后立即复测，并记录 `first divergence` 是否前移
- 每次补丁都写入 task artifact

### 5. DeepDive

目标：

- 本地跑通后，再做去混淆、VMP、控制流还原、业务逻辑提纯。

规则：

- 如果当前任务只是出签名，这一阶段可以降级
- 如果要长期复用算法链路，这一阶段必须做

## 执行要求

- 所有重要步骤都要写入本地 task artifact
- 如果无法解释为什么调用某个工具，就不要调用
- 输出必须满足 `references/output-contract.md`
- 失败时按照 `references/fallbacks.md` 回退
- 参数默认值按 `references/tool-defaults.md`
- `skills/references/cases/*` 只允许抽象 case（映射/判定口径）
- 站点级可复用流程统一维护在 `scripts/cases/*`，不要把实操工作流写回 `skills/references/cases/*`
- 新增正式文档时遵循仓库分层：规则/模板放 `docs/reference/`，人类教程放 `docs/guides/`，公开参数索引更新 `scripts/cases/README.md`

## 必读引用

- 自动化入口：`references/automation-entry.md`
- 参数默认值：`references/tool-defaults.md`
- 任务输入模板：`references/task-input-template.md`
- CLI专用任务编排：`references/cli-task-template.md`
- 任务产物：`references/task-artifacts.md`
- 本地复现：`references/local-rebuild.md`
- 补环境：`references/env-patching.md`、`references/node-env-rebuild.md`
- 插桩：`references/instrumentation.md`
- AST 去混淆：`references/ast-deobfuscation.md`
- 回退：`references/fallbacks.md`
- 输出契约：`references/output-contract.md`
- 案例库：`references/cases/`

## 配套模板

- 更新提示词：`docs/reference/reverse-update-prompt-template.md`
- 报告模板：`docs/reference/reverse-report-template.md`
- 算法升级 / first divergence：`docs/reference/algorithm-upgrade-template.md`
