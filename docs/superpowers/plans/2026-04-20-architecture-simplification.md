# Implementation Plan: Architecture Simplification

> Date: 2026-04-20
> Spec: `docs/superpowers/specs/2026-04-20-architecture-simplification-design.md`
> Status: Ready for execution

## Summary

Merge MCP layer into Daemon, delete dual tool registration, optimize IPC connections. Net ~600 lines removed.

## Phase 1: Merge MCP Layer into Daemon

### Step 1.1: Add `--mcp-mode` to daemon.ts

**File**: `src/daemon/daemon.ts`

**What**: Add MCP stdio transport support alongside existing Unix Socket server. When `--mcp-mode` flag is present, start MCP stdio transport instead of Unix Socket server.

**Changes**:
1. Add `--mcp-mode` to `parseDaemonArgs()`:
```typescript
function parseDaemonArgs(args: string[]) {
  let browserUrl: string | undefined;
  let wsEndpoint: string | undefined;
  let mcpMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--browserUrl') browserUrl = args[++i];
    else if (args[i] === '--wsEndpoint') wsEndpoint = args[++i];
    else if (args[i] === '--mcp-mode') mcpMode = true;
  }
  // ... existing env var setup ...
  return {browserUrl, wsEndpoint, mcpMode};
}
```

2. Add MCP server startup path after `startSocketServer()`:
```typescript
// After parseDaemonArgs
const args = parseDaemonArgs(mcpServerArgs);

if (args.mcpMode) {
  // MCP mode: start as MCP stdio server
  await startMcpServer();
} else {
  // Daemon mode: existing Unix Socket server
  await startSocketServer();
}
```

3. Add `startMcpServer()` function:
```typescript
async function startMcpServer() {
  logger('[DAEMON] Starting in MCP mode (stdio transport)...');
  await ensureToolsLoaded();
  
  const {McpServer} = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const {StdioServerTransport} = await import('@modelcontextprotocol/sdk/server/stdio.js');
  
  const server = new McpServer({name: 'js-reverser', version: VERSION});
  
  // Register all tools from ToolRegistry
  const tools = await getCachedTools();
  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      tool.schema || {},
      async (args) => {
        // Route through existing handleRequest logic
        const result = await handleRequest({
          method: 'invoke_tool',
          tool: tool.name,
          args,
        });
        if (!result.success) {
          return {content: [{type: 'text', text: `Error: ${result.error}`}], isError: true};
        }
        const parsed = JSON.parse(result.result || '{}');
        return {content: [{type: 'text', text: JSON.stringify(parsed, null, 2)}]};
      },
    );
  }
  
  // Register skills
  const skills = getBuiltInSkillDefinitions();
  for (const skill of skills) {
    server.tool(
      skill.name,
      skill.description,
      {url: {type: 'string', description: 'Target URL'}},
      async (args) => {
        const result = await handleRequest({
          method: 'invoke_skill',
          skill: skill.name,
          args,
        });
        if (!result.success) {
          return {content: [{type: 'text', text: `Error: ${result.error}`}], isError: true};
        }
        const parsed = JSON.parse(result.result || '{}');
        return {content: [{type: 'text', text: JSON.stringify(parsed, null, 2)}]};
      },
    );
  }
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger('[DAEMON] MCP server connected via stdio transport');
}
```

**MUST NOT**: Change existing `handleRequest()`, `startSocketServer()`, or `cleanup()` logic.
**MUST NOT**: Remove the Unix Socket server path — it must remain for CLI mode.

### Step 1.2: Simplify js-reverse-mcp.ts

**File**: `src/bin/js-reverse-mcp.ts`

**What**: Replace the entire file with a thin wrapper that starts daemon in MCP mode.

