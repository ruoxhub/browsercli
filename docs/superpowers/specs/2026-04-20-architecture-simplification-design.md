# 架构简化设计：合并 MCP 层，消除冗余连接

> 日期：2026-04-20  
> 状态：设计阶段  
> 范围：进程架构 + 工具注册 + IPC 连接  

## 1. 问题陈述

当前 JSReverser-MCP 的进程架构存在三层冗余：

```
Claude Code ──stdio──→ js-reverse-mcp ──fork──→ src/index.ts ──import──→ daemon.ts ──→ Tools
                         (桥接层)           (空壳)                (实际逻辑)
```

其中 `js-reverse-mcp` 和 `src/index.ts` 两个环节无实质逻辑，仅做进程转发和模块导入。这导致：

1. **不必要的进程层级**：MCP 客户端请求需经过 fork 子进程 → 空壳导入 → 才到达实际处理逻辑
2. **双重工具注册**：CLI 端 `src/cli/tools-meta.ts` 硬编码 100+ 条空 schema，Daemon 端 `ToolRegistry` 又独立注册 60+ 工具，两处维护
3. **IPC 连接浪费**：`sendCommand()` 每次新建 Socket 连接，REPL 模式下频繁创建/销毁
4. **用户核心痛点**：CLI 调用工具路径不直观，中间环节多

## 2. 设计目标

- **消除空壳进程**：MCP Server 直接内嵌到 Daemon 进程，不再 fork 子进程
- **单一工具注册来源**：删除 CLI 端 `TOOLS_META`，工具定义只在 `ToolRegistry`
- **优化 IPC 连接**：REPL 模式复用持久连接
- **保持向后兼容**：CLI 命令语法不变，MCP 客户端连接方式微调

## 3. 方案选择

### 评估的 3 个方案

| 方案 | 核心思路 | 改动量 | 风险 | 效果 |
|------|----------|--------|------|------|
| **A: 合并 MCP 层** | Daemon 直接暴露 MCP stdio transport | 小 | 低 | 消除空壳进程 + 双重注册 |
| B: 移除 IPC 层 | CLI 嵌入 Daemon 进程内调用 | 中 | 中 | 消除 IPC 延迟，但破坏 CLI/Daemon 解耦 |
| C: 全面重构 | 拆分 God Object + 统一注册 + 扁平化 | 大 | 高 | 最彻底，但周期长 |

**选择方案 A**：性价比最高，直接解决用户痛点"减少不必要的连接"，可增量演进到 B/C。

## 4. 详细设计

### 4.1 进程架构简化

**改动前：**

```
Claude Code ──stdio──→ js-reverse-mcp (fork src/index.ts) ──→ daemon.ts ──→ Tools
CLI ──socket──→ daemon.ts ──→ Tools
```

**改动后：**

```
Claude Code ──stdio──→ daemon.ts (MCP stdio transport) ──→ Tools
CLI ──socket──→ daemon.ts (Unix Socket server) ──→ Tools
```

**实现方式：**

`daemon.ts` 启动时根据参数选择模式：

```typescript
// src/daemon/daemon.ts 新增逻辑
async function main() {
  const args = parseDaemonArgs();
  
  // 启动浏览器连接（两种模式都需要）
  await ensureBrowserConnection(args);
  
  if (args.mcpMode) {
    // MCP 模式：stdio transport，供 AI 工具直接连接
    const transport = new StdioServerTransport();
    const server = new McpServer({ name: 'js-reverser', version: '1.0' });
    // 注册所有工具到 MCP server
    await registerToolsToMcpServer(server);
    await server.connect(transport);
  } else {
    // Daemon 模式：Unix Socket server，供 CLI 连接
    await startSocketServer(args);
  }
}
```

`js-reverse-mcp` 启动脚本简化为：

```bash
# package.json bin
"js-reverse-mcp": "node --experimental-strip-types src/daemon/daemon.ts --mcp-mode"
```

不再需要 fork 子进程。

### 4.2 双重工具注册清理

**删除文件：** `src/cli/tools-meta.ts`（约 500 行硬编码工具元数据）

**改动：** `src/cli/commands/tool-dispatcher.ts`

```typescript
// 改动前：本地验证工具存在
const toolMeta = getToolMeta(toolName);
if (!toolMeta) {
  errorOutput(`Unknown tool: ${toolName}`);
  return;
}

// 改动后：直接发送给 daemon，daemon 端验证
const result = await sendCommand({
  method: 'invoke_tool',
  tool: toolName,
  args: parsedArgs,
});
if (!result.success && result.error?.includes('not found')) {
  errorOutput(`Unknown tool: ${toolName}`);
  return;
}
```

**改动：** `src/cli/commands/list-tools.ts`

```typescript
// 改动前：本地 TOOLS_META
const tools = TOOLS_META;

// 改动后：从 daemon 获取
const result = await sendCommand({ method: 'list_tools' });
const tools = JSON.parse(result.result || '[]');
```

### 4.3 IPC 连接优化

**改动：** `src/daemon/client.ts` 新增持久连接方法

```typescript
// 新增：持久连接类
export class DaemonConnection {
  private socket: net.Socket | null = null;
  
  async connect(): Promise<void> {
    this.socket = await createConnection(getSocketPath());
    // 保持连接，不关闭
  }
  
  async sendCommand(msg: DaemonMessage): Promise<DaemonResponse> {
    if (!this.socket) await this.connect();
    return sendOnSocket(this.socket, msg);
  }
  
  disconnect(): void {
    this.socket?.end();
    this.socket = null;
  }
}
```

