# 快速开始

这份指南给第一次接触 `JSReverser-MCP` 的用户使用，目标是在 3 分钟内把服务跑起来。

## 1. 安装依赖并构建

```bash
npm install
npm run build
```

构建完成后入口文件为：

```bash
build/src/index.js
```

## 2. 最简单启动方式

如果你只是想先确认 MCP 服务可以工作，可以直接启动：

```bash
npm run start
```

这种方式适合：

- 先验证 MCP 服务能不能正常启动
- 先熟悉工具列表
- 暂时不需要复用已登录浏览器

## 3. 选择浏览器连接方式

常见有两种：

- 方式 A：让 MCP 自己管理浏览器
  - 最简单，适合首次试用
- 方式 B：接管你已经打开的 Chrome
  - 适合需要复用登录态、验证码、人机校验场景

如果你想接管已打开的浏览器，请看：

- `docs/guides/browser-connection.md`

## 4. 配置客户端

按你使用的客户端继续看：

- `docs/guides/client-configuration.md`

## 5. 建议的第一条验证命令

连接成功后，优先验证下面几类工具：

- `list_pages`
- `list_network_requests`
- `list_scripts`

能正常看到当前页面、请求和脚本，说明基础链路已经通了。

## 6. 代码分析不再内置 LLM

仓库已彻底移除 LLM 集成（`src/services/`、`understand_code` / `summarize_code` /
`risk_panel` / `analyze_target` / `detect_crypto` / `session_analyze_purified` /
`session_generate_report` 工具、config 中的 openai/llmProvider、Web 控制台的 LLM
配置面板与 AI 流量分析页均已删除）。不再需要配置任何 AI provider。

需要代码理解、摘要、加密识别或风险评分时，用基础工具采集证据后由调用方 Agent
自行分析：

- `collect_code` / `search_in_scripts` / `get_script_source` / `get_hook_data`
- 分析口径与提示词：skill `code-analysis`
- 目标级与会话级工作流：skill `target-analysis`
