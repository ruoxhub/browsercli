# SPEC: Sekiro-go 去 Daemon 化架构重构

**状态**: Draft
**日期**: 2026-04-22
**分支**: new

## 1. 目标

用 Sekiro-go RPC 框架替代当前 Daemon 进程的调度角色，实现去 Daemon 化，建立 Browser Layer → Protocol Layer → CLI Layer 三层架构。

**核心动机**: 去 Daemon 化 — 用 Sekiro Server 替代 Daemon 的消息路由和调度职责，架构更扁平、可扩展。

## 2. 决策记录

| # | 决策点 | 选择 | 理由 |
|---|--------|------|------|
| D1 | 核心动机 | 去 Daemon 化 | Daemon 作为单一调度中枢，职责过重 |
| D2 | Sekiro Server 部署方式 | 独立进程（Go 进程） | 多客户端可连接，职责分离 |
| D3 | Tools 执行位置 | 独立 Worker（Sekiro Client） | Server 只路由，Worker 持有浏览器状态，可独立扩缩 |
| D4 | MCP stdio 接口 | 删除，仅保留 CLI 交互 | 架构大幅简化 |
| D5 | Sekiro Client SDK | 直接改造现有 `sekiro.ts` 为 Node.js 版 | 核心逻辑平台无关，只需替换 WebSocket 实现 |
| D6 | Tool 桥接方式 | 适配器层（ToolAdapter） | 保护 90+ 现有 Tools 不需改动 |
| D7 | Skills 定位 | 与 Tools 同级，注册为 Sekiro Action | 统一注册和调用模型 |
| D8 | 实施策略 | Big Bang 重构 | 目标就是去 Daemon 化，双轨和内嵌方案都保留 Daemon |

## 3. 整体架构

```
                    ┌─────────────────────────────────────────────────┐
                    │              Sekiro-go Server (独立 Go 进程)      │
                    │  ┌──────────┐ ┌──────────┐ ┌───────────────┐   │
                    │  │ClientMgr │ │  Router  │ │ TimeoutMgr    │   │
                    │  │(分组管理) │ │(负载均衡)│ │ (超时控制)     │   │
                    │  └──────────┘ └──────────┘ └───────────────┘   │
                    │  ┌──────────┐ ┌──────────┐                     │
                    │  │ HTTP API │ │  WS Hub  │                     │
                    │  │(Invoker) │ │(Client通信)│                     │
                    │  └──────────┘ └──────────┘                     │
                    └───────▲─────────────────▲──────────────────────┘
                            │                 │
                  HTTP POST │                 │ WebSocket
         /business/invoke   │                 │ 注册 + 响应
                            │                 │
                    ┌───────┴───────┐   ┌─────┴──────────────────────┐
                    │   CLI (Invoker)│   │   Worker (Sekiro Client)   │
                    │               │   │                            │
                    │ ┌───────────┐ │   │ ┌────────────────────────┐ │
                    │ │axi-sdk-js │ │   │ │ SekiroClient (Node.js) │ │
                    │ │命令解析    │ │   │ │ Action 注册 & 响应      │ │
                    │ └───────────┘ │   │ └────────────────────────┘ │
                    │ ┌───────────┐ │   │ ┌────────────────────────┐ │
                    │ │HTTP Client│ │   │ │ ToolAdapter            │ │
                    │ │Sekiro API │ │   │ │ handler→Action 适配     │ │
                    │ └───────────┘ │   │ └────────────────────────┘ │
                    └───────────────┘   │ ┌────────────────────────┐ │
                                        │ │ BrowserManager         │ │
                                        │ │ (Playwright)           │ │
                                        │ └────────────────────────┘ │
                                        │ ┌────────────────────────┐ │
                                        │ │ JSHookRuntime          │ │
                                        │ │ (全局服务集合)          │ │
                                        │ └────────────────────────┘ │
                                        │ ┌────────────────────────┐ │
                                        │ │ Skills (3个)           │ │
                                        │ │ 注册为 Action          │ │
                                        │ └────────────────────────┘ │
                                        └────────────────────────────┘
```

### 核心流程

1. `js-reverse start` → CLI spawn Worker 进程 + 确认 sekiro-go Server 可用
2. Worker 启动 → 连接 sekiro-go Server → 注册 group + Actions
3. CLI 调用 → HTTP POST `/business/invoke` → Server 路由到 Worker → Worker 执行 → 结果原路返回
4. Skills 和 Tools 同级注册为 Action，由同一个 Worker 处理

### 删除的组件

- `src/daemon/` 整个目录（Daemon 进程）
- `src/bin/js-reverse-mcp`（MCP stdio 入口）
- Unix Socket / Named Pipe 通信机制

## 4. Protocol Layer — SekiroClient Node.js 改造