**New content** (replace entire file):
```typescript
#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MCP bridge entry point.
 * 
 * Starts the daemon in MCP mode (stdio transport).
 * The daemon handles all tool/skill registration and request routing internally.
 * No subprocess forking needed.
 */

import {version} from 'node:process';

const [major, minor] = version.substring(1).split('.').map(Number);
const supported =
  (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23;

if (!supported) {
  console.error(
    `ERROR: js-reverse-mcp does not support Node ${process.version}. Please upgrade to Node 20.19.0 LTS or newer.`,
  );
  process.exit(1);
}

// Pass --mcp-mode to daemon so it starts MCP stdio transport instead of socket server
process.argv.push('--mcp-mode');
await import('../daemon/daemon.js');
```

**MUST NOT**: Import `Client`, `StdioClientTransport`, `PipeTransport` or any MCP client SDK code.
**MUST NOT**: Fork any subprocesses.

### Step 1.3: Delete src/index.ts

**File**: `src/index.ts`

**What**: Delete the file entirely. It was only a passthrough to `daemon.js`.

**Verification**: Search entire codebase for `index.js` or `index.ts` imports referencing this file. Only `INDEX_SCRIPT_PATH` in `utils.ts` should reference it, and that will be cleaned up.

### Step 1.4: Update utils.ts — remove INDEX_SCRIPT_PATH

**File**: `src/daemon/utils.ts`

**What**: Remove the `INDEX_SCRIPT_PATH` export since `js-reverse-mcp.ts` no longer forks a child process.

**Remove**:
```typescript
export const INDEX_SCRIPT_PATH = path.resolve(__dirname, '../index.js');
```

**Also remove from `js-reverse-mcp.ts`**: The import of `INDEX_SCRIPT_PATH` (already handled in Step 1.2 since we rewrite the file).

**Search for all usages**: `INDEX_SCRIPT_PATH` is imported in `js-reverse-mcp.ts` (being rewritten) and defined in `utils.ts`. Remove from both.

### Step 1.5: Update package.json bin entry

**File**: `package.json`

**What**: No change needed. The bin entry `js-reverse-mcp` already points to `build/src/bin/js-reverse-mcp.js`, which after SWC compilation will be the simplified wrapper. The `js-reverse` entry also stays the same.

**Verification**: After build, `js-reverse-mcp` command should start daemon in MCP mode.

### Step 1.6: Verify MCP client connectivity

**How**: Run `npm run build`, then configure Claude Desktop or another MCP client to use `js-reverse-mcp`. Confirm tool listing and invocation works.

---

## Phase 2: Delete Dual Tool Registration

### Step 2.1: Delete src/cli/tools-meta.ts

**File**: `src/cli/tools-meta.ts`

**What**: Delete the entire file (~1090 lines of hardcoded tool metadata with empty schemas).

### Step 2.2: Update src/cli/commands/tool-dispatcher.ts

**File**: `src/cli/commands/tool-dispatcher.ts`

**What**: Remove local tool validation. Send tool name directly to daemon; let daemon's error response handle unknown tools.

**Remove**:
```typescript
import {getToolMeta, getAllToolNames, searchTools} from '../tools-meta.js';
```

**Remove** the local validation block:
```typescript
const meta = getToolMeta(toolName);
if (!meta) {
  const suggestions = searchTools(toolName)
    .map(t => t.name)
    .slice(0, 5);
  throw new AxiError(`未知工具：${toolName}`, 'UNKNOWN_TOOL', suggestions);
}
```

**Remove** the schema-based type coercion:
```typescript
const schemaType = meta.schema[key];
if (schemaType === 'number') toolArgs[key] = Number(value);
else if (schemaType === 'boolean') toolArgs[key] = value === 'true';
```

**Replace** with simple arg parsing (all values as strings, let daemon handle type coercion):
```typescript
const toolArgs: Record<string, unknown> = {};
for (const [key, value] of Object.entries(parsed.flags)) {
  if (typeof value === 'boolean') {
    toolArgs[key] = value;
  } else if (typeof value === 'string' && value.includes(',')) {
    toolArgs[key] = value.split(',').map(s => s.trim());
  } else {
    toolArgs[key] = value;
  }
}
```

