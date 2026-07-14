# LLM Provider 配置指南

## 概述

本项目支持接入外部 LLM 作为"分析增强层"，用于代码理解、反混淆、加密算法识别等场景。

## 支持的 Provider

| Provider  | 环境变量前缀 | 默认模型                   |
| --------- | ------------ | -------------------------- |
| OpenAI    | `OPENAI_`    | gpt-4o                     |
| Anthropic | `ANTHROPIC_` | claude-3-5-sonnet-20241022 |
| Gemini    | `GEMINI_`    | gemini-2.0-flash-exp       |

## 核心配置

### 1. 选择 Provider

```bash
# 三选一：openai / anthropic / gemini
DEFAULT_LLM_PROVIDER=anthropic
```

### 2. 配置 API Key

**OpenAI / Claude:**

```bash
DEFAULT_LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
ANTHROPIC_BASE_URL=  # 可选，使用自定义代理时填写
```

```bash
DEFAULT_LLM_PROVIDER=openai
OPENAI_API_KEY=sk-xxxxxxxx
OPENAI_MODEL=gpt-4o
OPENAI_BASE_URL=  # 可选，如 https://api.proxy.com/v1
```

**Gemini (两种模式):**

模式 A - API 方式:

```bash
DEFAULT_LLM_PROVIDER=gemini
GEMINI_API_KEY=AIzaSyxxxxxxxxxx
GEMINI_MODEL=gemini-2.0-flash-exp
```

模式 B - 本地 CLI 方式 (无需 API Key):

```bash
DEFAULT_LLM_PROVIDER=gemini
GEMINI_CLI_PATH=gemini-cli  # gemini-cli 命令路径
```

## 配置方式

### 方式 1: MCP 客户端配置 (推荐)

**Claude Code:**

```toml
# ~/.claude/settings.toml
[mcp_servers.js-reverse.env]
DEFAULT_LLM_PROVIDER = "anthropic"
ANTHROPIC_API_KEY = "sk-ant-xxx"
ANTHROPIC_MODEL = "claude-3-5-sonnet-20241022"
```

**JSON 格式配置:**

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": ["/path/to/build/src/index.js"],
      "env": {
        "DEFAULT_LLM_PROVIDER": "anthropic",
        "ANTHROPIC_API_KEY": "sk-ant-xxx",
        "ANTHROPIC_MODEL": "claude-3-5-sonnet-20241022"
      }
    }
  }
}
```

### 方式 2: .env 文件

在项目根目录创建 `.env` 文件:

```bash
# .env
DEFAULT_LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
```

适用于直接本地运行 `npm run start` 的场景。

### 方式 3: 命令行环境变量

```bash
# Linux/Mac
export DEFAULT_LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-xxx
npm run start

# Windows PowerShell
$env:DEFAULT_LLM_PROVIDER="anthropic"
$env:ANTHROPIC_API_KEY="sk-ant-xxx"
npm run start

# 单行启动
DEFAULT_LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=xxx npm run start
```

### 方式 4: HTTP 模式组合配置

```bash
npm run start -- --http --port 3000 \
  --env DEFAULT_LLM_PROVIDER=anthropic \
  --env ANTHROPIC_API_KEY=sk-ant-xxx
```

或在 MCP 客户端配置中:

```json
{
  "mcpServers": {
    "js-reverse-http": {
      "command": "node",
      "args": ["/path/to/build/src/index.js", "--http", "--port", "3000"],
      "env": {
        "DEFAULT_LLM_PROVIDER": "anthropic",
        "ANTHROPIC_API_KEY": "sk-ant-xxx"
      }
    }
  }
}
```

## 完整配置示例

### 示例 1: 使用 Claude (推荐)

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": ["D:/JSReverser-MCP/build/src/index.js"],
      "env": {
        "DEFAULT_LLM_PROVIDER": "anthropic",
        "ANTHROPIC_API_KEY": "sk-ant-xxx",
        "ANTHROPIC_MODEL": "claude-3-5-sonnet-20241022"
      }
    }
  }
}
```

### 示例 2: 使用 OpenAI

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": ["D:/JSReverser-MCP/build/src/index.js"],
      "env": {
        "DEFAULT_LLM_PROVIDER": "openai",
        "OPENAI_API_KEY": "sk-xxx",
        "OPENAI_MODEL": "gpt-4o"
      }
    }
  }
}
```

### 示例 3: 使用 Gemini API

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": ["D:/JSReverser-MCP/build/src/index.js"],
      "env": {
        "DEFAULT_LLM_PROVIDER": "gemini",
        "GEMINI_API_KEY": "AIzaSyxxx",
        "GEMINI_MODEL": "gemini-2.0-flash-exp"
      }
    }
  }
}
```

