# RPC Refactoring Design: MCP to JSON-RPC 2.0

**Date**: 2026-04-20
**Status**: Draft
**Author**: Sisyphus (via brainstorming session)

## 1. Problem Statement

JSReverser-MCP currently uses a three-layer architecture with MCP (Model Context Protocol) as the communication protocol between CLI and Daemon. This creates unnecessary complexity:

- **Three-process chain**: CLI → Daemon (MCP Client) → MCP Server (child process) → Puppeteer
- **Dual-mode confusion**: `daemon.ts` (direct execution) vs `js-reverse-mcp.ts` (MCP proxy) serve different purposes but share similar code
- **Per-request connections**: Each CLI command opens a new Unix Socket connection, sends one message, and closes — no connection reuse, no streaming, no notifications
- **MCP dependency overhead**: `@modelcontextprotocol/sdk` is a heavy dependency that only serves as a transport layer, but the project never exposes an MCP interface to external AI tools
- **axi-sdk-js coupling**: CLI framework is tightly coupled to a specific library, limiting extensibility

## 2. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| S-side architecture | Daemon embeds Puppeteer | Closest to current architecture, minimal process restructuring |
| MCP dependency | Completely remove | Project never exposes MCP to external tools; internal use is overhead |
| RPC protocol | JSON-RPC 2.0 over Unix Socket | Standard protocol, easy debugging, minimal migration from current custom JSON |
| Connection model | Persistent + bidirectional | Enables streaming responses, hook data push, browser event notifications |
| CLI framework | Replace axi-sdk-js with yargs | Lighter, more widely adopted, simpler command definition |
| Refactoring strategy | Incremental replacement (5 phases) | Reduces risk, each phase is independently verifiable |
| HTTP layer | Remove | Simplifies architecture; external access can be re-added later if needed |

## 3. Target Architecture

```
┌─────────────────────────────────────┐
│  CLI (yargs/commander)              │
│  js-reverse start/stop/status/call   │
│  call-skill/list-*/repl/scaffold    │
└──────────────┬──────────────────────┘
               │ JSON-RPC 2.0
               │ Unix Socket (persistent)
               ▼
┌─────────────────────────────────────┐
│  RPC Server                        │
│  ┌─────────────────────────────┐   │
│  │  Router (method dispatch)   │   │
│  │  Map<namespace.method, fn>  │   │
│  └──────┬──────┬──────┬────────┘   │
│         │      │      │             │
│  ┌──────▼┐ ┌───▼──┐ ┌──▼────────┐  │
│  │Tool   │ │Skill │ │Browser    │  │
│  │Service│ │Svc   │ │Service    │  │
│  └───┬───┘ └──┬───┘ └───┬───────┘  │
│      │        │         │            │
│  ┌───▼────────▼─────────▼────────┐  │
│  │  JSHookRuntime (singleton)     │  │
│  │  BrowserManager + HookManager  │  │
│  │  + Collector + DOMInspector    │  │
│  └───────────────────────────────┘  │
│              │                       │
│              ▼                       │
│  ┌──────────────────────────────┐   │
│  │  Puppeteer (embedded)        │   │
│  │  Chrome DevTools Protocol    │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

## 4. JSON-RPC 2.0 Protocol

### 4.1 Request Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools.invoke",
  "params": {
    "name": "list_scripts",
    "arguments": {}
  }
}
```

### 4.2 Response Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "success": true,
    "data": { ... },
    "text": "Found 5 scripts",
    "structuredContent": null
  }
}
```

### 4.3 Error Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32001,
    "message": "Tool not found: unknown_tool",
    "data": { "method": "tools.invoke", "tool": "unknown_tool" }
  }
}
```

### 4.4 Notification Format (Server → Client)

```json
{
  "jsonrpc": "2.0",
  "method": "notifications.hookData",
  "params": {
    "hookId": "hook_001",
    "records": [...]
  }
}
```

### 4.5 Method Namespaces

| Namespace | Methods | Current Equivalent |
|-----------|---------|-------------------|
| `tools.*` | `tools.invoke`, `tools.list` | `invoke_tool`, `list_tools` |
| `skills.*` | `skills.invoke`, `skills.list` | `invoke_skill`, `list_skills` |
| `browser.*` | `browser.health`, `browser.pages` | `check_browser_health`, page listing |
| `session.*` | `session.save`, `session.restore` | `save_session_state`, `restore_session_state` |
| `daemon.*` | `daemon.status`, `daemon.shutdown` | `status`, `stop` |
| `notifications.*` | `notifications.hookData`, `notifications.console` | New: real-time push |

