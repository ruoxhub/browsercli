# 多实例会话隔离配置指南

## 问题背景

当多个 MCP server 实例连接到同一个 Chrome 浏览器实例时（使用相同的 `browserURL` 或 `wsEndpoint`），会出现页面抢占问题：

- Server 实例 A 选择 page1 进行操作
- Server 实例 B 也选择 page1 进行操作
- 两个实例的状态（选中的页面、网络请求、控制台消息等）会互相覆盖

## 解决方案：页面标签隔离

本项目实现了基于会话 ID 的页面标签隔离机制：

1. 每个 server 实例配置唯一的 `sessionId`
2. 新创建的页面会自动打上标签：`mcp-session-{sessionId}`
3. 每个 server 实例只能看到和管理带有自己标签的页面
4. 页面关闭时自动移除标签

## 配置方式

### 方式一：使用环境变量（推荐）

启动每个 server 实例时设置不同的 `MCP_SESSION_ID`：

```bash
# 终端 1 - 会话 A
MCP_SESSION_ID=session-a npx chrome-devtools-mcp \
  --browserUrl http://127.0.0.1:9222

# 终端 2 - 会话 B
MCP_SESSION_ID=session-b npx chrome-devtools-mcp \
  --browserUrl http://127.0.0.1:9222
```

### 方式二：使用命令行参数

```bash
# 终端 1 - 会话 A
npx chrome-devtools-mcp \
  --browserUrl http://127.0.0.1:9222 \
  --sessionId session-a

# 终端 2 - 会话 B
npx chrome-devtools-mcp \
  --browserUrl http://127.0.0.1:9222 \
  --sessionId session-b
```

### 方式三：使用隔离模式（最简单）

如果不需要共享浏览器实例，最简单的方案是使用 `--isolated` 参数，每个实例有独立的用户数据目录：

```bash
# 终端 1
npx chrome-devtools-mcp --isolated

# 终端 2
npx chrome-devtools-mcp --isolated
```

这种方式完全隔离，不需要配置 sessionId，但每个实例会启动独立的浏览器进程。

## 工作流程

### 1. 启动多实例

```bash
# 确保 Chrome 已启动并开启远程调试
chrome --remote-debugging-port=9222

# 启动 server 实例 A
MCP_SESSION_ID=alice npx chrome-devtools-mcp --browserUrl http://127.0.0.1:9222

# 启动 server 实例 B
MCP_SESSION_ID=bob npx chrome-devtools-mcp --browserUrl http://127.0.0.1:9222
```

### 2. 各实例独立操作页面

- Alice 的客户端创建新页面 → 页面自动标记为 `mcp-session-alice`
- Bob 的客户端创建新页面 → 页面自动标记为 `mcp-session-bob`
- Alice 只能看到自己创建的页面
- Bob 只能看到自己创建的页面

### 3. 会话恢复

如果浏览器意外关闭后重启，会话标签会从 `localStorage` 恢复：

- 标签存储在 `localStorage['mcp-session-tags']`
- 页面级临时标签存储在 `sessionStorage['mcp-session-id']`

## 技术实现

### SessionManager 类

```typescript
// src/SessionManager.ts
export class SessionManager {
  // 为页面添加会话标签
  async tagPage(page: Page): Promise<void>

  // 移除页面的会话标签
  async untagPage(page: Page): Promise<void>

  // 检查页面是否属于当前会话
  async ownsPage(page: Page): Promise<boolean>

  // 获取当前会话拥有的所有页面
  async getOwnedPages(): Promise<Page[]>

  // 创建带有会话标签的新页面
  async newPage(): Promise<Page>
}
```

### 标签存储机制

| 存储类型 | 键名 | 作用 | 生命周期 |
|---------|------|------|---------|
| `sessionStorage` | `mcp-session-id` | 页面级临时标签 | 页面关闭后清除 |
| `localStorage` | `mcp-session-tags` | 持久化标签映射 | 跨页面刷新持久化 |

## 注意事项

1. **标签可见性**：页面标签通过 JavaScript 注入，只在页面加载后生效
2. **恢复延迟**：浏览器重启后，标签恢复可能需要几秒钟
3. **共享页面**：没有标签的页面（如手动打开的页面）对所有会话可见
4. **资源消耗**：多实例会占用更多内存，每个实例有自己的 Context 和收集器

## 常见问题

### Q: 可以不共享浏览器实例吗？

A: 可以，使用 `--isolated` 参数启动，每个实例有独立的用户数据目录，完全隔离。

### Q: 如果忘记设置 sessionId 会怎样？

A: 如果不设置 `sessionId`，该实例可以看到所有页面，但也会与其他未设置 sessionId 的实例共享页面状态。

### Q: 会话标签会影响页面性能吗？

A: 影响极小。标签只是简单的 sessionStorage/localStorage 操作，不会显著影响页面性能。

### Q: 如何清理会话标签？

A: 关闭页面时会自动移除标签。如需手动清理，可以在浏览器中执行：
```javascript
localStorage.removeItem('mcp-session-tags');
sessionStorage.removeItem('mcp-session-id');
```

## 示例配置

### Claude Code 配置

在 `.claude/settings.json` 中配置：

```json
{
  "mcpServers": {
    "js-reverse-mcp": {
      "command": "npx",
      "args": ["chrome-devtools-mcp", "--browserUrl", "http://127.0.0.1:9222"],
      "env": {
        "MCP_SESSION_ID": "claude-session-1"
      }
    }
  }
}
```

### Cursor 配置

在 `.cursor/mcp.json` 中配置：

```json
{
  "mcpServers": {
    "js-reverse-mcp": {
      "command": "npx",
      "args": ["chrome-devtools-mcp", "--browserUrl", "http://127.0.0.1:9222"],
      "env": {
        "MCP_SESSION_ID": "cursor-session-1"
      }
    }
  }
}
```

## 相关文件

- `src/SessionManager.ts` - 会话管理器实现
- `src/McpContext.ts` - 支持页面标签隔离的上下文
- `src/main.ts` - 支持 sessionId 参数和环境变量
- `src/cli.ts` - 命令行参数定义
