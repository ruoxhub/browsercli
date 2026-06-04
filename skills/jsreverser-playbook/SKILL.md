---
name: jsreverser-playbook
description: JSReverser CLI 工具导航与选择指南。当用户提到 js-reverse / js-reverse-mcp 工具、需要查询可用工具列表（135 个 MCP 工具）、为逆向任务选择工具组合、理解工具分类与参数时触发。涵盖 25 个功能域：观察取证、Hook 注入、调试器、代码分析、反调试、加密库拦截、Wasm 逆向、本地复现、WebSocket / Console / Stealth / Emulation 等。场景包含：定位签名/加密参数、反调试对抗、AST 去混淆、WebSocket 协议逆向、Wasm 二进制分析、Node 本地补环境复现、Hook/Breakpoint 选型决策。
---

# JSReverser playbook — 工具导航

## 何时触发

满足以下任一条件时，本 skill 优先加载：

- 用户提到 `js-reverse` / `js-reverse-mcp` / `jsreverser` / 工具名（如 `hook_function` / `analyze_target` / `export_rebuild_bundle`）
- 用户问"这些工具怎么用"、"该用哪个工具"、"先做哪一步"
- 用户开始新逆向任务、问"如何定位签名"、"如何补环境"
- 需要决定 Hook vs 断点、Observe vs Capture、Rebuild vs PureExtraction

如果只是问"JSReverser-CLI 项目怎么用"或"怎么构建/发布",应直接读 `README.md` / `AGENTS.md`,不触发本 skill。

---

## 工具总览（135 个 MCP 工具，25 个功能域）

| 域 | 工具数 | 域 | 工具数 |
|----|--------|----|--------|
| Workflow（端到端自动化） | 6 | Dialog / Frames | 3 |
| DOM 操作 | 3 | Script 执行 | 2 |
| Network 请求 | 2 | Site Experience CRUD | 5 |
| Input 交互 | 9 | Extensions | 1 |
| Page 操作 | 11 | Analyzer（代码分析） | 7 |
| Navigation 导航 | 4 | Collector（代码采集） | 3 |
| Screenshot / Video | 4 | Rebuild（本地复现） | 2 |
| Emulation 仿真 | 4 | Anti-Debug | 2 |
| Stealth 反检测 | 4 | Crypto 库 Hook | 3 |
| Performance 性能 | 4 | Wasm | 9 |
| Debugger（断点/步进/脚本/暂停态） | 31 | Code Templates | 3 |
| Hook 系统 | 6 | WebSocket | 4 |
| Console | 2 | — | — |

完整参数：`references/tool-catalog.md`。
权威 schema：`js-reverse list-tools --json`（任何文档与 list-tools 冲突时，以 list-tools 为准）。

> **Profile 提示**（按 `JS_REVERSE_TOOL_PROFILE` 切换）：
> - `search` — 仅 `search_tools`（1 工具），给上下文极紧的 LLM 宿主按需发现工具
> - `workflow` — `search` + 日常逆向（≈87 工具：Observe/Capture/Network/Hook/Analyzer/WebSocket/Console/Stealth/Emulation/Site Experience 等）
> - `full` — `workflow` + 全量逆向（135 工具；额外含 Debugger / Wasm / Anti-Debug / Performance / Rebuild）
>
> 完整对照 + 启动 / 切换 / 错误处理：`references/profile-tool-gating.md`。

---

## CLI 命令速查

```bash
# 服务端命令
js-reverse start [--browserUrl <url>] [--headless]
js-reverse stop
js-reverse status
js-reverse config [--init|--list|--set k=v|--get k|--unset k]

# 工具调用
js-reverse call <tool> [--param value]... [--file <params.json>]
js-reverse list-tools [--json]            # 权威工具清单
js-reverse search-tools <query>           # 在 search profile 下发现工具

# 交互 / 脚手架
js-reverse repl                           # Tab 补全的交互 REPL
js-reverse scaffold --name <slug> --url <url>  # 创建任务目录
```