### 示例 4: 使用 Gemini CLI (无 API)

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": ["D:/JSReverser-MCP/build/src/index.js"],
      "env": {
        "DEFAULT_LLM_PROVIDER": "gemini",
        "GEMINI_CLI_PATH": "gemini-cli"
      }
    }
  }
}
```

### 示例 5: 组合 HTTP + LLM

```json
{
  "mcpServers": {
    "js-reverse-http": {
      "command": "node",
      "args": [
        "D:/JSReverser-MCP/build/src/index.js",
        "--http",
        "--port",
        "3000"
      ],
      "env": {
        "DEFAULT_LLM_PROVIDER": "anthropic",
        "ANTHROPIC_API_KEY": "sk-ant-xxx",
        "ANTHROPIC_MODEL": "claude-3-5-sonnet-20241022"
      }
    }
  }
}
```

## 模型选择建议

### 代码理解/反混淆

| 任务类型     | 推荐模型                   | 说明              |
| ------------ | -------------------------- | ----------------- |
| 代码语义理解 | claude-3-5-sonnet          | 代码理解能力最强  |
| 复杂混淆还原 | claude-3-5-sonnet          | 长上下文 + 强推理 |
| 加密算法识别 | gpt-4o / claude-3-5-sonnet | 两者效果接近      |
| 快速分析     | gemini-2.0-flash-exp       | 速度快，成本低    |

### 模型配置参考

```bash
# Claude 系列
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022  # 推荐
ANTHROPIC_MODEL=claude-3-opus-20240229      # 最强推理
ANTHROPIC_MODEL=claude-3-haiku-20240307     # 快速/便宜

# OpenAI 系列
OPENAI_MODEL=gpt-4o              # 推荐
OPENAI_MODEL=gpt-4-turbo         # 替代选择
OPENAI_MODEL=gpt-3.5-turbo       # 快速/便宜

# Gemini 系列
GEMINI_MODEL=gemini-2.0-flash-exp        # 推荐
GEMINI_MODEL=gemini-1.5-pro              # 长上下文
GEMINI_MODEL=gemini-1.5-flash            # 快速/便宜
```

## 自定义 Base URL

如果使用代理或私有部署:

```bash
# OpenAI 兼容代理
OPENAI_BASE_URL=https://api.proxy.com/v1

# Claude 兼容代理
ANTHROPIC_BASE_URL=https://api.proxy.com/v1

# Gemini 通常不需要，因为走 Google API
```

## 功能依赖说明

### 强依赖 LLM 的功能

- `understand_code` - 代码语义理解、业务逻辑提取
- 复杂混淆代码的反混淆建议
- 加密算法的深度识别

### 可选使用 LLM 的功能

- `detect_crypto` - 传 `useAI=true` 时启用
- `analyze_target` - 传 `useAI=true` 时启用更深的 AI 辅助

### 不依赖 LLM 的功能

以下功能无需配置 LLM 即可使用:

- 浏览器接管/页面调试
- Hook / 断点 / Console
- Network / WebSocket 分析
- 本地 AST 分析
- 基于规则的加密算法检测
- 代码去混淆 (本地管线)

## 验证配置

启动后查看日志确认 LLM 配置是否生效:

```bash
npm run start

# 成功时会看到类似日志:
# [LLMService] Initialized with provider: anthropic
# [LLMService] Model: claude-3-5-sonnet-20241022
```

## 常见问题

### Q1: 配置后不生效？

1. 确认 `DEFAULT_LLM_PROVIDER` 设置正确
2. 检查对应 provider 的 API Key 是否正确
3. 查看启动日志确认初始化信息
4. 尝试调用 `understand_code` 等依赖 LLM 的工具测试

### Q2: 多个 Provider 配置冲突？

```bash
# 错误示例：配置了多个但没有指定 DEFAULT
OPENAI_API_KEY=xxx
ANTHROPIC_API_KEY=xxx
GEMINI_API_KEY=xxx
# 必须指定使用哪个
DEFAULT_LLM_PROVIDER=anthropic
```

### Q3: Gemini CLI 路径找不到？

```bash
# 确认 gemini-cli 已安装且在 PATH 中
which gemini-cli

# 或使用绝对路径
GEMINI_CLI_PATH=/usr/local/bin/gemini-cli
```

### Q4: 使用代理配置？

```bash
# OpenAI/Claude 兼容代理
OPENAI_BASE_URL=https://api.your-proxy.com/v1
ANTHROPIC_BASE_URL=https://api.your-proxy.com/v1

# 系统级代理 (Node.js 会读取)
export HTTP_PROXY=http://proxy:8080
export HTTPS_PROXY=http://proxy:8080
```

### Q5: HTTP 模式下如何配置？

HTTP 模式下配置方式相同，通过 MCP 客户端的 `env` 字段传递:

```json
{
  "mcpServers": {
    "js-reverse-http": {
      "command": "node",
      "args": ["/path/to/index.js", "--http", "--port", "3000"],
      "env": {
        "DEFAULT_LLM_PROVIDER": "anthropic",
        "ANTHROPIC_API_KEY": "sk-ant-xxx"
      }
    }
  }
}
```

## 相关文档

- [HTTP 模式配置](./http-mode.md)
- [客户端配置](./client-configuration.md)
- [环境搭建指南](./getting-started.md)
