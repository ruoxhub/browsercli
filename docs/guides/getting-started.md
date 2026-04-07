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

## 6. 可选：配置外部 AI 分析能力

如果你要使用 `understand_code`，或者希望 `deobfuscate_code` / `detect_crypto` 拿到更强的 AI 辅助结果，优先在 MCP server 配置里通过 `env` 传入环境变量。

例如在支持 `env` 的 MCP 客户端里，传入：

```toml
[mcp_servers.js-reverse.env]
DEFAULT_LLM_PROVIDER = "gemini"
GEMINI_API_KEY = "your_key"
GEMINI_MODEL = "gemini-2.0-flash-exp"
```

如果你是直接在项目目录本地运行 `npm run start` 或 `node build/src/index.js`，再使用 `.env`：

```bash
DEFAULT_LLM_PROVIDER=gemini

# OpenAI
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o

# Anthropic / Claude
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# Gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash-exp
GEMINI_CLI_PATH=gemini-cli
```

使用建议：

- 只想跑核心逆向链路，不配也可以
- 要用 `understand_code`，建议先配一个 provider
- `detect_crypto` 只有在传 `useAI=true` 时才会启用 AI 增强
- `gemini` 没有 `GEMINI_API_KEY` 时，会尝试走本地 CLI
