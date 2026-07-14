# HTTP 模式使用指南

## 概述

HTTP 模式允许 MCP 服务器通过 HTTP 端口提供 Streamable HTTP 传输，支持远程连接和 Web 集成。

## 快速开始

### 基础启动命令

```bash
# 默认配置 (http://127.0.0.1:3000/mcp)
npm run start -- --http

# 自定义端口
npm run start -- --http --port 8080

# 允许外部访问
npm run start -- --http --host 0.0.0.0 --port 3000
```

## 参数说明

| 参数     | 类型    | 默认值    | 说明                 |
| -------- | ------- | --------- | -------------------- |
| `--http` | boolean | false     | 启用 HTTP 服务器模式 |
| `--port` | number  | 3000      | HTTP 监听端口        |
| `--host` | string  | 127.0.0.1 | 绑定主机地址         |

## 与其他参数组合使用

### 浏览器相关

```bash
# 连接现有 Chrome 实例
npm run start -- --http --browserUrl http://127.0.0.1:9222

# WebSocket 端点连接
npm run start -- --http --wsEndpoint ws://127.0.0.1:9222/devtools/browser/abc123

# 无头模式
npm run start -- --http --headless

# 指定 Chrome 通道
npm run start -- --http --channel beta
npm run start -- --http --channel canary
npm run start -- --http --channel dev

# 自定义 Chrome 路径
npm run start -- --http --executablePath /path/to/chrome
```

### 数据库相关

```bash
# PostgreSQL 存储
npm run start -- --http --databaseUrl postgresql://user:pass@localhost:5432/dbname
```

### 网络相关

```bash
# 代理服务器
npm run start -- --http --proxyServer http://proxy.example.com:8080

# 禁用网络工具（减少资源占用）
npm run start -- --http --no-category-network
```

### 会话隔离

```bash
# 多实例场景下的会话隔离
npm run start -- --http --sessionId my-session-id
```

## 常见使用场景

### 场景 1：本地开发

```bash
# 仅本机访问，默认端口
npm run start -- --http --host 127.0.0.1 --port 3000
```

### 场景 2：团队共享服务

```bash
# 允许局域网访问
npm run start -- --http --host 0.0.0.0 --port 3000

# 防火墙开放端口 3000
# Windows: netsh advfirewall firewall add rule name="MCP HTTP" dir=in action=allow protocol=TCP localport=3000
# Linux: sudo ufw allow 3000/tcp
```

### 场景 3：Docker 容器

```bash
# Dockerfile 示例
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY build ./build
EXPOSE 3000
CMD ["npm", "run", "start", "--", "--http", "--host", "0.0.0.0", "--port", "3000"]
```

```bash
# 运行容器
docker run -d -p 3000:3000 --name mcp-server your-image
```

### 场景 4：远程 Chrome 调试

```bash
# 1. 在远程机器启动 Chrome
# chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0

# 2. 本地启动 MCP 服务器连接
npm run start -- --http --browserUrl http://remote-host:9222
```

### 场景 5：多实例部署

```bash
# 实例 1 - 端口 3001
npm run start -- --http --port 3001 --sessionId instance-1

# 实例 2 - 端口 3002
npm run start -- --http --port 3002 --sessionId instance-2

# 实例 3 - 端口 3003（无头模式）
npm run start -- --http --port 3003 --headless --sessionId instance-3
```

## 客户端配置

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

1. 选择 "Streamable HTTP" 连接类型
2. 输入 URL: `http://localhost:3000/mcp`
3. 点击连接

### Claude Code

```bash
# 添加服务器
claude mcp add --transport http js-reverse http://localhost:3000/mcp

# 查看已添加的服务器
claude mcp list

# 移除服务器
claude mcp remove js-reverse
```

### VS Code

在 `settings.json` 中添加：

```json
{
  "mcp.servers": {
    "js-reverse": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Cursor

**方式 1：点击链接自动添加**

```
cursor://anysphere.cursor-deeplink/mcp/install?name=js-reverse&config=eyJ1cmwiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAvbWNwIn0=
```

**方式 2：手动配置**
在 Cursor 设置中找到 MCP Servers，添加：

```json
{
  "js-reverse": {
    "url": "http://localhost:3000/mcp"
  }
}
```

### Windsurf

在 Windsurf 设置中添加 MCP 服务器：

```json
{
  "name": "js-reverse",
  "type": "http",
  "url": "http://localhost:3000/mcp"
}
```

## 安全考虑

### 1. 访问控制

HTTP 模式默认不启用身份验证。如果在公网暴露，建议：

- 使用反向代理（Nginx/Apache）添加 Basic Auth
- 配置防火墙只允许特定 IP
- 使用 VPN 或 SSH 隧道

### 2. CORS 配置

服务器默认启用 CORS 允许所有来源访问（便于浏览器客户端连接）。
如需限制，可修改 `src/main.ts` 中的 CORS 设置：

```typescript
res.setHeader('Access-Control-Allow-Origin', 'https://your-domain.com');
```

### 3. 敏感信息

- 不要在公网暴露 MCP 服务器
- 使用 HTTPS 反向代理加密传输
- 避免传输敏感凭证

## 故障排查

### 端口被占用

```bash
# Windows - 查看端口占用
netstat -ano | findstr :3000

# Linux/Mac - 查看端口占用
lsof -i :3000

# 更换端口
npm run start -- --http --port 8080
```

### 无法远程访问

1. 确认 host 设置为 `0.0.0.0`
2. 检查防火墙规则
3. 确认网络安全组/ACL 配置

### 连接超时

1. 检查服务器是否正常运行
2. 验证网络连通性：`curl http://host:port/mcp`
3. 查看服务器日志确认无错误

### 会话丢失

HTTP 模式支持有状态和无状态两种：

- **有状态**: 使用 `mcp-session-id` 头复用连接
- **无状态**: 每请求创建新 transport

客户端应正确处理会话 ID。

## 性能优化

### 1. 连接复用

客户端应缓存会话 ID，避免每次请求都重新初始化。

### 2. 请求批处理

尽可能合并多个工具调用为单个请求。

### 3. 资源限制

对于高负载场景，考虑：

- 限制并发连接数
- 设置请求超时
- 使用反向代理做负载均衡

## API 端点

| 端点   | 方法   | 说明                     |
| ------ | ------ | ------------------------ |
| `/mcp` | POST   | 主要通信端点（JSON-RPC） |
| `/mcp` | GET    | SSE 流式响应（会话通知） |
| `/mcp` | DELETE | 终止会话                 |

## JSON-RPC 示例

### 初始化请求

```json
POST /mcp
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "my-client",
      "version": "1.0.0"
    }
  }
}
```

### 调用工具

```json
POST /mcp
Content-Type: application/json
Mcp-Session-Id: <session-id>

{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "list_scripts",
    "arguments": {}
  }
}
```

### 响应示例

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "脚本列表内容..."
      }
    ]
  }
}
```

## 相关文档

- [MCP 规范 - Streamable HTTP](https://modelcontextprotocol.io/specification/latest)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
- [多实例隔离指南](./multi-instance-isolation.md)