### 改造 `src/protocol/sekiro.ts`

| 改动点 | 当前（浏览器端） | 改造后（Node.js） |
|--------|----------------|------------------|
| WebSocket 实现 | `new WebSocket(url)` | `new WebSocket(url)` from `ws` 包 |
| 定时器 | `window.setTimeout` | `setTimeout`（全局） |
| `isConnected()` | `socket.readyState === WebSocket.OPEN` | `socket.readyState === WebSocket.OPEN`（ws 包兼容） |
| window 导出 | `typeof window !== 'undefined'` 守卫 | 删除，改为标准 ES 导出 |
| 类型依赖 | `import from '../types/sekiro'`（不存在） | 新建 `src/types/sekiro.ts` |
| 重连机制 | 固定 2s | 可配置重连间隔 + 指数退避 |
| 心跳 | 无 | 新增 ping/pong 心跳，防止连接空闲断开 |
| 注册协议 | WebSocket URL 拼接 `group` + `clientId` | 对齐 sekiro-go 的 `C_REGISTER` 协议 |

### 新建类型文件 `src/types/sekiro.ts`

```typescript
interface SekiroRequest {
  __sekiro_seq__: string;
  action: string;
  params?: Record<string, unknown>;
}

interface SekiroResponse {
  code?: number;
  status?: number;
  message?: string;
  data?: unknown;
  __sekiro_seq__: string;
}

type ActionHandler = (
  request: SekiroRequest,
  resolve: (response: unknown) => void,
  reject: (errorMessage: string) => void,
) => void;
```

### 重写 `src/protocol/Client.ts`（BaseClient → NodeClient）

删除浏览器绑定（window、Chrome Storage），保留 Action 管理核心：

```typescript
interface NodeClientConfig {
  group: string;
  sekiroHost: string;  // e.g. ws://127.0.0.1:5620
  clientId?: string;
}

class NodeClient {
  private sekiro: SekiroClient;
  private actions: Map<string, ActionHandler>;

  constructor(config: NodeClientConfig) {
    this.sekiro = new SekiroClient(wsURL);
    this.actions = new Map();
  }

  registerAction(name: string, handler: ActionHandler): void;
  start(): Promise<void>;
  reconnect(host: string): void;
  getStatus(): ClientStatus;
}
```

### 文件变更

- 改造：`src/protocol/sekiro.ts`（浏览器 → Node.js）
- 重写：`src/protocol/Client.ts`（BaseClient → NodeClient）
- 删除：`src/protocol/baseClient.ts`（已被 Client.ts 替代）
- 新建：`src/types/sekiro.ts`
- 新建：`src/types/platform.ts`（NodeClientConfig 等类型）

## 5. Worker Layer — ToolAdapter 与 Action 注册

### Worker 启动流程

```
1. 解析 CLI 参数 (--sekiroHost, --group, --browserUrl 等)
2. 初始化 BrowserManager (连接/启动浏览器)
3. 初始化 JSHookRuntime (全局服务集合)
4. 创建 NodeClient，连接到 sekiro-go Server
5. 通过 ToolAdapter 注册所有 Tools 为 Sekiro Actions
6. 注册 Skills 为 Sekiro Actions
7. 进入运行状态，等待 Server 转发请求
```

### ToolAdapter 核心逻辑

```typescript
class ToolAdapter {
  constructor(
    private runtime: JSHookRuntime,
    private tools: ToolDefinition[],
  ) {}

  /**
   * 将 Tool handler 包装为 Sekiro ActionHandler
   *
   * Tool:   handler(request, response, context, runtime) => void
   * Action: handler(request, resolve, reject) => void
   */
  wrapTool(tool: ToolDefinition): ActionHandler {
    return (sekiroRequest, resolve, reject) => {
      const toolRequest = { params: sekiroRequest.params || {} };
      const toolResponse = new ToolResponseAccumulator();
      const toolContext = new ToolContextProvider(this.runtime);

      tool.handler(toolRequest, toolResponse, toolContext, this.runtime)
        .then(() => {
          const result = toolResponse.toJSON();
          resolve(result);
        })
        .catch(err => {
          reject(err.message || String(err));
        });
    };
  }

  /** 批量注册所有 Tools */
  registerAll(client: NodeClient): void {
    for (const tool of this.tools) {
      client.registerAction(tool.name, this.wrapTool(tool));
      for (const alias of tool.aliases ?? []) {
        client.registerAction(alias, this.wrapTool(tool));
      }
    }
  }
}
```

### ToolResponseAccumulator

复刻当前 Daemon 中 `response` 对象的 accumulator 模式：