### Step 2.3: Update src/cli/commands/list-tools.ts

**File**: `src/cli/commands/list-tools.ts`

**What**: Remove TOOLS_META fallback. Always fetch from daemon.

**Remove** the offline fallback block:
```typescript
if (tools.length === 0) {
  isOffline = true;
  const {getAllToolNames, getToolMeta} = await import('../tools-meta.js');
  tools = getAllToolNames().map(name => {
    const meta = getToolMeta(name);
    return {name, description: meta?.description};
  });
}
```

**Replace** with a proper error message when daemon is unavailable:
```typescript
if (tools.length === 0) {
  throw new AxiError(
    '无法连接后台服务，请先执行：js-reverse start --browserUrl <chrome-debug-url>',
    'DAEMON_UNAVAILABLE',
  );
}
```

### Step 2.4: Update src/cli/index.ts barrel exports

**File**: `src/cli/index.ts`

**What**: Remove `tools-meta` re-exports.

**Remove**:
```typescript
export {
  getToolMeta,
  getAllToolNames,
  searchTools,
  type ToolMeta,
} from './tools-meta.js';
```

### Step 2.5: Verify CLI commands work

**How**: Run `npm run build`, then:
- `js-reverse call list_scripts` — should work or return daemon error
- `js-reverse call nonexistent_tool` — should return clean error from daemon
- `js-reverse list-tools` — should list tools from daemon

---

## Phase 3: IPC Connection Optimization

### Step 3.1: Add DaemonConnection class to client.ts

**File**: `src/daemon/client.ts`

**What**: Add a persistent connection class for REPL and other long-running CLI sessions.

**Add** after `sendCommand()`:
```typescript
/**
 * Persistent daemon connection for REPL and long-running sessions.
 * Reuses a single socket instead of creating a new one per command.
 */
export class DaemonConnection {
  private socket: InstanceType<typeof import('node:net').Socket> | null = null;
  private connected = false;

  async connect(): Promise<void> {
    if (this.connected && this.socket) return;

    const socketPath = getSocketPath();
    this.socket = await new Promise<InstanceType<typeof import('node:net').Socket>>(
      (resolve, reject) => {
        const sock = createConnection(socketPath);
        sock.on('error', reject);
        sock.on('connect', () => resolve(sock));
      },
    );
    this.connected = true;
  }

  async sendCommand(request: {
    method: string;
    tool?: string;
    skill?: string;
    args?: Record<string, unknown>;
  }): Promise<{success: boolean; result?: string; error?: string}> {
    if (!this.connected || !this.socket) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      const sock = this.socket!;
      let response = '';

      const onData = (chunk: Buffer) => {
        response += chunk.toString();
      };
      const onEnd = () => {
        sock.off('data', onData);
        sock.off('error', onError);
        try {
          const trimmed = response.trim();
          const nullIndex = trimmed.indexOf('\0');
          const jsonStr = nullIndex > 0 ? trimmed.slice(0, nullIndex) : trimmed;
          resolve(JSON.parse(jsonStr));
        } catch (err) {
          reject(new Error(`响应解析失败：${err}`));
        }
      };
      const onError = (err: Error) => {
        sock.off('data', onData);
        sock.off('end', onEnd);
        this.connected = false;
        this.socket = null;
        reject(err);
      };

      sock.once('end', onEnd);
      sock.once('error', onError);
      sock.on('data', onData);
      sock.write(JSON.stringify(request) + '\0');
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    this.connected = false;
  }
}
```

**NOTE**: The persistent connection uses `\0`-delimited messages, same as the existing `sendCommand()`. Each `sendCommand` on `DaemonConnection` sends a message and waits for the response, then the socket stays open for the next command. However, looking at the daemon's `startSocketServer()`, each socket connection currently processes ONE message then calls `socket.end()`. This means a persistent connection won't work with the current daemon design unless we also modify the daemon to keep sockets alive.