- 工具名连字符↔下划线自动转换：`observe-flow` ⇄ `observe_flow`
- 错误工具名返回模糊匹配建议
- 复杂参数用 `--file params.json` 避免 PowerShell/bash 转义
- 详见 `references/cli-task-template.md`

---

## 核心原则（Doctrines）

1. **Observe-first**：先 `collect_code` / `list_network_requests`，再 Hook
2. **Hook-preferred**：`hook_function` / `trace_function` / `create_hook --type <t>` 优先于断点
3. **Breakpoint-last**：仅在需要 `inspect_locals` 时使用断点
4. **Rebuild-oriented**：`observe_flow` → `auto_hook` → `record_reverse_evidence` → `export_rebuild_bundle` → `diff_env_requirements`
5. **Evidence-first**：每一步用 `record_reverse_evidence` 写入 task artifact
6. **PureExtraction-after-pass**：`env rebuild` 未跑通且服务端未验收通过前，不进入纯算法提纯

---

## 六阶段工作流（与 `docs/reference/reverse-workflow.md` 对齐）

| 阶段 | 目标 | 默认入口工具 | 禁止事项 |
|------|------|------------|---------|
| **Observe** | 确认目标请求、脚本、函数、触发动作 | `analyze_target` / `collect_code` / `list_network_requests` / `search_in_scripts` | 还没确认目标请求就开始补环境 |
| **Capture** | 最小侵入采样，拿到参数样例、调用顺序 | `create_hook` + `inject_hook`（优先 fetch/xhr/timer）/ `inject_preload_script`（首屏逻辑） | hook 不足就立刻切断点 |
| **Rebuild** | 把页面证据导出为本地可迭代的 Node 工程 | `export_rebuild_bundle` → 运行 `env/entry.js` | 没有页面证据就手写 `window/document/navigator` |
| **Patch** | 按 `first divergence` + 代理 env log 逐项补环境 | `diff_env_requirements`（仅辅助）→ 手动补丁 → 复测 | 没有代理日志就补宿主 |
| **PureExtraction** | env-pass 后，分离环境噪音与算法输入 | `deobfuscate_code` / `understand_code` / `summarize_code` / `detect_crypto` | env rebuild 没通过就开始翻 Python |
| **Port** | 把已稳定 Node pure 迁移到 Python / 其他宿主 | 手工迁移 + 同 fixture 比对 | 跳过 Node pure 直接写 Python pure |

> 五阶段 → 六阶段的演进：原 SKILL.md 把 "DeepDive" 单独列为第 5 阶段；现在把"纯算法提纯"和"宿主迁移"拆开，让边界更清晰。文档不再使用 "DeepDive" 这个词，改用 `PureExtraction` + `Port`。

完整阶段协议：`docs/reference/reverse-workflow.md`（这是仓库里唯一权威的阶段文档，本 skill 不重复定义）。

---

## 快速选型（按场景 → 工具组合）

### 场景 1：定位签名/加密参数

**一键**：`analyze_target --url <url> --autoInjectHooks true`

**手动**（按顺序）：
1. `collect_code --url <url> --smartMode priority`（仅优先脚本）
2. `list_network_requests --headerFilter "sign"` → `get_network_request --reqid <id>`
3. `get_request_initiator --requestId <id>`（找 JS 调用栈）
4. Hook 关键 API（`create_hook --type fetch|xhr` 或专项 `hook_cryptojs`）
5. `trace_function --target <name>` 或 `hook_function --target <name>`
6. `list_scripts` → `get_script_source` / `search_in_sources --query <token>`

### 场景 2：反调试对抗

**一键**：`anti_anti_debug`（固定窗口/冻结时间/拦截跳转/屏蔽 webdriver 全套）

**针对性**：详见 `references/decision-guide.md` 决策树 + `references/hook-patterns.md` create_hook 类型映射

### 场景 3：本地 Node 复现

