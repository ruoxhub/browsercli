# JSReverser-MCP 使用文档

> 完整的 CLI 命令、MCP 工具和技能使用指南

---

## 目录

- [快速开始](#快速开始)
- [调试器静态验证站](#调试器静态验证站)
- [CLI 命令](#cli-命令)
- [MCP 工具](#mcp-工具)
- [内置技能](#内置技能)
- [REPL 模式](#repl-模式)
- [常见问题](#常见问题)

---

## 快速开始

```bash
# 安装依赖
npm ci

# 构建项目
npm run build

# 启动守护进程
js-reverse start --browserUrl http://127.0.0.1:9222

# 查看守护进程状态
js-reverse status

# 列出可用工具和兼容技能映射
js-reverse list-tools

# 新工作流工具（推荐）
js-reverse call observe_flow --url https://example.com

# 兼容旧技能名（已并入 call）
js-reverse call observe-flow --url https://example.com

# 通用兼容包装工具（仍保留）
js-reverse call invoke_skill --skillName observe-flow --url https://example.com

# 停止守护进程
js-reverse stop
```

## 调试器静态验证站

仓库内置了一个本地调试测试站，用于集中验证调试器、网络、WebSocket 等工具是否工作正常：

- 页面入口：`scripts/debugger-lab/index.html`
- 主脚本：`scripts/debugger-lab/app.js`
- 静态资源目录：`scripts/debugger-lab/`
- 推荐启动命令：`npm run debugger-lab`
- 完整验证规划：[`docs/js-reverse-tool-validation-plan.md`](./js-reverse-tool-validation-plan.md)

这个页面专门覆盖以下场景：

- 稳定脚本 URL，便于 `list_scripts`、`get_script_source`、`search_in_sources`
- 命名函数入口，便于 `hook_function`、`unhook_function`、`list_hooks`
- 表单、点击、输入、submit，便于 `monitor_events`、`stop_monitor`
- `localStorage`、`sessionStorage`、`cookie` 写入，便于 `get_storage`
- Fetch / XHR 请求，便于 `break_on_xhr`、`xhr_to_js_breakpoint`、`get_request_initiator`
- WebSocket 连接与消息，便于 `list_websocket_connections`、`get_websocket_messages`、`analyze_websocket_messages`
- 显式 `debugger;` 语句，便于 `pause`、`get_paused_info`、`evaluate_on_callframe`、单步工具

### 启动方式

不要直接双击 `index.html`。请用本地服务打开，否则 `fetch` / `XMLHttpRequest` / `WebSocket` 场景通常会受到 `file://` 限制。

示例：

```bash
# 方式 1：npm script（推荐）
npm run debugger-lab

# 方式 2：直接运行脚本
node scripts/debugger-lab/server.mjs

# 然后打开
http://127.0.0.1:8936
```

如果你只需要静态页面，也可以使用其他静态服务器把根目录指向 `scripts/debugger-lab`；
但这样不会包含内置的 `/api/ping`、`/api/echo`、`/ws` 测试接口。

### 推荐验证顺序

```bash
# 1. 打开测试页
js-reverse call navigate_page --url "http://127.0.0.1:8936"

# 2. 确认脚本已加载
js-reverse call list_scripts --filter "/app.js"

# 3. 搜索关键入口
js-reverse call search_in_sources --query "encryptPayload"
js-reverse call search_in_sources --query "triggerManualPause"
js-reverse call search_in_sources --query "debugger;"

# 4. 给稳定文本打断点
js-reverse call set_breakpoint_on_text --text "debugger;" --urlFilter "debugger-lab/app.js"
```

### 页面内可直接触发的场景

| 页面动作                           | 对应函数 / 行为                                   | 适合验证的工具                                                                                |
| ---------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 点击“执行 encryptPayload”          | `window.debugLab.signature.encryptPayload()`      | `hook_function` `list_hooks` `unhook_function`                                                |
| 点击“执行 signPayload”             | `window.debugLab.signature.signPayload()`         | `hook_function` `inspect_object`                                                              |
| 点击“执行 calculateRiskScore”      | `window.debugLab.scoring.calculateRiskScore()`    | `hook_function` `search_in_sources`                                                           |
| 点击“发起 Fetch”                   | `window.debugLab.network.fetchEcho()`             | `get_request_initiator`                                                                       |
| 点击“发起 XHR”                     | `window.debugLab.network.xhrEcho()`               | `break_on_xhr` `xhr_to_js_breakpoint`                                                         |
| 点击“连接 WS” / “发送 WS 消息”     | `window.debugLab.connectWebSocket()`              | `list_websocket_connections` `get_websocket_messages` `analyze_websocket_messages`            |
| 点击“写入 Storage” / “刷新 Cookie” | `localStorage` `sessionStorage` `document.cookie` | `get_storage`                                                                                 |
| 在表单中输入、切换、提交           | DOM 事件流                                        | `monitor_events` `stop_monitor`                                                               |
| 点击“触发 debugger”                | `window.debugLab.triggerManualPause()`            | `pause` `resume` `step_into` `step_over` `step_out` `get_paused_info` `evaluate_on_callframe` |
| 点击“更新复杂对象”                 | 更新 `window.debugLab.runtimeSnapshot`            | `inspect_object`                                                                              |

### 推荐命令样例

```bash
# 观察脚本
js-reverse call list_scripts --filter "/app.js"
js-reverse call get_script_source --scriptId "<scriptId>"
js-reverse call get_script_source --urlPattern "app.js"
js-reverse call search_in_sources --query "token-watch"
js-reverse call search_in_sources --query "token-watch" --contextLines 2 --maxLineLength 120 --urlFilter "app.js"

# Hook 命名函数
js-reverse call hook_function --target "window.debugLab.signature.encryptPayload" --logArgs true --logResult true
js-reverse call list_hooks
js-reverse call unhook_function --hookId "window_debugLab_signature_encryptPayload"

# 监控表单事件
js-reverse call monitor_events --selector "#lab-form" --events '["click","input","change","submit"]'
js-reverse call stop_monitor --monitorId "_lab_form"

# 读取存储
js-reverse call get_storage --type "all"
js-reverse call get_storage --type "localStorage" --filter "debugger-lab"
js-reverse call get_storage --type "cookies" --filter "dbg_token"

# XHR 断点
js-reverse call break_on_xhr --url "ping.json"

# 点击页面按钮触发 XHR 后，可继续转 JS 断点
js-reverse call xhr_to_js_breakpoint

# WebSocket
js-reverse call list_websocket_connections
js-reverse call analyze_websocket_messages --wsid 1
js-reverse call get_websocket_messages --wsid 1

# 检查对象
js-reverse call inspect_object --expression "window.debugLab.runtimeSnapshot" --depth 3
js-reverse call inspect_object --expression "window.debugLab.lastResponse" --depth 3

# 触发 debugger 后查看暂停态
js-reverse call get_paused_info
js-reverse call evaluate_on_callframe --expression "localSecret"
js-reverse call evaluate_on_callframe --expression "computedToken"
js-reverse call step_over
js-reverse call resume
```

### 签名追踪工作流

当 Hook 显示“注入成功”但 `get_hook_data` 仍然是 0 条记录时，不要直接进入本地重建。先确认目标请求、早期注入时机和暂停现场。

```powershell
# 1. 先找带签名特征的请求头，并返回证据关联
js-reverse call list_network_requests --headerFilter "sign" --includeSignatureEvidence true

# 2. 生成签名追踪路径和下一步命令
js-reverse call trace_signature_generation --requestUrlPattern "/api/" --headerKeyword "sign" --maxResults 5

# 3. 查看 Hook 详情；若 totalRecords 为 0，结果会给出可能原因和升级路径
js-reverse call get_hook_data --hookId "hook_fetch" --view detail --maxRecords 20

# 4. 在请求发送前暂停，查看调用栈和局部变量
js-reverse call xhr_to_js_breakpoint --url "/api/"
js-reverse call get_paused_info
js-reverse call evaluate_on_callframe --expression "headers"
js-reverse call evaluate_on_callframe --expression "body"

# 5. 导出本次证据和剩余缺口
js-reverse call export_session_report --format "json"
```

`trace_signature_generation` 不会重放真实请求；它只根据当前网络记录、请求头、initiator 和暂停态生成证据路径。需要复测参数变化时，先在隔离环境确认目标接口没有副作用。

### 调试器验证建议

- `list_scripts` 建议直接用 `--filter "/app.js"`，本地测试站真实脚本 URL 是 `http://127.0.0.1:8936/app.js`
- 优先用 `set_breakpoint_on_text`，比直接写行号更稳
- Hook 目标优先选 `window.debugLab.signature.encryptPayload`，返回值明确、重复触发方便
- `inspect_object` 推荐检查 `window.debugLab.runtimeSnapshot`，结构足够复杂，能覆盖嵌套对象展示
- `get_storage` 推荐先点击页面内的 Storage/Cookie 按钮，再执行读取命令
- WebSocket 工具建议先点“连接 WS”，再点“发送 WS 消息”
- `evaluate_on_callframe` 只有在页面真正暂停后才有意义，推荐先点“触发 debugger”

### 技能迁移与兼容入口

内置技能已经迁移为工作流 Tool，推荐优先使用新的 Tool 名称；旧技能名现在通过 `call` 命令兼容，适合已有脚本、Sekiro 调用方或自动化任务继续使用。

| 能力           | 推荐入口                         | CLI 兼容入口                     | Tool 兼容入口                                             | Sekiro 兼容 Action            |
| -------------- | -------------------------------- | -------------------------------- | --------------------------------------------------------- | ----------------------------- |
| Observe Flow   | `js-reverse call observe_flow`   | `js-reverse call observe-flow`   | `js-reverse call invoke_skill --skillName observe-flow`   | `action=skill_observe_flow`   |
| Auto Hook      | `js-reverse call auto_hook`      | `js-reverse call auto-hook`      | `js-reverse call invoke_skill --skillName auto-hook`      | `action=skill_auto_hook`      |
| Rebuild Bundle | `js-reverse call rebuild_bundle` | `js-reverse call rebuild-bundle` | `js-reverse call invoke_skill --skillName rebuild-bundle` | `action=skill_rebuild_bundle` |

兼容查询入口：

- `js-reverse list-tools`
- `js-reverse call list_skills`
- Sekiro `action=_list_skills`

---

## CLI 命令

### start - 启动守护进程

启动 Worker 进程并连接到 Sekiro Server，进而连接 Chrome DevTools 实例。

```bash
js-reverse start --browserUrl http://127.0.0.1:9222
```

|                           | 参数                         | 说明                | 默认值 |
| ------------------------- | ---------------------------- | ------------------- | ------ |
| `--browserUrl <url>`      | 连接到已有的 Chrome 实例     | -                   |
| `--wsEndpoint <endpoint>` | 通过 WebSocket 端点连接      | -                   |
| `--headless`              | 无头模式运行                 | false               |
| `--executablePath <path>` | 自定义 Chrome/Edge 路径      | -                   |
| `--rpcHost <host>`     | Sekiro Server WebSocket 地址 | ws://127.0.0.1:5612 |
| `--group <name>`          | Sekiro 分组名                | default             |
| `--wait-for-browser`      | 等待浏览器可达后再返回       | false               |

**示例：**

```bash
# 连接本地 Chrome Debug 端口
js-reverse start --browserUrl http://127.0.0.1:9222

# 指定 Sekiro Server 和分组
js-reverse start --browserUrl http://127.0.0.1:9222 --rpcHost ws://127.0.0.1:5612 --group my-project

# 无头模式
js-reverse start --headless

# 自定义浏览器路径
js-reverse start --executablePath "/usr/bin/google-chrome"

# 等待浏览器就绪
js-reverse start --browserUrl http://127.0.0.1:9222 --wait-for-browser
```

### stop - 停止守护进程

```bash
js-reverse stop
```

### status - 检查守护进程状态

查看 Worker 运行状态和 Sekiro Server 连接情况。

```bash
js-reverse status
```

### config - 配置管理

查看、设置、初始化全局配置。

```bash
js-reverse config                        # 显示当前生效的完整配置
js-reverse config --init                 # 初始化用户级配置文件
js-reverse config --set key=value        # 设置配置项
js-reverse config --get key              # 获取配置项
js-reverse config --unset key            # 删除配置项
js-reverse config --list                 # 列出配置文件路径和来源
```

**配置键说明：**

|                  | 键                                  | 说明 |
| ---------------- | ----------------------------------- | ---- |
| `rpcHost`     | Sekiro Server WebSocket 地址        |
| `group`          | Sekiro 分组名                       |
| `browserUrl`     | 浏览器调试 URL                      |
| `wsEndpoint`     | WebSocket 端点                      |
| `headless`       | 无头模式 (true/false)               |
| `executablePath` | 浏览器可执行路径                    |
| `runtimeDirName` | 运行时目录名                        |
| `llmProvider`    | AI 提供商 (openai/anthropic/gemini) |
| `debug`          | 调试模式 (true/false)               |

**嵌套键（用点号分隔）：**

- `openai.apiKey` / `openai.baseURL` / `openai.model`
- `anthropic.apiKey` / `anthropic.baseURL` / `anthropic.model`
- `gemini.apiKey` / `gemini.cliPath` / `gemini.model`
- `browser.headless` / `browser.isolated` / `browser.executablePath` / `browser.channel` / `browser.useStealthScripts`

**示例：**

```bash
# 初始化配置文件
js-reverse config --init

# 设置 Sekiro Server 地址
js-reverse config --set rpcHost=ws://127.0.0.1:5612

# 设置 OpenAI API Key
js-reverse config --set openai.apiKey=sk-xxx

# 获取配置项
js-reverse config --get rpcHost

# 删除配置项
js-reverse config --unset browserUrl

# 列出所有配置来源
js-reverse config --list
```

### call - 调用工具或兼容技能

```bash
js-reverse call <tool-or-skill-name> [options]
```

`call` 同时支持两类目标：

- MCP Tool，例如 `take_screenshot`、`query_dom`
- 旧技能名兼容入口，例如 `observe-flow`、`auto-hook`、`rebuild-bundle`

|                        | 参数               | 说明 |
| ---------------------- | ------------------ | ---- |
| `<tool-or-skill-name>` | 工具名或兼容技能名 |
| `--url <url>`          | 目标网页 URL       |
| `--data <json>`        | 额外的 JSON 数据   |

**示例：**

```bash
# 调用普通工具
js-reverse call take_screenshot
js-reverse call query_dom --selector "#app"

# 使用新 Tool 名称调用工作流
js-reverse call observe_flow --url https://example.com
js-reverse call auto_hook --url https://example.com
js-reverse call rebuild_bundle --url https://example.com

# 使用旧技能名兼容调用
js-reverse call observe-flow --url https://example.com
js-reverse call auto-hook --url https://example.com
js-reverse call rebuild-bundle --url https://example.com
```

### list-tools - 列出可用工具

```bash
js-reverse list-tools        # 表格输出
js-reverse list-tools --json # JSON 输出
```

该命令同时返回：

- 当前可用的 MCP 工具列表（含参数签名）
- legacy skill 到新 Tool 的兼容映射

表格输出现在包含 `Signature` 列，显示每个工具所需/可选的参数格式，例如 `--scriptId <str>`、`--offset <num>`、`--caseSensitive <bool>`。

**示例：**

```bash
# 表格查看工具和兼容技能（含参数签名）
js-reverse list-tools

# JSON 输出，适合脚本消费
js-reverse list-tools --json
```

### repl - 交互式 REPL 模式

```bash
js-reverse repl
```

进入 REPL 后可使用以下子命令：

|                          | 子命令             | 说明 |
| ------------------------ | ------------------ | ---- |
| `skill <name> [args...]` | 调用技能           |
| `tool <name> [args...]`  | 调用工具           |
| `status`                 | 检查守护进程状态   |
| `list-tools`             | 列出工具和兼容技能 |
| `help`                   | 显示帮助           |
| `exit` / `quit`          | 退出 REPL          |

### scaffold - 创建新任务脚手架

```bash
js-reverse scaffold --name <task-name> [--desc <desc>] [--url <url>] [--output <directory>]
```

|                  | 参数             | 说明             | 默认值 |
| ---------------- | ---------------- | ---------------- | ------ |
| `--name <name>`  | 任务名称（必需） | -                |
| `--desc <desc>`  | 任务描述         | "New task"       |
| `--url <url>`    | 目标 URL         | -                |
| `--output <dir>` | 输出目录         | `./tasks/<name>` |

**示例：**

```bash
js-reverse scaffold --name jd-h5st --desc "JD H5ST 签名" --url https://m.jd.com
```

---

## MCP 工具

> **注意：** 所有工具名称使用下划线命名（如 `list_network_requests`），通过 `js-reverse call` 调用时需使用下划线格式。

### DOM 操作

|                           | 工具名         | 说明                                                                | 示例 |
| ------------------------- | -------------- | ------------------------------------------------------------------- | ---- |
| `query_dom`               | 查询 DOM 元素  | `js-reverse call query_dom --selector "#container"`                 |
| `get_dom_structure`       | 获取 DOM 结构  | `js-reverse call get_dom_structure --maxDepth 3 --includeText true` |
| `find_clickable_elements` | 查找可点击元素 | `js-reverse call find_clickable_elements --filterText "提交"`       |

**示例：**

```bash
# 查询单个元素
js-reverse call query_dom --selector "div.container"

# 查询所有匹配元素（最多10个）
js-reverse call query_dom --selector "a.link" --all true --limit 10

# 获取完整 DOM 树（深度3层）
js-reverse call get_dom_structure --maxDepth 3

# 查找包含"登录"的按钮
js-reverse call find_clickable_elements --filterText "登录"
```

### 网络请求

|                         | 工具名               | 说明                                              | 示例 |
| ----------------------- | -------------------- | ------------------------------------------------- | ---- |
| `list_network_requests` | 列出所有网络请求     | `js-reverse call list_network_requests`           |
| `get_network_request`   | 获取指定网络请求详情 | `js-reverse call get_network_request --reqid 123` |

`list_network_requests` 中有两个容易混淆的分页/定位参数：

- `pageIdx`：结果分页页码，只影响返回列表的第几页
- `targetPageIdx`：浏览器页面索引，用来指定要查看哪个标签页的网络请求

当前实现里，`list_network_requests --targetPageIdx <n>` 返回的 `reqid` 只适合在同一个当前选中页上下文里继续使用。跨页场景下如果不同页面出现重复 `reqid`，后续 `get_network_request` / `get_request_initiator` 可能命中错误页面的请求。要稳定追查非当前页请求，先切换当前页面，再执行详情类工具。

**示例：**

```bash
# 列出所有请求（默认返回所有）
js-reverse call list_network_requests

# 分页获取（每页20条）
js-reverse call list_network_requests --pageSize 20 --pageIdx 0

# 查看第 2 个浏览器页签的请求列表
js-reverse call list_network_requests --targetPageIdx 1

# 只获取 XHR 和 Fetch 类型
js-reverse call list_network_requests --resourceTypes '["xhr","fetch"]'

# 获取当前选中的请求详情
js-reverse call get_network_request

# 获取指定请求ID的详情
js-reverse call get_network_request --reqid 456
```

### 控制台消息

|                         | 工具名             | 说明                                            | 示例 |
| ----------------------- | ------------------ | ----------------------------------------------- | ---- |
| `list_console_messages` | 列出控制台消息     | `js-reverse call list_console_messages`         |
| `get_console_message`   | 获取指定控制台消息 | `js-reverse call get_console_message --msgid 1` |

**示例：**

```bash
# 列出所有控制台消息
js-reverse call list_console_messages

# 只看错误和警告
js-reverse call list_console_messages --types '["error","warning"]'

# 获取第5条消息详情
js-reverse call get_console_message --msgid 5
```

### WebSocket

|                              | 工具名                  | 说明                                                            | 示例 |
| ---------------------------- | ----------------------- | --------------------------------------------------------------- | ---- |
| `list_websocket_connections` | 列出 WebSocket 连接     | `js-reverse call list_websocket_connections`                    |
| `get_websocket_messages`     | 获取 WebSocket 消息列表 | `js-reverse call get_websocket_messages --wsid 1`               |
| `get_websocket_message`      | 获取单条 WebSocket 消息 | `js-reverse call get_websocket_message --wsid 1 --frameIndex 0` |
| `analyze_websocket_messages` | 分析 WebSocket 消息     | `js-reverse call analyze_websocket_messages --wsid 1`           |

**示例：**

```bash
# 列出所有 WebSocket 连接
js-reverse call list_websocket_connections

# 获取连接的消息（先分析了解消息类型）
js-reverse call analyze_websocket_messages --wsid 1

# 获取指定分组的消息
js-reverse call get_websocket_messages --wsid 1 --groupId "binary" --pageSize 50

# 获取单条消息详情
js-reverse call get_websocket_message --wsid 1 --frameIndex 10
```

### 输入自动化

|               | 工具名                 | 说明                                                                             | 示例 |
| ------------- | ---------------------- | -------------------------------------------------------------------------------- | ---- |
| `click`       | 点击元素               | `js-reverse call click --selector "#btn"`                                        |
| `click_at`    | 按坐标点击（真实鼠标） | `js-reverse call click_at --selector "#file-input"`                              |
| `press_key`   | 按键操作               | `js-reverse call press_key --key "Enter"`                                        |
| `fill_form`   | 批量填写表单           | `js-reverse call fill_form --elements '[{"selector":"#name","value":"John"}]'`   |
| `fill`        | 填充输入框             | `js-reverse call fill --selector "#search" --value "关键词"`                     |
| `upload_file` | 上传文件               | `js-reverse call upload_file --selector "#file" --filePath "/tmp/test.png"`      |
| `hover`       | 鼠标悬停               | `js-reverse call hover --selector "#dropdown"`                                   |
| `drag`        | 拖拽操作               | `js-reverse call drag --fromSelector "#src" --toSelector "#target"`              |
| `set_files`   | 绕过对话框设置文件     | `js-reverse call set_files --selector "#file" --filePaths '["/a.png","/b.png"]'` |

**示例：**

```bash
# 点击按钮
js-reverse call click --selector "#submit-btn"

# 双击
js-reverse call click --selector "#dbl-btn" --dblClick true

# 真实鼠标点击（可触发文件对话框）
js-reverse call click_at --selector "#upload-trigger"

# 填写表单
js-reverse call fill --selector "#username" --value "user@example.com"
js-reverse call fill --selector "#password" --value "password123"

# 批量填充表单
js-reverse call fill_form --elements '[{"selector":"#name","value":"张三"},{"selector":"#email","value":"zhang@example.com"}]'

# 键盘快捷键
js-reverse call press_key --key "Control+A"
js-reverse call press_key --key "Control+Shift+R"
js-reverse call press_key --key "Escape"

# 文件上传
js-reverse call upload_file --selector "#file-input" --filePath "/path/to/file.pdf"

# 直接设置文件（绕过文件选择对话框）
js-reverse call set_files --selector "#file-input" --filePaths '["/path/to/image.png"]'

# 悬停和拖拽
js-reverse call hover --selector "#dropdown-menu"
js-reverse call drag --fromSelector "#draggable" --toSelector "#dropzone"
```

### 页面操作

|                    | 工具名             | 说明                                                                      | 示例 |
| ------------------ | ------------------ | ------------------------------------------------------------------------- | ---- |
| `click_element`    | 点击页面元素       | `js-reverse call click_element --selector "button.submit"`                |
| `type_text`        | 输入文本（带延迟） | `js-reverse call type_text --selector "#input" --text "Hello" --delay 50` |
| `wait_for_element` | 等待元素出现       | `js-reverse call wait_for_element --selector ".loaded" --timeout 5000`    |
| `scroll_by`        | 滚动页面           | `js-reverse call scroll_by --direction "down"`                            |

**示例：**

```bash
# 点击元素
js-reverse call click_element --selector ".btn-primary"

# 模拟打字（每字符50ms延迟）
js-reverse call type_text --selector "#search" --text "要搜索的内容" --delay 50

# 等待元素出现
js-reverse call wait_for_element --selector "#modal" --timeout 10000

# 滚动
js-reverse call scroll_by --direction "down" --pixels 500
js-reverse call scroll_by --direction "bottom"
js-reverse call scroll_by --direction "top"
```

### 页面管理

|                 | 工具名       | 说明                                                                          | 示例 |
| --------------- | ------------ | ----------------------------------------------------------------------------- | ---- |
| `list_pages`    | 列出所有页面 | `js-reverse call list_pages`                                                  |
| `select_page`   | 选择页面     | `js-reverse call select_page --pageIdx 1`                                     |
| `new_page`      | 新建页面     | `js-reverse call new_page --url "https://example.com"`                        |
| `navigate_page` | 导航页面     | `js-reverse call navigate_page --type "navigate" --url "https://example.com"` |

**示例：**

```bash
# 列出所有页面
js-reverse call list_pages

# 选择页面
js-reverse call select_page --pageIdx 1

# 打开新页面
js-reverse call new_page --url "https://example.com"

# 导航操作
js-reverse call navigate_page --type "navigate" --url "https://example.com"
js-reverse call navigate_page --type "back"
js-reverse call navigate_page --type "forward"
js-reverse call navigate_page --type "reload"
```

### 截图与视频

|                       | 工具名       | 说明                                                      | 示例 |
| --------------------- | ------------ | --------------------------------------------------------- | ---- |
| `take_screenshot`     | 页面截图     | `js-reverse call take_screenshot`                         |
| `capture_video_frame` | 捕获视频帧   | `js-reverse call capture_video_frame --selector "video"`  |
| `get_video_info`      | 获取视频信息 | `js-reverse call get_video_info --selector "video"`       |
| `seek_video`          | 视频跳转     | `js-reverse call seek_video --selector "video" --time 30` |

**示例：**

```bash
# 普通截图
js-reverse call take_screenshot

# 截图格式和质量
js-reverse call take_screenshot --format "jpeg" --quality 85

# 全页面截图
js-reverse call take_screenshot --fullPage true

# 保存到文件
js-reverse call take_screenshot --filePath "/tmp/page.png"

# 获取视频信息
js-reverse call get_video_info --selector "video.player"

# 跳转到指定时间
js-reverse call seek_video --selector "video" --time 60

# 捕获视频帧
js-reverse call capture_video_frame --selector "video" --format "png"
js-reverse call capture_video_frame --selector "video" --seekTime 30 --outputPath "/tmp/frame.png"
```

### 模拟

|                   | 工具名        | 说明                                                     | 示例 |
| ----------------- | ------------- | -------------------------------------------------------- | ---- |
| `emulate_mobile`  | 模拟移动设备  | `js-reverse call emulate_mobile --device "iPhone 14"`    |
| `emulate_network` | 模拟网络条件  | `js-reverse call emulate_network --preset "Slow 3G"`     |
| `emulate_cpu`     | 模拟 CPU 节流 | `js-reverse call emulate_cpu --rate 4`                   |
| `resize_page`     | 调整页面尺寸  | `js-reverse call resize_page --width 1920 --height 1080` |

**示例：**

```bash
# 模拟 iPhone
js-reverse call emulate_mobile --device "iPhone 14"
js-reverse call emulate_mobile --device "iPad"

# 模拟网络
js-reverse call emulate_network --preset "Offline"
js-reverse call emulate_network --preset "Slow 3G"
js-reverse call emulate_network --preset "Fast 4G"

# CPU 节流（4x 降速）
js-reverse call emulate_cpu --rate 4

# 自定义窗口大小
js-reverse call resize_page --width 375 --height 812
```

### 隐身

|                         | 工具名          | 说明                                                          | 示例 |
| ----------------------- | --------------- | ------------------------------------------------------------- | ---- |
| `inject_stealth`        | 注入隐身脚本    | `js-reverse call inject_stealth`                              |
| `list_stealth_features` | 列出隐身功能    | `js-reverse call list_stealth_features`                       |
| `list_stealth_presets`  | 列出隐身预设    | `js-reverse call list_stealth_presets`                        |
| `set_user_agent`        | 设置 User-Agent | `js-reverse call set_user_agent --userAgent "Mozilla/5.0..."` |

**示例：**

```bash
# 注入隐身脚本
js-reverse call inject_stealth

# 列出可用功能
js-reverse call list_stealth_features

# 列出预设
js-reverse call list_stealth_presets

# 设置自定义 User-Agent
js-reverse call set_user_agent --userAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
```

### 性能分析

|                               | 工具名       | 说明                                                       | 示例 |
| ----------------------------- | ------------ | ---------------------------------------------------------- | ---- |
| `start_performance_trace`     | 开始性能追踪 | `js-reverse call start_performance_trace`                  |
| `stop_performance_trace`      | 停止性能追踪 | `js-reverse call stop_performance_trace`                   |
| `get_performance_metrics`     | 获取性能指标 | `js-reverse call get_performance_metrics`                  |
| `performance_analyze_insight` | 分析性能洞察 | `js-reverse call performance_analyze_insight --type "LCP"` |

**示例：**

```bash
# 开始追踪
js-reverse call start_performance_trace

# 执行操作后停止并获取报告
js-reverse call stop_performance_trace

# 获取性能指标
js-reverse call get_performance_metrics

# 获取特定洞察
js-reverse call performance_analyze_insight --type "CLS"
js-reverse call performance_analyze_insight --type "LCP"
```

### 调试器

|                              | 工具名           | 说明                                                            | 示例                             |
| ---------------------------- | ---------------- | --------------------------------------------------------------- | -------------------------------- |
| `set_breakpoint`             | 设置断点         | `js-reverse call set_breakpoint --url "app.js" --lineNumber 10` |
| `set_breakpoint_on_text`     | 在文本上设置断点 | `js-reverse call set_breakpoint_on_text --text "encrypt("`      |
| `remove_breakpoint`          | 移除断点         | `js-reverse call remove_breakpoint --breakpointId "bp1"`        |
| `list_breakpoints`           | 列出断点         | `js-reverse call list_breakpoints`                              |
| `step_into`                  | 单步进入         | `js-reverse call step_into`                                     |
| `step_over`                  | 单步跳过         | `js-reverse call step_over`                                     |
| `step_out`                   | 单步跳出         | `js-reverse call step_out`                                      |
| `resume`                     | 继续执行         | `js-reverse call resume`                                        |
| `pause`                      | 暂停执行         | `js-reverse call pause`                                         |
| `list_scripts`               | 列出脚本         | `js-reverse call list_scripts`                                  |
| `get_script_source`          | 获取脚本源码     | `js-reverse call get_script_source --scriptId "3"`              |
| `search_in_sources`          | 搜索源码         | `js-reverse call search_in_sources --query "encrypt"`           |
| `get_storage`                | 获取存储数据     | `js-reverse call get_storage`                                   |
| `break_on_xhr`               | XHR 断点         | `js-reverse call break_on_xhr --url "/api"`                     |
| `remove_xhr_breakpoint`      | 移除 XHR 断点    | `js-reverse call remove_xhr_breakpoint --url "/api"`            |
| `xhr_to_js_breakpoint`       | XHR 转 JS 断点   | `js-reverse call xhr_to_js_breakpoint`                          |
| `monitor_events`             | 监控事件         | `js-reverse call monitor_events --events '["click","input"]'`   |
| `stop_monitor`               | 停止监控         | `js-reverse call stop_monitor --monitorId "m1"`                 |
| `trace_function`             | 追踪函数         | `js-reverse call trace_function --functionName "encrypt"`       |
| `hook_function`              | Hook 函数        | `js-reverse call hook_function --target "window.encrypt"`       |
| `unhook_function`            | 取消 Hook        | `js-reverse call unhook_function --hookId "hk1"`                |
| `inspect_object`             | 检查对象         | `js-reverse call inspect_object --expression "window.crypto"`   |
| `find_in_script`             | 在脚本中搜索     | `js-reverse call find_in_script --query "encrypt"`              |
| `get_request_initiator`      | 获取请求发起者   | `js-reverse call get_request_initiator --requestId 123`         |
| `get_paused_info`            | 获取暂停信息     | `js-reverse call get_paused_info`                               |
| `evaluate_on_callframe`      | 在调用帧上执行   | `js-reverse call evaluate_on_callframe --expression "x"`        |
|                              | `inspect_locals` | 检查局部变量                                                    | `js-reverse call inspect_locals` |
| `get_ai_debug_status`        | 获取 AI 调试状态 | `js-reverse call get_ai_debug_status`                           |
| `start_continuous_debugging` | 开始连续调试     | `js-reverse call start_continuous_debugging`                    |
| `stop_continuous_debugging`  | 停止连续调试     | `js-reverse call stop_continuous_debugging`                     |
| `list_hooks`                 | 列出所有 Hook    | `js-reverse call list_hooks`                                    |

**示例：**

```bash
# 列出所有已加载脚本
js-reverse call list_scripts

# 搜索包含关键词的脚本
js-reverse call list_scripts --filter "main.js"

# 获取脚本源码
js-reverse call get_script_source --scriptId "3"
js-reverse call get_script_source --scriptId "3" --offset 0 --limit 5000

# 大文件分片读取（从第 5000 个字符开始读取 5000 个字符）
js-reverse call get_script_source --scriptId "3" --offset 5000 --limit 5000

# 设置断点
js-reverse call set_breakpoint --url "app.js" --lineNumber 10

# 按文本设置断点（第1个匹配项）
js-reverse call set_breakpoint_on_text --text "encrypt(" --urlFilter "app.js"

# 条件断点
js-reverse call set_breakpoint --url "app.js" --lineNumber 10 --condition "x > 0"

# 单步调试
js-reverse call step_into
js-reverse call step_over
js-reverse call step_out
js-reverse call resume
js-reverse call pause

# 列出所有断点
js-reverse call list_breakpoints

# 移除断点
js-reverse call remove_breakpoint --breakpointId "bp:app.js:10"

# XHR 断点
js-reverse call break_on_xhr --url "/api/sign"
js-reverse call remove_xhr_breakpoint --url "/api/sign"

# XHR 转 JS 断点（从 XHR 请求追踪到源码断点）
js-reverse call xhr_to_js_breakpoint

# 监控事件
js-reverse call monitor_events --selector "#btn" --events '["click","input"]'
js-reverse call stop_monitor --monitorId "evt1"

# 函数追踪
js-reverse call trace_function --functionName "encrypt" --urlFilter "main.js"
js-reverse call trace_function --functionName "encrypt" --logArgs true --logResult true

# 函数 Hook
js-reverse call hook_function --target "window.encrypt" --logArgs true --logResult true
js-reverse call unhook_function --hookId "hk:window.encrypt"

# 对象检查
js-reverse call inspect_object --expression "document.body"
js-reverse call inspect_object --expression "window.localStorage" --depth 3

# 获取存储数据
js-reverse call get_storage
js-reverse call get_storage --type "cookies"
js-reverse call get_storage --type "localStorage" --filter "token"

# 搜索源码
js-reverse call search_in_sources --query "encrypt"
js-reverse call search_in_sources --query "token" --caseSensitive false
js-reverse call search_in_sources --query "\\d{32}" --isRegex true

# 限定单个脚本搜索
js-reverse call search_in_sources --query "sign" --scriptId "3"

# 字符级上下文（适合单行压缩 JS）
js-reverse call search_in_sources --query "encrypt" --contextChars 120

# 行级上下文 + URL 过滤
js-reverse call search_in_sources --query "token-watch" --contextLines 2 --maxLineLength 120 --urlFilter "app.js"

# 在脚本中搜索
js-reverse call find_in_script --query "encrypt"

# 获取请求发起者
js-reverse call get_request_initiator --requestId 123

# 获取暂停信息（断点命中时）
js-reverse call get_paused_info

# 在调用帧上执行表达式（需先命中断点）
js-reverse call evaluate_on_callframe --expression "localVar"
js-reverse call evaluate_on_callframe --expression "headers" --callFrameId "c1"

# 查看当前暂停栈的局部变量摘要
js-reverse call inspect_locals

# AI 调试状态
js-reverse call get_ai_debug_status

# 连续调试
js-reverse call start_continuous_debugging
js-reverse call stop_continuous_debugging

# 列出所有已注册的 Hook
js-reverse call list_hooks
```

### Hook 系统

#### 通用 Hook

|                      | 工具名          | 说明                                           | 示例 |
| -------------------- | --------------- | ---------------------------------------------- | ---- |
| `create_hook`        | 创建 Hook       | `js-reverse call create_hook --type fetch`     |
| `inject_hook`        | 注入 Hook       | `js-reverse call inject_hook --hookId "hk1"`   |
| `list_created_hooks` | 列出已创建 Hook | `js-reverse call list_created_hooks`           |
| `get_hook_data`      | 获取 Hook 数据  | `js-reverse call get_hook_data --hookId "hk1"` |
| `remove_hook`        | 移除 Hook       | `js-reverse call remove_hook --hookId "hk1"`   |

**示例：**

```bash
# 创建 Fetch Hook
js-reverse call create_hook --type fetch --action log

# 创建带参数的 Hook
js-reverse call create_hook --type xhr --params '{"filterUrls":["/api"]}'

# 注入 Hook
js-reverse call inject_hook --hookId "hk123"

# 获取 Hook 数据
js-reverse call get_hook_data --hookId "hk123"
js-reverse call get_hook_data --hookId "hk123" --view summary --maxRecords 50
js-reverse call get_hook_data --hookId "hk123" --view detail --maxRecords 20
js-reverse call get_hook_data --view summary --type fetch --event response --phase success

# 列出所有 Hook
js-reverse call list_created_hooks
js-reverse call list_created_hooks --verbose true
js-reverse call list_created_hooks --type xhr --phase before

# 移除 Hook
js-reverse call remove_hook --hookId "hk123"
```

#### 专用 Hook

|                               | 工具名                    | 说明                                                                    | 示例 |
| ----------------------------- | ------------------------- | ----------------------------------------------------------------------- | ---- |
| `hook_console_log`            | Hook console.log          | `js-reverse call hook_console_log`                                      |
| `hook_console_table`          | Hook console.table        | `js-reverse call hook_console_table`                                    |
| `hook_console_protect`        | Hook console 保护         | `js-reverse call hook_console_protect`                                  |
| `hook_console_clear`          | Hook console 清空         | `js-reverse call hook_console_clear`                                    |
| `hook_location_href`          | Hook location.href        | `js-reverse call hook_location_href`                                    |
| `hook_cookie`                 | Hook Cookie               | `js-reverse call hook_cookie`                                           |
| `hook_xhr_open`               | Hook XHR open             | `js-reverse call hook_xhr_open`                                         |
| `hook_xhr_set_request_header` | Hook XHR setRequestHeader | `js-reverse call hook_xhr_set_request_header`                           |
| `hook_fetch`                  | Hook Fetch                | `js-reverse call hook_fetch`                                            |
| `hook_json_parse`             | Hook JSON.parse           | `js-reverse call hook_json_parse`                                       |
| `hook_json_stringify`         | Hook JSON.stringify       | `js-reverse call hook_json_stringify`                                   |
| `hook_promise`                | Hook Promise              | `js-reverse call hook_promise`                                          |
| `hook_random`                 | Hook Random               | `js-reverse call hook_random --fixedValue 0.5`                          |
| `hook_local_storage`          | Hook localStorage         | `js-reverse call hook_local_storage`                                    |
| `hook_session_storage`        | Hook sessionStorage       | `js-reverse call hook_session_storage`                                  |
| `hook_websocket`              | Hook WebSocket            | `js-reverse call hook_websocket`                                        |
| `hook_history`                | Hook History              | `js-reverse call hook_history`                                          |
| `hook_history_go`             | Hook history.go           | `js-reverse call hook_history_go`                                       |
| `hook_performance_now`        | Hook performance.now      | `js-reverse call hook_performance_now`                                  |
| `hook_date_now`               | Hook Date.now             | `js-reverse call hook_date_now --fixedValue 1700000000000`              |
| `hook_close`                  | Hook close                | `js-reverse call hook_close`                                            |
| `fixed_window_size`           | 固定窗口大小              | `js-reverse call fixed_window_size --innerWidth 1366 --innerHeight 768` |
| `anti_anti_hook`              | 反反 Hook                 | `js-reverse call anti_anti_hook`                                        |

**示例：**

```bash
# Console Hook
js-reverse call hook_console_log --mode proxy
js-reverse call hook_console_log --showStack true
js-reverse call hook_console_table
js-reverse call hook_console_protect
js-reverse call hook_console_clear

# 网络 Hook
js-reverse call hook_fetch --showStack true
js-reverse call hook_xhr_open --filterUrls '["/api/","/sign/"]' --showStack true
js-reverse call hook_xhr_set_request_header --filterKeys '["Authorization","X-Token"]'

# 直接执行 Hook 工具后的验证
js-reverse call hook_fetch
# 返回结果会显示 recordCount（已捕获记录数）和状态提示；
# 若 recordCount=0，表示 Hook 已安装但页面尚未产生新的 fetch 调用，
# 可刷新页面或触发新的 fetch 请求后再读取。
js-reverse call get_hook_data --hookId "hook_fetch" --view detail

# 数据解析 Hook
js-reverse call hook_json_parse
js-reverse call hook_json_parse --filterKeys '["token","sign"]'
js-reverse call hook_json_stringify

# 存储 Hook
js-reverse call hook_cookie --filterKeys '["session_id","token"]'
js-reverse call hook_local_storage --actions '["setItem","getItem"]' --filterKeys '["user"]'
js-reverse call hook_session_storage

# 定时器/随机 Hook
js-reverse call hook_random --fixedValue 0.5
js-reverse call hook_date_now --fixedValue 1700000000000
js-reverse call hook_performance_now --fixedValue 1000

# 页面导航 Hook
js-reverse call hook_location_href --showStack true
js-reverse call hook_history --filterUrls '["redirect","/goto"]'
js-reverse call hook_history_go

# WebSocket Hook
js-reverse call hook_websocket --filterUrls '["wss://api."]'

# Promise Hook
js-reverse call hook_promise

# 窗口尺寸固定
js-reverse call fixed_window_size --innerWidth 1920 --innerHeight 1080

# 反反调试
js-reverse call anti_anti_hook
js-reverse call hook_close
```

### 对话框

|                 | 工具名     | 说明                                                                    | 示例 |
| --------------- | ---------- | ----------------------------------------------------------------------- | ---- |
| `handle_dialog` | 处理对话框 | `js-reverse call handle_dialog --action accept --promptText "输入内容"` |

**示例：**

```bash
# 接受确认对话框
js-reverse call handle_dialog --action accept

# 拒绝确认对话框
js-reverse call handle_dialog --action dismiss

# 输入文本到提示框
js-reverse call handle_dialog --action accept --promptText "用户名"
```

### 框架

|                | 工具名      | 说明                                        | 示例 |
| -------------- | ----------- | ------------------------------------------- | ---- |
| `list_frames`  | 列出 iframe | `js-reverse call list_frames`               |
| `select_frame` | 选择 iframe | `js-reverse call select_frame --frameIdx 1` |

**示例：**

```bash
# 列出所有 iframe
js-reverse call list_frames

# 切换到 iframe
js-reverse call select_frame --frameIdx 1
```

### 脚本执行

|                         | 工具名         | 说明                                                                      | 示例 |
| ----------------------- | -------------- | ------------------------------------------------------------------------- | ---- |
| `evaluate_script`       | 执行脚本       | `js-reverse call evaluate_script --function "() => document.title"`       |
| `inject_preload_script` | 注入预加载脚本 | `js-reverse call inject_preload_script --script "console.log('preload')"` |

`evaluate_script` 当前支持 `--context page` 和 `--context content-script`。CLI 也接受 `--verbose`，但当前实现还没有根据该参数返回额外堆栈或底层错误细节；开启后仍主要返回归一化错误消息，因此不要把它当成已生效的诊断开关。

**示例：**

```bash
# 执行脚本
js-reverse call evaluate_script --function "() => document.title"
js-reverse call evaluate_script --function "() => window.innerWidth"

# 在 content-script 上下文执行
js-reverse call evaluate_script --function "() => location.href" --context content-script

# 当前版本可传入 verbose，但不会额外展开底层堆栈
js-reverse call evaluate_script --function "() => { throw new Error('boom') }" --verbose

# 注入预加载脚本（每次页面加载前执行）
js-reverse call inject_preload_script --script "(() => { window.preloadData = 'test'; })()"
```

### 站点经验

|                          | 工具名       | 说明                                                                               | 示例 |
| ------------------------ | ------------ | ---------------------------------------------------------------------------------- | ---- |
| `search_site_experience` | 搜索站点经验 | `js-reverse call search_site_experience --url "https://example.com"`               |
| `list_site_experiences`  | 列出站点经验 | `js-reverse call list_site_experiences`                                            |
| `create_site_experience` | 创建站点经验 | `js-reverse call create_site_experience --name "my-site"`                          |
| `update_site_experience` | 更新站点经验 | `js-reverse call update_site_experience --name "my-site" --data '{"key":"value"}'` |
| `delete_site_experience` | 删除站点经验 | `js-reverse call delete_site_experience --name "my-site"`                          |

### 扩展

|                     | 工具名   | 说明                                | 示例 |
| ------------------- | -------- | ----------------------------------- | ---- |
| `update_extensions` | 更新扩展 | `js-reverse call update_extensions` |

### 分析器

|                           | 工具名       | 说明                                                                      | 示例 |
| ------------------------- | ------------ | ------------------------------------------------------------------------- | ---- |
| `deobfuscate_code`        | 去混淆代码   | `js-reverse call deobfuscate_code --code "obfuscated..."`                 |
| `understand_code`         | 理解代码     | `js-reverse call understand_code --code "function(){}"`                   |
| `summarize_code`          | 总结代码     | `js-reverse call summarize_code --mode single --code "..."`               |
| `detect_crypto`           | 检测加密算法 | `js-reverse call detect_crypto --code "..."`                              |
| `record_reverse_evidence` | 记录逆向证据 | `js-reverse call record_reverse_evidence --taskId "t1" --goal "获取签名"` |
| `analyze_target`          | 分析目标     | `js-reverse call analyze_target --url "https://example.com"`              |
| `risk_panel`              | 风险面板     | `js-reverse call risk_panel --code "..."`                                 |
| `export_session_report`   | 导出会话报告 | `js-reverse call export_session_report --format "markdown"`               |

**示例：**

```bash
# 代码去混淆
js-reverse call deobfuscate_code --code "(function(){...})()"
js-reverse call deobfuscate_code --code "..." --aggressive true --renameVariables true

# 理解代码结构
js-reverse call understand_code --code "function encrypt(data) {...}"
js-reverse call understand_code --code "..." --focus security

# 总结代码
js-reverse call summarize_code --mode single --code "..."
js-reverse call summarize_code --mode batch --files '[{"url":"a.js","content":"...","size":1000,"type":"external"}]'

# 检测加密算法
js-reverse call detect_crypto --code "..."
js-reverse call detect_crypto --code "..." --useAI true

# 记录逆向证据
js-reverse call record_reverse_evidence --taskId "jd-h5st" --taskSlug "jd-h5st" --goal "逆向h5st签名" --targetUrl "https://m.jd.com"

# 一站式目标分析
js-reverse call analyze_target --url "https://m.jd.com" --topN 5 --useAI true

# 风险评估
js-reverse call risk_panel --code "..."
js-reverse call risk_panel --code "..." --useAI true --includeHookSignals true

# 导出报告
js-reverse call export_session_report --format markdown
js-reverse call export_session_report --format json --includeHookData true
```

### 代码收集器

|                     | 工具名           | 说明                                                                   | 示例 |
| ------------------- | ---------------- | ---------------------------------------------------------------------- | ---- |
| `collect_code`      | 收集代码         | `js-reverse call collect_code`                                         |
| `collection_diff`   | 收集差异对比     | `js-reverse call collection_diff --previous "snap1" --current "snap2"` |
| `search_in_scripts` | 搜索脚本中的内容 | `js-reverse call search_in_scripts --pattern "encrypt"`                |

**示例：**

```bash
# 收集页面代码（需要指定 URL）
js-reverse call collect_code --url "https://example.com"

# 智能模式收集
js-reverse call collect_code --url "https://example.com" --returnMode priority --maxTotalSize 1048576

# 仅收集内联脚本并限定大小
js-reverse call collect_code --url "https://example.com" --includeInline true --includeExternal false --maxTotalSize 512000

# 代码差异对比
js-reverse call collection_diff --previous "before" --current "after"

# 搜索脚本内容
js-reverse call search_in_scripts --pattern "encrypt"
js-reverse call search_in_scripts --pattern "token" --caseSensitive false
```

### 重建包

|                         | 工具名       | 说明                                                                                           | 示例 |
| ----------------------- | ------------ | ---------------------------------------------------------------------------------------------- | ---- |
| `export_rebuild_bundle` | 导出重建包   | `js-reverse call export_rebuild_bundle --taskSlug "task1"`                                     |
| `diff_env_requirements` | 对比环境需求 | `js-reverse call diff_env_requirements --runtimeError "ReferenceError: window is not defined"` |

**示例：**

```bash
# 导出本地复现 bundle
js-reverse call export_rebuild_bundle --taskSlug "jd-h5st" --goal "逆向签名" --autoGenerate true

# 指定目标
js-reverse call export_rebuild_bundle --taskSlug "task1" --targetKeywords '["sign","encrypt"]' --targetUrlPatterns '["/api/*"]'

# 对比环境需求
js-reverse call diff_env_requirements --runtimeError "ReferenceError: fetch is not defined" --observedCapabilities "xhr"
```

### 反反调试

|                   | 工具名         | 说明                                                              | 示例 |
| ----------------- | -------------- | ----------------------------------------------------------------- | ---- |
| `anti_anti_debug` | 反反调试       | `js-reverse call anti_anti_debug`                                 |
| `bypass_debugger` | 绕过调试器检测 | `js-reverse call bypass_debugger --targets '["eval","Function"]'` |

**示例：**

```bash
# 反反调试
js-reverse call anti_anti_debug

# 绕过无限 debugger
js-reverse call bypass_debugger --targets '["eval","Function","constructor"]'
```

### 加密 Hook

|                  | 工具名            | 说明                             | 示例 |
| ---------------- | ----------------- | -------------------------------- | ---- |
| `hook_cryptojs`  | Hook CryptoJS 库  | `js-reverse call hook_cryptojs`  |
| `hook_jsencrypt` | Hook JSEncrypt 库 | `js-reverse call hook_jsencrypt` |
| `hook_smcrypto`  | Hook SM-Crypto 库 | `js-reverse call hook_smcrypto`  |

**示例：**

```bash
# Hook 所有 CryptoJS 算法
js-reverse call hook_cryptojs

# 指定算法
js-reverse call hook_cryptojs --algorithms '["AES","MD5","SHA"]'

# 日志格式
js-reverse call hook_cryptojs --logFormat json
js-reverse call hook_cryptojs --logFormat compact

# Hook JSEncrypt (RSA)
js-reverse call hook_jsencrypt
js-reverse call hook_jsencrypt --logFormat json

# Hook 国密算法
js-reverse call hook_smcrypto
js-reverse call hook_smcrypto --algorithms '["SM2","SM4"]'
```

### Vue DevTools

|                         | 工具名            | 说明                                    | 示例 |
| ----------------------- | ----------------- | --------------------------------------- | ---- |
| `activate_vue_devtools` | 激活 Vue DevTools | `js-reverse call activate_vue_devtools` |
| `clear_vue_guards`      | 清除 Vue 路由守卫 | `js-reverse call clear_vue_guards`      |
| `get_vue_routes`        | 获取 Vue 路由信息 | `js-reverse call get_vue_routes`        |

**示例：**

```bash
# 激活 Vue DevTools
js-reverse call activate_vue_devtools

# 清除路由守卫
js-reverse call clear_vue_guards

# 获取路由信息
js-reverse call get_vue_routes
```

### 会话状态

|                         | 工具名             | 说明                                                                             | 示例 |
| ----------------------- | ------------------ | -------------------------------------------------------------------------------- | ---- |
| `save_session_state`    | 保存会话状态       | `js-reverse call save_session_state --sessionId "s1"`                            |
| `restore_session_state` | 恢复会话状态       | `js-reverse call restore_session_state --sessionId "s1"`                         |
| `list_session_states`   | 列出会话状态       | `js-reverse call list_session_states`                                            |
| `delete_session_state`  | 删除会话状态       | `js-reverse call delete_session_state --sessionId "s1"`                          |
| `dump_session_state`    | 导出会话状态       | `js-reverse call dump_session_state --sessionId "s1" --path "/tmp/session.json"` |
| `load_session_state`    | 加载会话状态       | `js-reverse call load_session_state --path "/tmp/session.json"`                  |
| `check_browser_health`  | 检查浏览器健康状态 | `js-reverse call check_browser_health`                                           |

**示例：**

```bash
# 保存当前会话
js-reverse call save_session_state --sessionId "login-state"
js-reverse call save_session_state --sessionId "s1" --includeCookies true --includeLocalStorage true

# 恢复会话
js-reverse call restore_session_state --sessionId "login-state"
js-reverse call restore_session_state --sessionId "s1" --clearStorageBeforeRestore true

# 列出所有保存的会话
js-reverse call list_session_states

# 导出会话到文件
js-reverse call dump_session_state --sessionId "s1" --path "/tmp/session.json"
js-reverse call dump_session_state --sessionId "s1" --path "/tmp/session.json" --pretty true

# 从文件加载会话
js-reverse call load_session_state --path "/tmp/session.json"

# 检查浏览器状态
js-reverse call check_browser_health

# 删除会话
js-reverse call delete_session_state --sessionId "s1"
```

### v_jstools 工具集

|                       | 工具名                 | 说明                                                    | 示例 |
| --------------------- | ---------------------- | ------------------------------------------------------- | ---- |
| `deobfuscate_code_vj` | 去混淆代码 (v_jstools) | `js-reverse call deobfuscate_code_vj --code "..."`      |
| `minify_code`         | 压缩/格式化代码        | `js-reverse call minify_code --code "..."`              |
| `transpile_code`      | 转译代码               | `js-reverse call transpile_code --code "..."`           |
| `analyze_ast`         | 分析 AST               | `js-reverse call analyze_ast --code "..."`              |
| `diff_code`           | 差异代码对比           | `js-reverse call diff_code --text1 "..." --text2 "..."` |

**示例：**

```bash
# 代码去混淆
js-reverse call deobfuscate_code_vj --code "obfuscated code..."
js-reverse call deobfuscate_code_vj --code "..." --mode auto
js-reverse call deobfuscate_code_vj --code "..." --mode sojson
js-reverse call deobfuscate_code_vj --code "..." --mode ob
js-reverse call deobfuscate_code_vj --code "..." --clearExtra true --clearUnused true

# 代码压缩/格式化
js-reverse call minify_code --code "function test() {...}"
js-reverse call minify_code --code "function test() {...}" --action format
js-reverse call minify_code --code "function test() {...}" --action minify

# 代码转译
js-reverse call transpile_code --code "const x = () => {}"
js-reverse call transpile_code --code "..." --presets '["env","typescript"]'

# AST 分析
js-reverse call analyze_ast --code "function test() { return 1; }"
js-reverse call analyze_ast --code "..." --detail full
js-reverse call analyze_ast --code "..." --filterType "FunctionDeclaration"

# 代码对比
js-reverse call diff_code --text1 "function a() {}" --text2 "function b() {}"
js-reverse call diff_code --text1 "..." --text2 "..." --mode context
```

### 代码模板

|                       | 工具名       | 说明                                                    | 示例 |
| --------------------- | ------------ | ------------------------------------------------------- | ---- |
| `get_code_template`   | 获取代码模板 | `js-reverse call get_code_template --name "fetch-hook"` |
| `list_code_templates` | 列出代码模板 | `js-reverse call list_code_templates`                   |

**示例：**

```bash
# 列出所有模板
js-reverse call list_code_templates

# 获取指定模板
js-reverse call get_code_template --name "fetch-hook"
js-reverse call get_code_template --name "xhr-intercept"
```

### 技能系统

以下两个 Tool 是通用兼容包装层，主要用于统一调用旧技能名；推荐新代码直接调用对应工作流 Tool，CLI 层则优先使用 `js-reverse call <tool-or-skill-name>`。

|                | 工具名         | 说明                                                      | 示例 |
| -------------- | -------------- | --------------------------------------------------------- | ---- |
| `invoke_skill` | 调用已注册技能 | `js-reverse call invoke_skill --skillName "observe-flow"` |
| `list_skills`  | 列出可用技能   | `js-reverse call list_skills`                             |

**示例：**

```bash
# 列出所有技能
js-reverse call list_skills

# 调用技能
js-reverse call invoke_skill --skillName "observe-flow" --url "https://example.com"
js-reverse call invoke_skill --skillName "auto-hook" --url "https://example.com"

# 推荐：直接调用工作流 Tool
js-reverse call observe_flow --url "https://example.com"
js-reverse call auto_hook --url "https://example.com"
```

### Sekiro 兼容调用

如果你是直接通过 Sekiro HTTP / Worker action 调用，而不是通过 CLI，可以继续使用以下兼容入口：

| 用途             | Action         | 说明                                         |
| ---------------- | -------------- | -------------------------------------------- |
| 列出工具         | `_list_tools`  | 返回已注册 Tool 列表                         |
| 列出技能兼容映射 | `_list_skills` | 返回旧技能名与新 Tool 映射                   |
| 查看状态         | `_status`      | 返回 Worker 进程状态                         |
| 调用旧技能别名   | `skill_<name>` | 例如 `skill_observe_flow`、`skill_auto_hook` |
| 调用新工具       | `<tool_name>`  | 例如 `observe_flow`、`auto_hook`             |

**示例：**

```bash
# 列出技能兼容映射
curl "http://127.0.0.1:5612/business/invoke?group=default&action=_list_skills"

# 调用旧技能别名
curl -X POST "http://127.0.0.1:5612/business/invoke" ^
  -H "Content-Type: application/json" ^
  -d "{\"group\":\"default\",\"action\":\"skill_observe_flow\",\"params\":{\"url\":\"https://example.com\"}}"

# 调用新工具
curl -X POST "http://127.0.0.1:5612/business/invoke" ^
  -H "Content-Type: application/json" ^
  -d "{\"group\":\"default\",\"action\":\"observe_flow\",\"params\":{\"url\":\"https://example.com\"}}"
```

---

## 内置技能

### observe-flow - 观察流

**类别：** observe

**描述：** 观察模式——收集和分析页面脚本，识别加密和混淆，生成安全风险评估报告。

**使用方法：**

```bash
# 导航到目标页面后执行（自动使用当前页面 URL）
js-reverse call observe_flow

# 或显式指定 URL
js-reverse call observe_flow --url https://example.com
# 旧兼容名
js-reverse call observe-flow --url https://example.com
```

**选项：**

|                        | 选项    | 类型                                                  | 说明 |
| ---------------------- | ------- | ----------------------------------------------------- | ---- |
| `includeDynamic`       | boolean | 包含动态脚本                                          |
| `includeExternal`      | boolean | 包含外部脚本                                          |
| `includeInline`        | boolean | 包含内联脚本                                          |
| `includeServiceWorker` | boolean | 包含 Service Worker                                   |
| `includeWebWorker`     | boolean | 包含 Web Worker                                       |
| `maxFileSize`          | number  | 最大文件大小                                          |
| `maxTotalSize`         | number  | 最大总大小                                            |
| `mode`                 | string  | 模式：`summary` / `priority` / `incremental` / `full` |
| `smartMode`            | boolean | 智能模式                                              |
| `dynamicWaitMs`        | number  | 动态等待时间（毫秒）                                  |
| `priorities`           | array   | 优先级列表                                            |
| `compress`             | boolean | 压缩输出                                              |
| `timeout`              | number  | 超时时间（毫秒）                                      |

**典型工作流：**

1. 启动守护进程并连接浏览器
2. 导航到目标网页
3. 执行 `observe-flow` 收集页面脚本
4. 分析报告中的加密检测和混淆识别结果
5. 根据风险评估制定逆向策略

### auto-hook - 自动 Hook

**类别：** hook

**描述：** 自动注入调试 Hook 和加密库 Hook，并在页面上下文中检测已知加密库（CryptoJS、JSEncrypt、SM-Crypto、forge、WebCrypto）。

**使用方法：**

```bash
# 导航到目标页面后执行（自动使用当前页面）
js-reverse call auto_hook

# 或显式指定 URL
js-reverse call auto_hook --url https://example.com
# 旧兼容名
js-reverse call auto-hook --url https://example.com
```

**预设模式：**

|                 | 预设名                                               | 包含的 Hook  | 适用场景 |
| --------------- | ---------------------------------------------------- | ------------ | -------- |
| `none`          | 最小化 Hook                                          | 轻量调试     |
| `api-signature` | hookFetch, hookXhr, hookCookie                       | API 签名分析 |
| `network-core`  | hookFetch, hookXhr, hookTimers, hookEval, hookCookie | 网络核心分析 |

**选项：**

|                   | 选项    | 类型   | 默认值          | 说明 |
| ----------------- | ------- | ------ | --------------- | ---- |
| `preset`          | string  | `none` | 预设模式        |
| `autoInject`      | boolean | true   | 自动注入        |
| `waitAfterHookMs` | number  | -      | Hook 后等待时间 |
| `useAI`           | boolean | -      | 使用 AI 辅助    |
| `hookCrypto`      | boolean | -      | Hook 加密库     |
| `hookRsa`         | boolean | -      | Hook RSA 加密   |
| `hookSmCrypto`    | boolean | -      | Hook 国密算法   |
| `hookTimers`      | boolean | -      | Hook 定时器     |
| `hookEval`        | boolean | -      | Hook eval       |
| `hookCookie`      | boolean | -      | Hook Cookie     |
| `hookXhr`         | boolean | -      | Hook XHR        |
| `hookFetch`       | boolean | -      | Hook Fetch      |

**典型工作流：**

1. 启动守护进程并导航到目标网页
2. 执行 `auto-hook` 注入调试 Hook
3. 观察网络请求和加密过程
4. 分析 Hook 捕获的数据

### rebuild-bundle - 重建包

**类别：** rebuild

**描述：** 本地复现——构建 Node.js 环境来复现目标代码，支持参数提取。

**使用方法：**

```bash
js-reverse call rebuild-bundle --url https://example.com
# 或
js-reverse call rebuild_bundle --url https://example.com
```

**选项：**

|                       | 选项     | 类型             | 说明 |
| --------------------- | -------- | ---------------- | ---- |
| `targetUrl`           | string   | 目标 URL         |
| `targetFunctionNames` | string[] | 目标函数名列表   |
| `targetKeywords`      | string[] | 目标关键词       |
| `targetUrlPatterns`   | string[] | 目标 URL 模式    |
| `goal`                | string   | 逆向目标描述     |
| `autoGenerate`        | boolean  | 自动生成环境文件 |
| `maxEvidenceItems`    | number   | 最大证据项数量   |
| `taskId`              | string   | 任务 ID          |
| `taskSlug`            | string   | 任务标识         |

**生成的文件：**

- `env.js` - 浏览器环境模拟
- `polyfills.js` - 缺失 API 的 polyfill
- `entry.js` - 入口文件，包含目标函数调用

**典型工作流：**

1. 使用 `observe-flow` 收集页面脚本
2. 使用 `auto-hook` 捕获运行时数据
3. 执行 `rebuild-bundle` 生成本地复现环境
4. 在 Node.js 中运行生成的文件，验证签名逻辑

---

## REPL 模式

REPL 提供了一个交互式命令行界面，可以直接调用工具和兼容技能。

### 启动

```bash
js-reverse repl
```

### 可用命令

```
js-reverse> skill observe-flow --url https://example.com    # 调用技能
js-reverse> tool take_screenshot                            # 调用工具
js-reverse> status                                         # 检查守护进程状态
js-reverse> list-tools                                     # 列出工具和兼容技能
js-reverse> help                                           # 显示帮助
js-reverse> exit                                           # 退出
```

---

## 常见问题

### 如何启动 Chrome Debug 模式？

**macOS：**

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

**Linux：**

```bash
google-chrome --remote-debugging-port=9222
```

**Windows：**

```cmd
chrome.exe --remote-debugging-port=9222
```

> Windows 下使用 `js-reverse.bat` 启动 CLI 时，脚本已自动设置 `chcp 65001`（UTF-8 编码），可避免中文输出乱码。如使用 PowerShell 直接运行 `node build/src/bin/js-reverse.js`，建议先执行 `chcp 65001`。

### 如何查看所有可用工具？

```bash
js-reverse list-tools
```

### 如何使用 JSON 格式输出？

```bash
js-reverse list-tools --json
```

### 如何管理配置？

```bash
js-reverse config --init                      # 初始化配置
js-reverse config --set rpcHost=ws://127.0.0.1:5612  # 设置配置
js-reverse config --get rpcHost            # 获取配置
js-reverse config --list                      # 列出配置来源
```

### 工具总数

本项目共提供 **120+** 个 MCP 工具，覆盖以下领域：

- DOM 操作与页面交互
- 网络请求与 WebSocket 监控
- 调试器控制（断点、单步、源码查看、连续调试）
- Hook 注入（网络、加密、存储、定时器等）
- 代码分析与去混淆
- 本地环境复现
- 反反调试与隐身
- CDP 代理与多页面管理
- 性能分析与截图
- 会话状态持久化
- 配置管理
