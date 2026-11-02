# 快速开始

这份指南给第一次接触 `browsercli` 的用户使用，目标是在 3 分钟内把 daemon 会话跑起来并调通第一个工具。

## 1. 安装依赖并构建

```bash
npm install
npm run build
```

构建产物：

- `build/src/index.js` — daemon 进程入口（仅此一个入口）
- `build/src/cli/bin/browsercli.js` — `browsercli` 命令

要求 Node `^20.19.0 || ^22.12.0 || >=23`。

## 2. 拉起 daemon 会话

`browsercli` 通过本地命名管道（POSIX 为 unix socket）与 detached daemon 通信。CLI 会按 workspace-hash 在注册表里发现会话；连不上就自动 spawn daemon 并等 stdout 就绪行握手。

```bash
# 拉起或探活当前工作区的会话（首次会自动 spawn daemon）
browsercli open

# 查看会话状态
browsercli status
```

不需要手动 `npm run start`：daemon 由 CLI 按需拉起。

## 3. 连接浏览器

两种常见方式：

- **让 browsercli 自己管理浏览器** — 最简单，适合首次试用
- **接管你已经打开的 Chrome** — 适合复用登录态、验证码、人机校验场景

```bash
# 查看当前连接状态
browsercli browser status

# 默认启动本地浏览器
browsercli browser connect

# 接管已打开的 Chrome（CDP 端口）
browsercli browser connect --browser-url "http://127.0.0.1:9222"

# 自动探测 chrome://inspect/#remote-debugging 暴露的实例
browsercli browser connect --auto-connect
```

更多连接方式（`--channel`、`--executable-path`、`--cloak`、`--user-data-dir` 等）见
[`browser-connection.md`](./browser-connection.md)。

## 4. 列出并调用工具

```bash
# 列出全部可用工具
browsercli list-tools

# 调用工具
browsercli call <tool_name> [--param value] [--data <json>] [--file <params.json>]
```

复杂或多行 JavaScript 请先存成文件再传，避免 shell 转义破坏脚本：

```bash
browsercli call evaluate_script --file ./probe.js
```

## 5. 建议的第一条验证命令

连接成功后，优先验证下面几类工具：

```bash
browsercli call list_pages
browsercli call list_network_requests
browsercli call list_scripts
```

能正常看到当前页面、请求和脚本，说明基础链路已经通了。

## 6. 代码分析不再内置 LLM

仓库已彻底移除 LLM 集成（`src/services/`、`understand_code` / `summarize_code` /
`risk_panel` / `analyze_target` / `detect_crypto` / `session_analyze_purified` /
`session_generate_report` 工具、config 中的 openai/llmProvider、Web 控制台均已删除）。
不再需要配置任何 AI provider。

需要代码理解、摘要、加密识别或风险评分时，用基础工具采集证据后由调用方 Agent
自行分析：

- `collect_code` / `search_in_scripts` / `get_script_source` / `get_hook_data`
- 完整工具清单见 [`../reference/tool-reference.md`](../reference/tool-reference.md)