### 4.6 Error Codes

| Code | Meaning |
|------|---------|
| `-32700` | Parse error |
| `-32600` | Invalid Request |
| `-32601` | Method not found |
| `-32602` | Invalid params |
| `-32603` | Internal error |
| `-32001` | Tool not found |
| `-32002` | Browser not connected |
| `-32003` | Skill not found |
| `-32004` | Timeout |
| `-32005` | Connection lost |

## 5. RPC Server Design

### 5.1 Core Classes

```
src/server/
├── rpc-server.ts       # Unix Socket server, connection management
├── rpc-router.ts       # Method routing, Map<string, RpcHandler>
├── json-rpc.ts         # Protocol types (Request, Response, Error, Notification)
├── services/
│   ├── tool-service.ts     # Wraps ToolRegistry + tool execution
│   ├── skill-service.ts    # Wraps SkillRegistry + skill execution
│   ├── browser-service.ts  # Browser health, page management
│   └── session-service.ts  # Session state management
└── notification-manager.ts # Push notifications to connected clients
```

### 5.2 RpcServer

```typescript
export class RpcServer {
  private server: Server | null = null;
  private router: RpcRouter;
  private connections: Set<Socket>;
  private notificationManager: NotificationManager;

  async start(socketPath: string): Promise<void>;
  async stop(): Promise<void>;

  // Broadcast notification to all connected clients
  notify(method: string, params: unknown): void;
  // Send notification to a specific client
  notifyOne(socket: Socket, method: string, params: unknown): void;
}
```

### 5.3 RpcRouter

```typescript
export class RpcRouter {
  private handlers: Map<string, RpcHandler>;

  register(method: string, handler: RpcHandler): void;
  async route(request: JsonRpcRequest, context: RpcContext): Promise<JsonRpcResponse>;
}

export type RpcHandler = (params: unknown, context: RpcContext) => Promise<unknown>;

export interface RpcContext {
  runtime: JSHookRuntime;
  networkCollector: NetworkCollector | null;
  socket: Socket;  // For push notifications
}
```

### 5.4 Daemon Entry Point (Simplified)

```typescript
// src/daemon/daemon.ts (after refactoring)
async function main() {
  const runtime = getJSHookRuntime();
  await runtime.browserManager.launch();

  const router = new RpcRouter();
  const toolService = new ToolService(runtime);
  const skillService = new SkillService(runtime);
  const browserService = new BrowserService(runtime);

  router.register('tools.invoke', toolService.invoke.bind(toolService));
  router.register('tools.list', toolService.list.bind(toolService));
  router.register('skills.invoke', skillService.invoke.bind(skillService));
  router.register('skills.list', skillService.list.bind(skillService));
  router.register('browser.health', browserService.health.bind(browserService));
  router.register('daemon.status', () => ({pid: process.pid, ...}));
  router.register('daemon.shutdown', () => { cleanup(); });

  const server = new RpcServer(router);
  await server.start(getSocketPath());
}
```

## 6. RPC Client Design

### 6.1 Directory Structure

```
src/client/
├── rpc-client.ts       # JSON-RPC 2.0 client, persistent connection
├── daemon-client.ts    # High-level API (invokeTool, invokeSkill, etc.)
└── connection-manager.ts # Auto-reconnect, heartbeat, timeout
```

### 6.2 RpcClient

```typescript
export class RpcClient {
  private socket: Socket | null = null;
  private requestId = 0;
  private pendingRequests: Map<number, PromiseCallbacks>;
  private notificationHandlers: Map<string, Set<NotificationHandler>>;
  private connectionManager: ConnectionManager;

  async connect(socketPath: string): Promise<void>;
  async disconnect(): Promise<void>;

  // JSON-RPC call
  async call<T>(method: string, params?: unknown): Promise<T>;

  // Notification subscription
  on(method: string, handler: NotificationHandler): () => void;
  off(method: string, handler: NotificationHandler): void;

  // Connection state
  get connected(): boolean;
}
```

### 6.3 DaemonClient (Convenience Wrapper)

```typescript
export class DaemonClient {
  constructor(private rpc: RpcClient) {}

  // Tool operations
  async invokeTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  async listTools(category?: string): Promise<ToolDefinition[]>;

  // Skill operations
  async invokeSkill(name: string, args: Record<string, unknown>): Promise<SkillResult>;
  async listSkills(): Promise<SkillDefinition[]>;

  // Daemon management
  async status(): Promise<DaemonStatus>;
  async shutdown(): Promise<void>;

  // Real-time notifications
  onHookData(handler: (data: HookDataRecord) => void): () => void;
  onConsoleMessage(handler: (msg: ConsoleMessage) => void): () => void;
}
```

