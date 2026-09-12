# 客户端配置指南

这份指南按客户端分别给出可直接复制的 MCP 配置示例。

约定：

- 路径统一写成 `/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js`
- 如果你要复用已经打开的浏览器，默认 remote debugging 地址使用 `http://127.0.0.1:9222`

## 最常用完整模板

如果你只是想先快速跑起来，推荐直接使用“接管已打开浏览器 + Gemini API”这一份：

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js",
        "--browserUrl",
        "http://127.0.0.1:9222"
      ]
    }
  }
}
```

适合场景：

- 需要复用本机已登录浏览器
- 使用支持 `mcpServers` JSON 配置格式的客户端

如果你用的是 Codex `config.toml`，直接看下方 “Codex” 小节的完整模板。

## 完整可直接使用示例

### 适用于 `mcpServers` JSON 结构的客户端

这类客户端通常使用如下 JSON 结构配置 MCP server。  
如果你的 Claude / Gemini / Cursor 客户端使用的是 `mcpServers` 配置格式，可以直接参考下面模板。

#### 最小可用

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js"]
    }
  }
}
```

#### 接管已打开浏览器

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js",
        "--browserUrl",
        "http://127.0.0.1:9222"
      ]
    }
  }
}
```

## Claude Code

### 最简单配置

```bash
claude mcp add js-reverse node /ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js
```

### 推荐配置思路

如果你使用的是支持 `mcpServers` JSON 配置的 Claude 客户端，优先直接使用上面的 JSON 模板。  
如果你使用的是 `claude mcp add` 命令行方式，按「接管已打开的 Chrome」小节添加即可。

### 接管已打开的 Chrome

```bash
claude mcp add js-reverse node /ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js -- --browserUrl http://127.0.0.1:9222
```

如果你本地已经固定开着远程调试端口，也可以改用：

```bash
claude mcp add js-reverse node /ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js -- --autoConnect
```

## Cursor

`Settings -> MCP -> New MCP Server`

### 最简单配置

- Command: `node`
- Args: `[/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js]`

### 完整 JSON 示例

如果你的 Cursor 版本支持 JSON 形式的 MCP 配置，可直接参考：

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js",
        "--browserUrl",
        "http://127.0.0.1:9222"
      ]
    }
  }
}
```

### 接管已打开的 Chrome

- Command: `node`
- Args:

```json
[
  "/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js",
  "--browserUrl",
  "http://127.0.0.1:9222"
]
```

## Codex

Codex 使用 `config.toml`。

### 最简单配置

```toml
[mcp_servers.js-reverse]
command = "node"
args = ["/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js"]
```

### 接管已打开的 Chrome

```toml
[mcp_servers.js-reverse]
command = "node"
args = [
  "/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js",
  "--browserUrl",
  "http://127.0.0.1:9222"
]
```

### 自动接管本机浏览器

```toml
[mcp_servers.js-reverse]
command = "node"
args = [
  "/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js",
  "--autoConnect"
]
```

## 配置完成后的验证

无论你用哪个客户端，建议都做一次最小验证：

1. 打开一个已知页面
2. 调用 `list_pages`
3. 调用 `list_scripts`
4. 调用 `list_network_requests`

如果三者都能返回你当前页面对应的信息，说明配置已经基本正确。

代码分析类工具已移除，无需再配置外部 AI；需要分析时按 skill `code-analysis` 用
`collect_code` / `search_in_scripts` / `get_hook_data` 采集证据后自行分析。