```typescript
class ToolResponseAccumulator {
  private lines: string[] = [];
  private structuredContent: unknown = null;
  private includePages = false;
  private includeNetwork = false;

  appendResponseLine(line: string): void { this.lines.push(line); }
  setStructuredContent(content: unknown): void { this.structuredContent = content; }
  setIncludePages(value: boolean): void { this.includePages = value; }
  setIncludeNetworkRequests(value: boolean): void { this.includeNetwork = value; }

  toJSON(): object {
    const result: Record<string, unknown> = {};
    if (this.lines.length > 0) result.text = this.lines.join('\n');
    if (this.structuredContent) result.structuredContent = this.structuredContent;
    if (this.includePages) result.pages = /* 从 runtime 获取 */;
    if (this.includeNetwork) result.network = /* 从 runtime 获取 */;
    return result;
  }
}
```

### ToolContextProvider

从 JSHookRuntime 提供页面/网络/调试器环境，接口与当前 Daemon 中的 context 对象兼容：

```typescript
class ToolContextProvider {
  constructor(private runtime: JSHookRuntime) {}

  getSelectedPage(): Page | null;
  getPages(): Page[];
  selectPage(page: Page): void;
  getNetworkRequests(): unknown[];
  // ... 其他 context 方法
}
```

### Skill 注册

```typescript
client.registerAction(`skill_${skill.name}`, (request, resolve, reject) => {
  const skillContext = { url: request.params?.url, options: request.params };
  skill.execute(skillContext)
    .then(result => resolve(result))
    .catch(err => reject(err.message));
});
```

### 文件变更

- 新建：`src/worker/index.ts`（Worker 入口）
- 新建：`src/worker/ToolAdapter.ts`
- 新建：`src/worker/ToolResponseAccumulator.ts`
- 新建：`src/worker/ToolContextProvider.ts`

## 6. CLI Layer — 从 IPC 改为 Sekiro HTTP API

### 命令映射

| 命令 | 当前实现 | 新实现 |
|------|---------|--------|
| `js-reverse start` | spawn Daemon 进程 | spawn Worker 进程 + 检查 sekiro-go 可用性 |
| `js-reverse stop` | IPC `{method:'stop'}` | 发送 SIGTERM 给 Worker 进程 |
| `js-reverse status` | IPC `{method:'status'}` | HTTP GET `/business/clientQueue?group=...` + Worker 进程状态 |
| `js-reverse list-tools` | IPC `{method:'list_tools'}` | HTTP GET `/business/invoke?group=...&action=_list_tools` |
| `js-reverse call <tool>` | IPC `{method:'invoke_tool', tool, args}` | HTTP POST `/business/invoke` `{group, action, params}` |
| `js-reverse call-skill <skill>` | IPC `{method:'invoke_skill', skill, args}` | HTTP POST `/business/invoke` `{group, action:'skill_<name>', params}` |
| `js-reverse list-skills` | IPC `{method:'list_skills'}` | HTTP GET `/business/invoke?group=...&action=_list_skills` |
| `js-reverse repl` | IPC 交互循环 | HTTP API 交互循环 |
| `js-reverse scaffold` | 本地文件操作 | 不变，纯本地操作 |
| `js-reverse-mcp` | MCP stdio 入口 | **删除** |

### SekiroInvoker

```typescript
class SekiroInvoker {
  private baseUrl: string;

  constructor(config: { sekiroHost: string }) {
    this.baseUrl = config.sekiroHost;
  }

  async invoke(group: string, action: string, params?: Record<string, unknown>): Promise<unknown>;
  async listClients(group: string): Promise<unknown>;
  async listGroups(): Promise<unknown>;
}
```

### WorkerManager

```typescript
class WorkerManager {
  private workerProcess: ChildProcess | null = null;

  async start(options: WorkerStartOptions): Promise<void>;
  async stop(): Promise<void>;
  isRunning(): boolean;
}
```

### `js-reverse start` 新流程

```
1. 解析参数 (--sekiroHost, --group, --browserUrl 等)
2. 检查 sekiro-go Server 是否可用
   ├─ 不可用 → 提示用户先启动 sekiro-go Server，退出
   └─ 可用 → 继续
3. spawn Worker 进程
4. 轮询等待 Worker 注册到 Server
5. 输出 "Worker 已启动，连接到 sekiro-go Server"
```

### 文件变更

- 新建：`src/cli/sekiro-invoker.ts`
- 新建：`src/cli/worker-manager.ts`
- 改造：`src/cli/commands/start.ts`
- 改造：`src/cli/commands/tool-dispatcher.ts`
- 改造：`src/cli/commands/repl.ts`
- 删除：`src/bin/js-reverse-mcp.ts`

## 7. 生命周期与错误处理

### Worker 状态机