### 6.4 Connection Manager

```typescript
export class ConnectionManager {
  private socketPath: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // ms, exponential backoff

  async connect(socketPath: string): Promise<Socket>;
  async reconnect(): Promise<Socket>;
  startHeartbeat(intervalMs: number): void;
  stopHeartbeat(): void;
}
```

## 7. CLI Rewrite

### 7.1 Framework Migration: axi-sdk-js → yargs

**Current** (9 commands via axi-sdk-js):
```typescript
await runAxiCli<DaemonContext>({
  commands: { start, stop, status, call, 'call-skill': ..., 'list-skills': ..., 'list-tools': ..., repl, scaffold },
});
```

**Target** (yargs):
```typescript
yargs(process.argv.slice(2))
  .command(startCommand)
  .command(stopCommand)
  .command(statusCommand)
  .command(callCommand)
  .command(callSkillCommand)
  .command(listSkillsCommand)
  .command(listToolsCommand)
  .command(replCommand)
  .command(scaffoldCommand)
  .demandCommand()
  .help()
  .argv;
```

### 7.2 Command Pattern

```typescript
// src/cli/commands/call.ts
import type { ArgumentsCamelCase } from 'yargs';
import { DaemonClient } from '../../client/daemon-client.js';

interface CallArgs {
  tool: string;
  params: Record<string, unknown>;
}

export const callCommand = {
  command: 'call <tool>',
  describe: '调用 RPC 工具',
  builder: (yargs) => yargs
    .positional('tool', { type: 'string', demandOption: true })
    .option('param', { type: 'string', array: true }),
  handler: async (argv: ArgumentsCamelCase<CallArgs>) => {
    const client = new DaemonClient(new RpcClient());
    await client.connect(getSocketPath());
    try {
      const result = await client.invokeTool(argv.tool, parseParams(argv.param));
      console.log(formatOutput(result));
    } finally {
      await client.disconnect();
    }
  },
};
```

### 7.3 REPL Command

The REPL command will maintain a persistent `RpcClient` connection for the duration of the session, avoiding per-command connect/disconnect overhead:

```typescript
// src/cli/commands/repl.ts
export const replCommand = {
  command: 'repl',
  describe: '交互式 REPL 模式',
  handler: async () => {
    const client = new DaemonClient(new RpcClient());
    await client.connect(getSocketPath());
    // Start interactive loop with persistent connection
    await startReplLoop(client);
    await client.disconnect();
  },
};
```

## 8. Files to Remove

| File | Reason |
|------|--------|
| `src/bin/js-reverse-mcp.ts` | MCP proxy daemon, no longer needed |
| `src/daemon/http-server.ts` | HTTP layer removed per decision |
| `src/daemon/client.ts` | Replaced by `src/client/rpc-client.ts` |
| `src/daemon/types.ts` | Replaced by `src/protocol/json-rpc.ts` |
| `src/daemon/utils.ts` | Partially replaced; socket path utils remain |
| `src/third_party/` | PipeTransport replaced by custom JSON-RPC transport |

## 9. Dependencies Changes

### Remove from package.json
- `@modelcontextprotocol/sdk` — MCP protocol SDK
- `axi-sdk-js` — CLI framework
- `express` — HTTP server framework (http-server.ts dependency)

### Add to package.json
- `yargs` — CLI framework (lighter alternative)
- No new RPC framework — custom JSON-RPC 2.0 implementation (minimal code)

## 10. Implementation Phases

### Phase 1 — RPC Core (Communication Layer)
**Goal**: Establish JSON-RPC 2.0 communication, verify basic tool invocation works.

**New files**:
- `src/protocol/json-rpc.ts` — Protocol types and validation
- `src/server/rpc-server.ts` — Unix Socket server with JSON-RPC routing
- `src/server/rpc-router.ts` — Method dispatch
- `src/client/rpc-client.ts` — JSON-RPC client with persistent connection
- `src/client/daemon-client.ts` — High-level API wrapper

**Modified files**:
- `src/daemon/daemon.ts` — Delegate to RpcServer instead of direct handleRequest
- `src/daemon/types.ts` — Replace with JSON-RPC types (temporarily coexist)

**Verification**: CLI can call `tools.list` and `tools.invoke` through RPC Client → RPC Server → existing tool handler.

### Phase 2 — Service Layer (Route Refactoring)
**Goal**: Replace handleRequest if-else chain with Service-based routing.