1. `observe_flow --url <url>` → `auto_hook --url <url> --exportResults true`
2. `record_reverse_evidence --taskId <id> --taskSlug <slug> --targetUrl <url> --goal <goal>`
3. `export_rebuild_bundle --taskId <id> --taskSlug <slug> --targetUrl <url> --goal <goal>`
4. 本地跑 `env/entry.js`，读代理 env log，记录 `first divergence`
5. 按最小因果单元补丁 → 复测 → 循环

### 场景 4：代码去混淆

| 目标 | 工具 |
|------|------|
| 字符串表 + 索引函数（`_0x***`） | `deobfuscate_code --code <c> --aggressive true --renameVariables true` |
| 理解结构/业务/安全 | `understand_code --code <c> --focus security` |
| 文件/项目级摘要 | `summarize_code --code <c>` 或 `--url <repoUrl>` |
| 检测加密算法 | `detect_crypto --code <c> --useAI true` |
| 综合风险评分 | `risk_panel --code <c> --includeHookSignals true --hookId <id>` |

> AST pass 顺序：`references/ast-deobfuscation.md`（常量传播 → 字符串表 → 控制流 → 死代码）

### 场景 5：WebSocket 协议逆向

1. `list_websocket_connections`
2. **`analyze_websocket_messages --wsid <id>`（必做，二进制/protobuf 必须先看分组）**
3. `get_websocket_messages --wsid <id> --groupId <g>`（按类型过滤）
4. `get_websocket_message --wsid <id> --frameIndex <idx>`（单条下钻）
5. 若需拦截发送：`create_hook --type websocket` + `inject_hook --persistent true`

详见 `references/websocket-reverse.md`。

### 场景 6：Wasm 逆向

1. `wasm_capabilities`（检测本地工具链：wabt / binaryen / wasmtime / wasmer）
2. `wasm_dump --moduleIndex 0 --outputPath ./target.wasm`
3. `wasm_inspect_sections --inputPath ./target.wasm --includeStringScan true --maskSensitiveStrings true`
4. `wasm_decompile --inputPath ./target.wasm --inlineExport true`（推荐，函数摘要+可疑模式）
   或 `wasm_disassemble --inputPath ./target.wasm`（WAT 格式）
5. `wasm_offline_run --inputPath ./target.wasm --functionName <name> --args <json>`
6. 运行时：`wasm_vmp_trace`（VMP 事件追踪） / `wasm_memory_inspect`（Memory 检查）

详见 `references/wasm-reverse.md`。

### 场景 7：Stealth / 设备模拟

| 目标 | 工具 |
|------|------|
| 隐藏 webdriver / canvas 噪声 | `inject_stealth --preset <name>`（先 `list_stealth_presets` 看选项） |
| 自定义 UA | `set_user_agent --userAgent <ua>` |
| 移动端 UA + 视口 + 触摸 | `emulate_mobile --enable true --device "iPhone 14"` |
| 网络限速 / 离线 | `emulate_network --throttlingOption Slow 3G` |
| CPU 节流（复现弱机） | `emulate_cpu --throttlingRate 4` |
| 自定义视口 | `resize_page --width 375 --height 812` |

详见 `references/stealth-emulation.md`。

### 场景 8：Console 日志取证

`list_console_messages --type error|warning|log --pageSize 100`（按页翻）
`get_console_message --msgid <id>`（单条详细）

注意：Console 是当前唯一可回溯 page 历史的取证维度，常用于：
- 找错误堆栈（`--type error`）→ 间接定位混淆函数
- 找 `console.log('sign:', ...)` 等显式打印
- 在断点循环时验证 `resume` 是否真的执行

---

## Hook vs 断点决策（精简版）