```
STOPPED ──start()──► STARTING ──► CONNECTING
    ▲                                  │
    │                          ┌───────┤
    │                          ▼       ▼
    │                      READY   RECONNECTING
    │                          │       ▲
    │                          ▼       │
    │                      RUNNING ────┘ (连接断开)
    │                          │
    └──────────────────────────┘ (crash/SIGTERM)
```

### 错误恢复策略

| 场景 | 处理方式 |
|------|---------|
| Worker → Server WebSocket 断开 | 指数退避重连（2s → 4s → 8s → 30s 封顶），重连成功后重新注册所有 Actions |
| Worker 浏览器连接断开 | 标记当前 Action 返回错误，不自动重连浏览器 |
| Tool 执行超时 | 由 sekiro-go 的 TimeoutManager 统一控制（默认 30s） |
| Tool 执行异常 | ToolAdapter 的 catch 捕获，调用 `reject(errorMessage)` |
| Worker 进程崩溃 | CLI 的 WorkerManager 监听 exit 事件，输出错误信息，不自动重启 |
| sekiro-go Server 不可用 | CLI start 命令前置检查，拒绝启动 |

### 日志

- Worker 使用项目 Logger 体系，输出到 stdout
- 关键事件：启动、连接、注册、Action 调用开始/结束、重连、错误
- 格式：`[Worker][SekiroClient] action=xxx duration=xxxms status=ok/err`

### 优雅关闭

```
Worker 收到 SIGTERM:
1. 停止接受新 Action 请求（Sekiro 连接断开，Server 自动路由到其他 Worker）
2. 等待当前执行中的 Action 完成（最多 10s）
3. 关闭浏览器连接
4. 进程退出
```

## 8. 迁移计划

| 阶段 | 内容 | 依赖 |
|------|------|------|
| Phase 1 | 新建 `src/types/sekiro.ts` + `src/types/platform.ts`，改造 `src/protocol/sekiro.ts` 为 Node.js 版 | 无 |
| Phase 2 | 重写 `src/protocol/Client.ts`（BaseClient → NodeClient） | Phase 1 |
| Phase 3 | 新建 Worker 层（`src/worker/`：index、ToolAdapter、ToolResponseAccumulator、ToolContextProvider） | Phase 2 |
| Phase 4 | 新建 CLI 层（`src/cli/sekiro-invoker.ts`、`src/cli/worker-manager.ts`），改造 CLI 命令 | Phase 3 |
| Phase 5 | 删除 Daemon 层（`src/daemon/`）、MCP 入口（`src/bin/js-reverse-mcp`），清理 IPC 相关代码 | Phase 4 |

## 9. 完整文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `src/types/sekiro.ts` | Sekiro 协议类型定义 |
| 新建 | `src/types/platform.ts` | NodeClientConfig 等平台类型 |
| 改造 | `src/protocol/sekiro.ts` | 浏览器端 → Node.js（ws 包、删 window、加重连/心跳） |
| 重写 | `src/protocol/Client.ts` | BaseClient → NodeClient |
| 新建 | `src/worker/index.ts` | Worker 进程入口 |
| 新建 | `src/worker/ToolAdapter.ts` | Tool handler → Sekiro Action 适配器 |
| 新建 | `src/worker/ToolResponseAccumulator.ts` | Response accumulator |
| 新建 | `src/worker/ToolContextProvider.ts` | Context 提供者 |
| 新建 | `src/cli/sekiro-invoker.ts` | Sekiro HTTP API 调用方 |
| 新建 | `src/cli/worker-manager.ts` | Worker 进程生命周期管理 |
| 改造 | `src/cli/commands/start.ts` | spawn Worker 替代 spawn Daemon |
| 改造 | `src/cli/commands/tool-dispatcher.ts` | SekiroInvoker 替代 IPC |
| 改造 | `src/cli/commands/repl.ts` | SekiroInvoker 替代 IPC |
| 删除 | `src/daemon/` 整个目录 | Daemon 进程 |
| 删除 | `src/bin/js-reverse-mcp.ts` | MCP stdio 入口 |
| 删除 | `src/protocol/baseClient.ts` | 已被 Client.ts 替代 |

## 10. 新增 npm 依赖

- `ws` — Node.js WebSocket 客户端
- `@types/ws` — TypeScript 类型定义

## 11. package.json 变更

- 新增 `ws` + `@types/ws` 依赖
- 删除 `js-reverse-mcp` bin 入口
- 新增 `js-reverse-worker` bin 入口

## 12. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| sekiro-go Server 需要额外部署 | CLI start 前置检查 + 清晰的错误提示 |
| Worker 崩溃后需手动重启 | 未来可加自动重启策略，当前保持简单 |
| ToolAdapter 适配器可能遗漏 response/context 方法 | 逐步迁移 + 测试覆盖 |
| 现有测试基于 Daemon 架构 | Phase 5 同步改造测试 |
