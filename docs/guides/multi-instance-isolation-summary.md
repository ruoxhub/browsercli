# 多客户端页面抢占问题修复总结

## 问题描述

当多个 MCP server 实例连接到同一个 Chrome 浏览器实例时（使用相同的 `--browserUrl` 或 `--wsEndpoint`），会出现页面状态抢占问题：

- Server A 选择 page1 进行操作
- Server B 也选择 page1 进行操作
- 两个实例的 `#selectedPage` 状态互相覆盖，导致操作非预期的页面

## 解决方案

实现了基于**会话 ID 的页面标签隔离机制**：

1. 每个 server 实例配置唯一的 `sessionId`
2. 新创建的页面自动打上会话标签
3. 每个实例只能看到和管理带有自己标签的页面
4. 页面关闭时自动移除标签

## 修改的文件

### 新增文件

| 文件                                      | 说明                                             |
| ----------------------------------------- | ------------------------------------------------ |
| `src/SessionManager.ts`                   | 会话管理器，处理页面标签的添加、移除和所有权检查 |
| `docs/guides/multi-instance-isolation.md` | 多实例配置指南文档                               |

### 修改文件

| 文件                | 修改内容                                                         |
| ------------------- | ---------------------------------------------------------------- |
| `src/McpContext.ts` | 添加 `sessionId` 选项，集成 SessionManager 实现页面隔离          |
| `src/main.ts`       | 支持从 `MCP_SESSION_ID` 环境变量或 `--sessionId` 参数读取会话 ID |
| `src/cli.ts`        | 添加 `sessionId` 命令行参数                                      |

## 使用方式

### 方式一：环境变量（推荐）

```bash
# 终端 1 - 会话 A
MCP_SESSION_ID=session-a npx chrome-devtools-mcp --browserUrl http://127.0.0.1:9222

# 终端 2 - 会话 B
MCP_SESSION_ID=session-b npx chrome-devtools-mcp --browserUrl http://127.0.0.1:9222
```

### 方式二：命令行参数

```bash
npx chrome-devtools-mcp --browserUrl http://127.0.0.1:9222 --sessionId my-session
```

### 方式三：隔离模式（最简单）

```bash
# 每个实例完全隔离，不需要 sessionId
npx chrome-devtools-mcp --isolated
```

## 技术实现

### SessionManager 核心方法

```typescript
class SessionManager {
  // 单例模式，按 sessionId 返回实例
  static getInstance(sessionId: string, browser: Browser): SessionManager;

  // 为页面添加会话标签
  async tagPage(page: Page): Promise<void>;

  // 移除页面的会话标签
  async untagPage(page: Page): Promise<void>;

  // 检查页面是否属于当前会话
  async ownsPage(page: Page): Promise<boolean>;

  // 获取当前会话拥有的所有页面
  async getOwnedPages(): Promise<Page[]>;

  // 创建带有会话标签的新页面
  async newPage(): Promise<Page>;

  // 从 localStorage 恢复会话标签（浏览器重启后）
  async restoreSessionTags(): Promise<void>;
}
```

### 标签存储机制

| 存储类型         | 键名               | 作用           | 生命周期         |
| ---------------- | ------------------ | -------------- | ---------------- |
| `sessionStorage` | `mcp-session-id`   | 页面级临时标签 | 页面关闭后清除   |
| `localStorage`   | `mcp-session-tags` | 持久化标签映射 | 跨页面刷新持久化 |

## 验证结果

### 构建验证

```bash
npm run build  # 成功
```

### 测试验证

```bash
npm test  # 383 个测试通过，7 个失败为已有问题（与本次修改无关）
```

## 兼容性

- **向后兼容**：不设置 `sessionId` 时行为与原来一致
- **单实例场景**：无需任何配置即可正常使用
- **多实例场景**：配置不同 `sessionId` 即可实现隔离

## 后续建议

1. **推荐用例**：在 Claude Code、Cursor 等编辑器的 MCP 配置中设置唯一的 `sessionId`
2. **文档更新**：已将使用指南添加到 `docs/guides/multi-instance-isolation.md`
3. **可选测试**：可以在实际多客户端场景中验证页面隔离效果

## 示例配置

### Claude Code 配置

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