| 需求 | 选 | 不选 | 原因 |
|------|----|------|------|
| 参数/返回值 | `hook_function` / `trace_function` | 断点 | 不暂停，自动化友好 |
| 函数调用链 / 上下文 | `trace_function --target <name>` | 单点断点 | 日志点连续观察 |
| 局部变量 | `set_breakpoint_on_text` + `inspect_locals` | Hook | Hook 拿不到闭包内变量 |
| 不知道函数名 | `create_hook --type fetch` | 断点 | 从网络层反查 |
| 首屏初始化（脚本未注册） | `inject_preload_script` | Hook/断点 | 在脚本注册前采样 |
| 持续高频调用 | `create_hook` + `inject_hook --persistent true` | 断点 | 避免断点循环检测 |
| 加密库直接拦截 | `hook_cryptojs` / `hook_jsencrypt` / `hook_smcrypto` | 通用 Hook | 专项工具更稳定 |
| 反调试绕过 | `anti_anti_debug` / `bypass_debugger` | 手动 Hook | 一键更可靠 |
| 时间戳/随机数固定 | `create_hook --type timer --params <fixedValue>` | 改源码 | 仅影响运行时不改行为 |

> 断点自动循环检测：同一断点 2s 内命中 3 次自动 resume + 移除。所以**断点不适合持续监控**。
> 完整类型清单 + 用法：`references/hook-patterns.md`。

---

## 必读引用（按加载顺序）

| # | 文件 | 何时读 |
|---|------|--------|
| 1 | `references/tool-catalog.md` | 任何工具调用前 — 查参数与必填项 |
| 2 | `references/profile-tool-gating.md` | 不确定工具是否可用时（profile gating） |
| 3 | `references/decision-guide.md` | 需要决策路径（6 大场景 + Hook vs 断点） |
| 4 | `references/hook-patterns.md` | 写 `create_hook` / `inject_hook` 时 |
| 5 | `references/automation-entry.md` | 自动化任务执行时 |
| 6 | `references/cli-task-template.md` | CLI 模式执行 |
| 7 | `references/local-rebuild.md` | 导出 Node bundle 后 |
| 8 | `references/env-patching.md` | 补环境时 |
| 9 | `references/node-env-rebuild.md` | 扣包补环境时 |
| 10 | `references/instrumentation.md` | VMP / 复杂插桩 |
| 11 | `references/ast-deobfuscation.md` | AST 去混淆 |
| 12 | `references/fallbacks.md` | 失败回退（含防护站点决策树） |
| 13 | `references/output-contract.md` | 提交最终交付物时 |
| 14 | `references/task-artifacts.md` | 任务产物约定 |
| 15 | `references/task-input-template.md` + `schemas/reverse-task-input.schema.json` | 新任务输入 |
| 16 | `references/websocket-reverse.md` | WebSocket 协议逆向 |
| 17 | `references/wasm-reverse.md` | Wasm 逆向 |
| 18 | `references/stealth-emulation.md` | 反检测 / 设备模拟 |
| 19 | `references/code-templates.md` | 用 `get_code_template` / `inject_code_template` |
| 20 | `references/tool-defaults.md` | 参数默认值速查 |
| 21 | `references/cases/` | 抽象 case（ast-deobfuscation / signature-node / window-honeypot / websocket-protobuf） |

仓库硬边界（与 `docs/reference/case-safety-policy.md` 对齐）：
- `scripts/cases/*` 只允许抽象 case（映射/判定口径/输入契约）
- 站点级可复用流程统一维护在 `scripts/cases/*`
- `artifacts/tasks/<task-id>/` 才放完整可执行实现 + 真实任务证据
- 不得把真实 cookie/token/storage 原文放进仓库公开层

---

## 配套模板（不在本 skill 内部，按需跳转）

- 更新提示词：`docs/reference/reverse-update-prompt-template.md`
- 报告模板：`docs/reference/reverse-report-template.md`
- 算法升级 / first divergence：`docs/reference/algorithm-upgrade-template.md`
- 仓库根工作流：`docs/reference/reverse-bootstrap.md`（首读入口）
- 六阶段权威定义：`docs/reference/reverse-workflow.md`
- 纯算法提纯协议：`docs/reference/pure-extraction.md`
- 站点映射模板：`docs/reference/parameter-site-mapping-template.md`