**Revised approach**: Since the daemon's `PipeTransport` handler calls `socket.end()` after each message, the `DaemonConnection` needs to create a new socket per message (same as current `sendCommand`), but with connection pooling metadata for future optimization. For now, we'll add the class as a thin wrapper around the existing `sendCommand` pattern, with the API ready for persistent connections when the daemon is updated to support them.

**Simplified DaemonConnection** (matching current daemon behavior):
```typescript
export class DaemonConnection {
  /**
   * Persistent connection wrapper.
   * Currently creates a new socket per request (matching daemon behavior).
   * API is ready for persistent connections when daemon supports them.
   */
  async sendCommand(request: {
    method: string;
    tool?: string;
    skill?: string;
    args?: Record<string, unknown>;
  }): Promise<{success: boolean; result?: string; error?: string}> {
    return sendCommand(request);
  }

  /**
   * No-op for now. Will manage persistent socket when daemon supports it.
   */
  async connect(): Promise<void> {
    // Future: establish persistent socket connection
  }

  /**
   * No-op for now. Will close persistent socket when daemon supports it.
   */
  disconnect(): void {
    // Future: close persistent socket connection
  }
}
```

### Step 3.2: Update repl.ts to use DaemonConnection

**File**: `src/cli/commands/repl.ts`

**What**: Use `DaemonConnection` for REPL session lifecycle.

**Changes**:
1. Add import: `import {DaemonConnection, sendCommand} from '../../daemon/client.js';`
2. At REPL start, create a `DaemonConnection` instance
3. Replace all `sendCommand({...})` calls in REPL with `conn.sendCommand({...})`
4. On REPL exit, call `conn.disconnect()`

This is a **structural refactor** only — functionally identical since `DaemonConnection.sendCommand` currently delegates to the existing `sendCommand`. But it establishes the API for future persistent connection optimization.

### Step 3.3: Verify REPL works

**How**: Run `npm run build`, start daemon, enter REPL, run `status`, `list-tools`, `tool list_scripts`.

---

## Phase 4: Cleanup & Documentation

### Step 4.1: Update Architecture.md

**File**: `docs/Architecture.md`

**What**: Update the process architecture diagram and description to reflect:
- `js-reverse-mcp` now directly starts daemon in MCP mode (no fork)
- `src/index.ts` removed
- Single tool registration source (ToolRegistry only)
- Updated IPC flow

### Step 4.2: Update README.md

**File**: `README.md`

**What**: Update the MCP configuration section to reflect the new `js-reverse-mcp` behavior. The command stays the same but the internal architecture changed.

### Step 4.3: Run full test suite

**How**:
```bash
npm run build
npm run typecheck
npm test
```

### Step 4.4: Run docs generation

**How**:
```bash
npm run docs
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| MCP stdio transport startup fails | Keep `js-reverse-mcp.ts` as thin wrapper; if MCP mode fails, error message clearly indicates the issue |
| `src/index.ts` referenced elsewhere | Searched codebase — only `INDEX_SCRIPT_PATH` in `utils.ts` and import in `js-reverse-mcp.ts`. Both removed. |
| `tools-meta.ts` imported elsewhere | Searched — `cli/index.ts`, `tool-dispatcher.ts`, `list-tools.ts`. All updated. |
| REPL persistent connection incompatible | Daemon closes socket after each message. `DaemonConnection` uses same per-call pattern; persistent connections deferred. |
| Build breaks after changes | Phase-by-phase verification: build + typecheck after each phase |

## Execution Order

1. **Phase 1** (MCP layer merge) → Build + verify MCP connectivity
2. **Phase 2** (dual registration cleanup) → Build + verify CLI commands
3. **Phase 3** (IPC optimization) → Build + verify REPL
4. **Phase 4** (docs + tests) → Full verification

Each phase is independently deployable. If Phase 2 fails, Phase 1 changes still work.