**New files**:
- `src/server/services/tool-service.ts`
- `src/server/services/skill-service.ts`
- `src/server/services/browser-service.ts`
- `src/server/services/session-service.ts`
- `src/server/notification-manager.ts`

**Modified files**:
- `src/daemon/daemon.ts` — Simplified to RpcServer startup + service registration
- Tool handler signatures remain unchanged (request, response, context, runtime)

**Verification**: All 60+ tools and 3 skills work through Service routing.

### Phase 3 — CLI Rewrite
**Goal**: Replace axi-sdk-js with yargs, all commands working through DaemonClient.

**New files**:
- `src/cli/cli.ts` — yargs entry point
- `src/cli/commands/call.ts` — Replaces tool-dispatcher.ts
- `src/cli/commands/call-skill.ts` — Replaces call-skill.ts
- (other commands rewritten)

**Removed files**:
- `src/bin/js-reverse.ts` — Replaced by new CLI entry
- `src/bin/cliDefinitions.ts` — axi-sdk-js definitions
- `src/cli/args-parser.ts` — Replaced by yargs builder
- `src/cli/help.ts` — Replaced by yargs help
- `src/cli/output.ts` — Replaced by simpler formatting
- `src/cli/tools-meta.ts` — Kept (tool metadata query, independent of CLI framework)

**Verification**: All 9 CLI commands work with yargs interface.

### Phase 4 — Notification System (Bidirectional Communication)
**Goal**: Enable server→client push notifications for hook data and browser events.

**New files**:
- `src/server/notification-manager.ts` — Broadcast and targeted notifications
- `src/client/notification-handler.ts` — Client-side notification subscription

**Modified files**:
- `src/server/rpc-server.ts` — Add notification sending on connections
- `src/client/rpc-client.ts` — Add notification callback system
- Hook tools — Add notification push on data collection

**Verification**: Hook data pushed to CLI in real-time; console messages streamed.

### Phase 5 — Cleanup MCP
**Goal**: Remove all MCP-related code and dependencies.

**Removed files**:
- `src/bin/js-reverse-mcp.ts`
- `src/daemon/http-server.ts`
- `src/third_party/` (PipeTransport import)
- `src/index.ts` (MCP entry point, replaced by RPC daemon entry)

**Modified files**:
- `package.json` — Remove `@modelcontextprotocol/sdk`, `axi-sdk-js`, `express`; Add `yargs`
- `package.json` — Update `bin` entries

**Verification**: Full test suite passes. No MCP imports remain. `js-reverse start` launches RPC daemon. All tools work.

## 11. Tool Handler Compatibility

The tool handler signature remains **unchanged** throughout this refactoring:

```typescript
// Current signature (preserved)
handler: (
  request: Request<Schema>,
  response: Response,
  context: Context,
  runtime: JSHookRuntime,
) => Promise<void>;
```

The `ToolService` adapter translates between RPC params and this handler signature:

```typescript
class ToolService {
  async invoke(params: {name: string; arguments: Record<string, unknown>}, ctx: RpcContext): Promise<unknown> {
    const tool = this.registry.get(params.name);
    const request = { params: params.arguments };
    const response = new ToolResponseBuilder();  // Adapts to Response interface
    await tool.handler(request, response, ctx, ctx.runtime);
    return response.toResult();
  }
}
```

This means all 60+ tool implementations require **zero changes**.

## 12. Backward Compatibility Considerations

### Breaking Changes
- **MCP interface removed**: Any external tool using MCP to connect will break
- **CLI command names preserved**: `js-reverse call`, `js-reverse start`, etc. remain the same
- **Socket path preserved**: `/tmp/js-reverse-mcp.sock` (Unix) / Named Pipe (Windows) unchanged
- **PID file preserved**: Same location for daemon PID tracking

### Migration Path
- Phase 1-2 can coexist with current `daemon.ts` mode — both RPC and old IPC handlers available
- Phase 3 switches CLI to RPC-only
- Phase 5 removes old code completely

## 13. Risk Assessment

| Risk | Mitigation |
|------|-------------|
| Tool handlers break during migration | Handler signature preserved; Service layer is adapter |
| Unix Socket connection stability | ConnectionManager with auto-reconnect and heartbeat |
| Performance regression | JSON-RPC over Unix Socket is similar to current custom protocol |
| Windows Named Pipe compatibility | Keep existing IS_WINDOWS abstraction from utils.ts |
| Large response handling | JSON-RPC 2.0 supports batch; add chunking if needed |
| Lost notifications during reconnect | Buffer last N notifications; replay on reconnect |