**改动：** `src/cli/commands/repl.ts`

```typescript
// REPL 会话使用持久连接
const conn = new DaemonConnection();
await conn.connect();

// REPL 循环中使用 conn.sendCommand()
// 退出时 conn.disconnect()
```

### 4.4 src/index.ts 处理

`src/index.ts` 当前仅包含：

```typescript
import './daemon/daemon.js';
```

**决策：删除此文件。** 它在 `js-reverse-mcp` fork 模式下作为子进程入口，但新架构中不再需要 fork，daemon.ts 直接启动。

## 5. 文件变更清单

| 文件 | 操作 | 预估行数变化 |
|------|------|-------------|
| `src/daemon/daemon.ts` | 修改 | +50（MCP transport 启动逻辑） |
| `src/bin/js-reverse-mcp.ts` | 简化 | -30 → +5（改为直接启动 daemon） |
| `src/index.ts` | 删除 | -3 |
| `src/cli/tools-meta.ts` | 删除 | -500 |
| `src/cli/commands/tool-dispatcher.ts` | 修改 | -10 → +5（移除本地验证） |
| `src/cli/commands/list-tools.ts` | 修改 | -5 → +5（从 daemon 获取） |
| `src/daemon/client.ts` | 修改 | +60（DaemonConnection 类） |
| `src/cli/commands/repl.ts` | 修改 | +10（使用持久连接） |
| `package.json` | 修改 | 更新 js-reverse-mcp 启动脚本 |

**净效果：约删除 800 行，新增/修改约 200 行，净减 600 行代码**

## 6. 不变的部分

以下组件 **不在此次改动范围内**：

- ToolRegistry 和 defineTool() 工具定义系统
- 60+ 工具的 handler 实现
- 技能系统（observe-flow / auto-hook / rebuild-bundle）
- DebuggerManager / CodeCollector / HookManager 等模块层
- Puppeteer CDP 浏览器连接层
- McpContext / McpResponse（God Node 拆分属于方案 C 范围）
- Daemon handleRequest() 路由逻辑
- 数据持久化层（database / ReverseTaskStore）
- CLI 9 个命令的语法和用户体验

## 7. 迁移策略

### Phase 1: MCP 层合并（核心改动）

1. 修改 daemon.ts 添加 MCP stdio transport 支持
2. 简化 js-reverse-mcp.ts 启动脚本
3. 删除 src/index.ts
4. 验证 MCP 客户端（Claude Code）能正常连接和调用工具

### Phase 2: 双重注册清理

1. 删除 src/cli/tools-meta.ts
2. 修改 tool-dispatcher.ts 移除本地验证
3. 修改 list-tools.ts 从 daemon 动态获取
4. 验证 CLI call/list-tools 命令正常工作

### Phase 3: IPC 连接优化

1. 在 client.ts 新增 DaemonConnection 类
2. 修改 repl.ts 使用持久连接
3. 验证 REPL 模式下工具调用性能改善

### Phase 4: 清理和文档更新

1. 更新 Architecture.md
2. 更新 README 中 js-reverse-mcp 使用说明
3. 运行 `npm run docs` 更新工具文档
4. 全量测试验证

## 8. 验收标准

- [ ] MCP 客户端（Claude Code）能通过 js-reverse-mcp 正常连接和调用所有工具
- [ ] CLI `js-reverse call <tool>` 命令正常工作
- [ ] CLI `js-reverse list-tools` 命令正常工作
- [ ] CLI `js-reverse repl` 使用持久连接，不再每次新建 Socket
- [ ] `src/index.ts` 已删除
- [ ] `src/cli/tools-meta.ts` 已删除
- [ ] `js-reverse-mcp` 不再 fork 子进程
- [ ] `npm test` 全量测试通过
- [ ] `npm run typecheck` 类型检查通过
- [ ] 架构文档已更新

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| MCP stdio transport 与 Unix Socket 并行启动冲突 | Daemon 进程无法同时服务两种客户端 | MCP 模式和 Daemon 模式通过启动参数互斥选择，不在同一进程实例中并行 |
| 删除 TOOLS_META 后 CLI call 命令无法验证工具名 | 用户输入错误工具名时无本地提示 | daemon 端返回错误信息，CLI 格式化显示；可接受，因 daemon 验证更准确 |
| src/index.ts 被其他代码引用 | 删除后导致 import 断裂 | 全量搜索引用，确认无外部依赖后再删除 |
| REPL 持久连接 Socket 断开 | REPL 中途 daemon 重启导致连接失效 | DaemonConnection 添加自动重连逻辑 + heartbeat 检测 |

## 10. 后续演进路径

方案 A 完成后，可逐步推进以下改进（属于方案 B/C 范围）：

1. **清理 TOOLS_META 后的 CLI 命令优化**：`call` 命令可支持 `--help` 从 daemon 获取工具 schema
2. **McpContext 拆分**：将 50+ 方法拆为 `BrowserContext`、`CollectorContext`、`DebuggerContext` 三个小上下文
3. **工具自包含依赖注入**：每个工具定义其所需的最小依赖集，不再通过 McpContext 大对象注入
4. **统一 CLI/MCP 工具定义**：`defineTool()` 同时生成 CLI 命令和 MCP schema