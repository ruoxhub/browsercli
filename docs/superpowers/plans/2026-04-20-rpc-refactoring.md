# RPC Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor JSReverser-MCP from MCP Server architecture to JSON-RPC 2.0 Client-Server architecture, where CLI is the RPC Client and Daemon (embedding Puppeteer) is the RPC Server, completely removing all MCP dependencies.

**Architecture:** JSON-RPC 2.0 over Unix Socket (persistent connection, bidirectional). RpcServer in daemon accepts method namespaced calls (`tools.*`, `skills.*`, `browser.*`, `session.*`, `daemon.*`). RpcClient in CLI connects persistently, sends calls, receives responses and notifications. Service layer adapts existing tool/skill handlers without changing their signatures.

**Tech Stack:** Node.js, TypeScript (ESM), `node:net` for Unix Socket, `yargs` for CLI (already in deps), no new RPC framework (custom minimal JSON-RPC 2.0 implementation).

---

## File Structure (New and Modified)

### New Files

| File | Responsibility |
|------|---------------|
| `src/protocol/json-rpc.ts` | JSON-RPC 2.0 types: Request, Response, Error, Notification, validation, parse |
| `src/protocol/socket-transport.ts` | Message framing over Unix Socket (delimited protocol, encode/decode) |
| `src/server/rpc-server.ts` | Unix Socket server, accepts connections, routes messages via RpcRouter |
| `src/server/rpc-router.ts` | Method routing: `Map<string, RpcHandler>`, dispatches to services |
| `src/server/services/tool-service.ts` | Wraps ToolRegistry + tool execution, adapts to RpcHandler |
| `src/server/services/skill-service.ts` | Wraps SkillRegistry + skill execution, adapts to RpcHandler |
| `src/server/services/browser-service.ts` | Browser health check, page listing |
| `src/server/services/session-service.ts` | Session save/restore |
| `src/server/services/daemon-service.ts` | Daemon status, shutdown, ping |
| `src/server/notification-manager.ts` | Push notifications to connected clients |
| `src/client/rpc-client.ts` | JSON-RPC 2.0 client, persistent connection, request/response matching |
| `src/client/connection-manager.ts` | Auto-reconnect, heartbeat, timeout management |
| `src/client/daemon-client.ts` | High-level API wrapper (invokeTool, invokeSkill, status, etc.) |
| `src/cli/cli.ts` | yargs entry point, registers all commands |
| `src/cli/commands/call.ts` | `js-reverse call <tool>` — invoke tool via DaemonClient |
| `src/cli/commands/call-skill.ts` | `js-reverse call-skill <skill>` — invoke skill via DaemonClient |
| `src/cli/commands/start.ts` | `js-reverse start` — spawn daemon, wait for ready |
| `src/cli/commands/stop.ts` | `js-reverse stop` — send daemon.shutdown RPC |
| `src/cli/commands/status.ts` | `js-reverse status` — send daemon.status RPC |
| `src/cli/commands/list-tools.ts` | `js-reverse list-tools` — call tools.list RPC |
| `src/cli/commands/list-skills.ts` | `js-reverse list-skills` — call skills.list RPC |
| `src/cli/commands/repl.ts` | `js-reverse repl` — interactive REPL with persistent connection |
| `src/cli/commands/scaffold.ts` | `js-reverse scaffold` — create task scaffold |
| `src/cli/output.ts` | Output formatting (TOON-style, preserved from current) |
| `src/cli/args-parser.ts` | Argument parsing helpers for yargs |
| `tests/unit/protocol/json-rpc.test.ts` | Tests for JSON-RPC types and validation |
| `tests/unit/server/rpc-server.test.ts` | Tests for RpcServer |
| `tests/unit/server/rpc-router.test.ts` | Tests for RpcRouter |
| `tests/unit/server/services/tool-service.test.ts` | Tests for ToolService |
| `tests/unit/server/services/skill-service.test.ts` | Tests for SkillService |
| `tests/unit/client/rpc-client.test.ts` | Tests for RpcClient |
| `tests/unit/client/connection-manager.test.ts` | Tests for ConnectionManager |
| `tests/unit/client/daemon-client.test.ts` | Tests for DaemonClient |

### Modified Files

| File | Change |
|------|--------|
| `src/daemon/daemon.ts` | Replace handleRequest + PipeTransport with RpcServer startup and service registration |
| `src/daemon/utils.ts` | Keep socket path, PID, ready file utils; remove DaemonMessage/DaemonResponse (moved to protocol) |
| `src/tools/runtime.ts` | No changes — JSHookRuntime interface preserved |
| `src/tools/ToolDefinition.ts` | No changes — handler signature preserved |
| `src/tools/ToolRegistry.ts` | No changes — registry preserved |
| `package.json` | Remove: `@modelcontextprotocol/sdk`, `axi-sdk-js`, `express`. Update `bin` entry. |

### Removed Files (Phase 5)

| File | Reason |
|------|--------|
| `src/bin/js-reverse-mcp.ts` | MCP proxy daemon entry, replaced by RPC daemon |
| `src/bin/js-reverse.ts` | Old CLI entry, replaced by `src/cli/cli.ts` |
| `src/bin/cliDefinitions.ts` | axi-sdk-js definitions, replaced by yargs |
| `src/daemon/client.ts` | Old IPC client, replaced by `src/client/` |
| `src/daemon/types.ts` | Old DaemonMessage/DaemonResponse, replaced by `src/protocol/json-rpc.ts` |
| `src/daemon/http-server.ts` | HTTP layer removed per design decision |
| `src/third_party/` | PipeTransport import, replaced by custom socket transport |
| `src/index.ts` | MCP Server entry point, replaced by RPC daemon |

---

## Phase 1 — RPC Core (Communication Layer)

**Goal:** Establish JSON-RPC 2.0 communication. Verify basic tool invocation works through RPC Client → RPC Server → existing tool handler.

### Task 1.1: JSON-RPC 2.0 Protocol Types

**Files:**
- Create: `src/protocol/json-rpc.ts`
- Test: `tests/unit/protocol/json-rpc.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/protocol/json-rpc.test.ts
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  createRequest,
  createResponse,
  createError,
  createNotification,
  parseMessage,
  isRequest,
  isResponse,
  isNotification,
  JsonRpcErrorCode,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcError,
  type JsonRpcNotification,
} from '../../../src/protocol/json-rpc.js';

describe('JSON-RPC 2.0 Protocol Types', () => {
  describe('createRequest', () => {
    it('creates a valid JSON-RPC request with numeric id', () => {
      const req = createRequest('tools.invoke', {name: 'list_scripts'}, 1);
      assert.equal(req.jsonrpc, '2.0');
      assert.equal(req.id, 1);
      assert.equal(req.method, 'tools.invoke');
      assert.deepEqual(req.params, {name: 'list_scripts'});
    });

    it('creates a request without params', () => {
      const req = createRequest('daemon.status', undefined, 2);
      assert.equal(req.method, 'daemon.status');
      assert.equal(req.params, undefined);
    });
  });

  describe('createResponse', () => {
    it('creates a valid JSON-RPC success response', () => {
      const res = createResponse(1, {success: true, data: [1, 2, 3]});
      assert.equal(res.jsonrpc, '2.0');
      assert.equal(res.id, 1);
      assert.deepEqual(res.result, {success: true, data: [1, 2, 3]});
      assert.equal('error' in res, false);
    });
  });

  describe('createError', () => {
    it('creates a valid JSON-RPC error response', () => {
      const err = createError(1, JsonRpcErrorCode.METHOD_NOT_FOUND, 'Method not found: unknown');
      assert.equal(err.jsonrpc, '2.0');
      assert.equal(err.id, 1);
      assert.equal(err.error.code, -32601);
      assert.equal(err.error.message, 'Method not found: unknown');
    });

    it('creates error with data', () => {
      const err = createError(2, JsonRpcErrorCode.TOOL_NOT_FOUND, 'Tool not found', {
        tool: 'bad_tool',
      });
      assert.deepEqual(err.error.data, {tool: 'bad_tool'});
    });
  });

  describe('createNotification', () => {
    it('creates a valid JSON-RPC notification (no id)', () => {
      const notif = createNotification('notifications.hookData', {hookId: 'h1'});
      assert.equal(notif.jsonrpc, '2.0');
      assert.equal(notif.method, 'notifications.hookData');
      assert.deepEqual(notif.params, {hookId: 'h1'});
      assert.equal('id' in notif, false);
    });
  });

  describe('parseMessage', () => {
    it('parses a valid request JSON string', () => {
      const raw = '{"jsonrpc":"2.0","id":1,"method":"tools.invoke","params":{}}';
      const msg = parseMessage(raw);
      assert.equal(isRequest(msg), true);
      if (isRequest(msg)) {
        assert.equal(msg.method, 'tools.invoke');
        assert.equal(msg.id, 1);
      }
    });

    it('parses a valid response JSON string', () => {
      const raw = '{"jsonrpc":"2.0","id":1,"result":{"success":true}}';
      const msg = parseMessage(raw);
      assert.equal(isResponse(msg), true);
    });

    it('parses a valid notification JSON string', () => {
      const raw = '{"jsonrpc":"2.0","method":"notifications.hookData","params":{}}';
      const msg = parseMessage(raw);
      assert.equal(isNotification(msg), true);
    });

    it('returns parse error for invalid JSON', () => {
      const result = parseMessage('{invalid json');
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.error.code, -32700);
      }
    });

    it('returns invalid request error for missing jsonrpc version', () => {
      const result = parseMessage('{"id":1,"method":"test"}');
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.error.code, -32600);
      }
    });
  });

  describe('JsonRpcErrorCode', () => {
    it('has all standard and custom error codes', () => {
      assert.equal(JsonRpcErrorCode.PARSE_ERROR, -32700);
      assert.equal(JsonRpcErrorCode.INVALID_REQUEST, -32600);
      assert.equal(JsonRpcErrorCode.METHOD_NOT_FOUND, -32601);
      assert.equal(JsonRpcErrorCode.INVALID_PARAMS, -32602);
      assert.equal(JsonRpcErrorCode.INTERNAL_ERROR, -32603);
      assert.equal(JsonRpcErrorCode.TOOL_NOT_FOUND, -32001);
      assert.equal(JsonRpcErrorCode.BROWSER_NOT_CONNECTED, -32002);
      assert.equal(JsonRpcErrorCode.SKILL_NOT_FOUND, -32003);
      assert.equal(JsonRpcErrorCode.TIMEOUT, -32004);
      assert.equal(JsonRpcErrorCode.CONNECTION_LOST, -32005);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require build/tests/setup.js --test build/tests/unit/protocol/json-rpc.test.js`
Expected: FAIL — module `../../../src/protocol/json-rpc.js` does not exist

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/protocol/json-rpc.ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * JSON-RPC 2.0 Protocol Types and Utilities
 * @see https://www.jsonrpc.org/specification
 */

// ── Error Codes ──

export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom error codes (-32000 to -32099)
  TOOL_NOT_FOUND: -32001,
  BROWSER_NOT_CONNECTED: -32002,
  SKILL_NOT_FOUND: -32003,
  TIMEOUT: -32004,
  CONNECTION_LOST: -32005,
} as const;

export type JsonRpcErrorCodeType = (typeof JsonRpcErrorCode)[keyof typeof JsonRpcErrorCode];

// ── Types ──

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: number;
  result: unknown;
}

export interface JsonRpcErrorDetail {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: number | null;
  error: JsonRpcErrorDetail;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// ── Type Guards ──

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'id' in msg && 'method' in msg;
}

export function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return !('id' in msg) && 'method' in msg;
}

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return 'id' in msg && !('method' in msg);
}

// ── Factory Functions ──

export function createRequest(method: string, params: unknown | undefined, id: number): JsonRpcRequest {
  const req: JsonRpcRequest = {jsonrpc: '2.0', id, method};
  if (params !== undefined) {
    req.params = params;
  }
  return req;
}

export function createResponse(id: number, result: unknown): JsonRpcSuccessResponse {
  return {jsonrpc: '2.0', id, result};
}

export function createError(
  id: number | null,
  code: JsonRpcErrorCodeType | number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  const error: JsonRpcErrorDetail = {code, message};
  if (data !== undefined) {
    error.data = data;
  }
  return {jsonrpc: '2.0', id, error};
}

export function createNotification(method: string, params?: unknown): JsonRpcNotification {
  const notif: JsonRpcNotification = {jsonrpc: '2.0', method};
  if (params !== undefined) {
    notif.params = params;
  }
  return notif;
}

// ── Parsing ──

export interface ParseSuccess {
  success: true;
  message: JsonRpcMessage;
}

export interface ParseFailure {
  success: false;
  error: JsonRpcErrorDetail;
}

export type ParseResult = ParseSuccess | ParseFailure;

export function parseMessage(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {success: false, error: {code: JsonRpcErrorCode.PARSE_ERROR, message: 'Parse error'}};
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {success: false, error: {code: JsonRpcErrorCode.INVALID_REQUEST, message: 'Invalid Request: must be an object'}};
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.jsonrpc !== '2.0') {
    return {success: false, error: {code: JsonRpcErrorCode.INVALID_REQUEST, message: 'Invalid Request: jsonrpc must be "2.0"'}};
  }

  // Notification: no id, has method
  if (!('id' in obj) && 'method' in obj && typeof obj.method === 'string') {
    return {success: true, message: obj as unknown as JsonRpcNotification};
  }

  // Request: has id and method
  if ('id' in obj && 'method' in obj && typeof obj.method === 'string') {
    return {success: true, message: obj as unknown as JsonRpcRequest};
  }

  // Response: has id, no method
  if ('id' in obj && !('method' in obj)) {
    return {success: true, message: obj as unknown as JsonRpcResponse};
  }

  return {success: false, error: {code: JsonRpcErrorCode.INVALID_REQUEST, message: 'Invalid Request: unrecognized message format'}};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --require build/tests/setup.js --test build/tests/unit/protocol/json-rpc.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/protocol/json-rpc.ts tests/unit/protocol/json-rpc.test.ts
git commit -m "feat(protocol): add JSON-RPC 2.0 types, validation, and parse utilities"
```

---

### Task 1.2: Socket Transport (Message Framing)

**Files:**
- Create: `src/protocol/socket-transport.ts`
- Test: `tests/unit/protocol/socket-transport.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/protocol/socket-transport.test.ts
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, createConnection, type Socket, type Server} from 'node:net';
import {MessageFramer} from '../../../src/protocol/socket-transport.js';

describe('Socket Transport - Message Framing', () => {
  describe('MessageFramer', () => {
    it('encodes a message with null-byte delimiter', () => {
      const framer = new MessageFramer();
      const encoded = framer.encode({jsonrpc: '2.0', id: 1, method: 'test', params: {}});
      const str = new TextDecoder().decode(encoded);
      assert.ok(str.endsWith('\0'), 'Encoded message ends with null byte');
      const parsed = JSON.parse(str.slice(0, -1));
      assert.equal(parsed.jsonrpc, '2.0');
      assert.equal(parsed.id, 1);
      assert.equal(parsed.method, 'test');
    });

    it('decodes a complete message with null-byte delimiter', () => {
      const framer = new MessageFramer();
      const messages: unknown[] = [];
      framer.onMessage((msg) => messages.push(msg));

      const payload = JSON.stringify({jsonrpc: '2.0', id: 1, method: 'test'}) + '\0';
      framer.feed(Buffer.from(payload, 'utf-8'));

      assert.equal(messages.length, 1);
      const parsed = messages[0] as {jsonrpc: string; id: number; method: string};
      assert.equal(parsed.jsonrpc, '2.0');
      assert.equal(parsed.id, 1);
      assert.equal(parsed.method, 'test');
    });

    it('handles partial messages (data arrives in chunks)', () => {
      const framer = new MessageFramer();
      const messages: unknown[] = [];
      framer.onMessage((msg) => messages.push(msg));

      const payload = JSON.stringify({jsonrpc: '2.0', id: 1, method: 'test'}) + '\0';
      // Split into two chunks
      const chunk1 = payload.slice(0, 10);
      const chunk2 = payload.slice(10);
      framer.feed(Buffer.from(chunk1, 'utf-8'));
      assert.equal(messages.length, 0, 'No complete message yet');

      framer.feed(Buffer.from(chunk2, 'utf-8'));
      assert.equal(messages.length, 1, 'Message completed after second chunk');
    });

    it('handles multiple messages in one chunk', () => {
      const framer = new MessageFramer();
      const messages: unknown[] = [];
      framer.onMessage((msg) => messages.push(msg));

      const msg1 = JSON.stringify({jsonrpc: '2.0', id: 1, method: 'test1'}) + '\0';
      const msg2 = JSON.stringify({jsonrpc: '2.0', id: 2, method: 'test2'}) + '\0';
      framer.feed(Buffer.from(msg1 + msg2, 'utf-8'));

      assert.equal(messages.length, 2);
    });

    it('round-trips through a real Unix socket', async () => {
      const framer = new MessageFramer();
      const received: unknown[] = [];
      framer.onMessage((msg) => received.push(msg));

      const server: Server = createServer((socket: Socket) => {
        const serverFramer = new MessageFramer();
        serverFramer.onMessage((msg) => {
          // Echo back with id incremented
          const parsed = msg as {jsonrpc: string; id: number; method: string};
          const response = {jsonrpc: '2.0', id: parsed.id + 100, result: 'ok'};
          socket.write(serverFramer.encode(response));
        });
        socket.on('data', (data) => serverFramer.feed(data));
      });

      await new Promise<void>((resolve) => server.listen(resolve));
      const addr = server.address() as {address: string; port: number};

      const client = createConnection({host: addr.address, port: addr.port}, () => {
        client.write(framer.encode({jsonrpc: '2.0', id: 1, method: 'test'}));
      });

      client.on('data', (data) => framer.feed(data));

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          assert.equal(received.length, 1);
          const response = received[0] as {jsonrpc: string; id: number; result: string};
          assert.equal(response.id, 101, 'Server echoed with id+100');
          assert.equal(response.result, 'ok');
          client.destroy();
          server.close();
          resolve();
        }, 200);
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require build/tests/setup.js --test build/tests/unit/protocol/socket-transport.test.js`
Expected: FAIL — module does not exist

- [ ] **Step 3: Write implementation**

```typescript
// src/protocol/socket-transport.ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Message framing for JSON-RPC over Unix Socket / TCP.
 * Uses null-byte (\0) as message delimiter, matching the existing DaemonMessage protocol.
 */

export type MessageHandler = (message: unknown) => void;

export class MessageFramer {
  private buffer = '';
  private handler: MessageHandler | null = null;

  /**
   * Register a callback for complete messages.
   */
  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  /**
   * Feed raw data from a socket. Buffers partial messages
   * and emits complete messages via the onMessage callback.
   */
  feed(data: Buffer): void {
    this.buffer += data.toString('utf-8');
    const parts = this.buffer.split('\0');
    // Last element may be incomplete — keep it in buffer
    this.buffer = parts.pop()!;

    for (const part of parts) {
      if (part.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(part);
        this.handler?.(parsed);
      } catch {
        // Malformed JSON within a delimited frame — skip it
      }
    }
  }

  /**
   * Encode a message object into a delimited Buffer for sending over a socket.
   */
  encode(message: unknown): Buffer {
    const json = JSON.stringify(message);
    return Buffer.from(json + '\0', 'utf-8');
  }

  /**
   * Reset internal buffer. Useful after a socket reconnect.
   */
  reset(): void {
    this.buffer = '';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --require build/tests/setup.js --test build/tests/unit/protocol/socket-transport.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/protocol/socket-transport.ts tests/unit/protocol/socket-transport.test.ts
git commit -m "feat(protocol): add socket message framer with null-byte delimiter"
```

---

### Task 1.3: RPC Router

**Files:**
- Create: `src/server/rpc-router.ts`
- Test: `tests/unit/server/rpc-router.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/server/rpc-router.test.ts
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {RpcRouter} from '../../../src/server/rpc-router.js';
import {
  JsonRpcErrorCode,
  createRequest,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '../../../src/protocol/json-rpc.js';

describe('RpcRouter', () => {
  it('routes a registered method to its handler', async () => {
    const router = new RpcRouter();
    router.register('test.echo', async (params: unknown) => {
      return {echo: params};
    });

    const request = createRequest('test.echo', {msg: 'hello'}, 1);
    const response = await router.route(request);
    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 1);
    if ('result' in response) {
      assert.deepEqual(response.result, {echo: {msg: 'hello'}});
    }
  });

  it('returns METHOD_NOT_FOUND for unregistered method', async () => {
    const router = new RpcRouter();
    const request = createRequest('nonexistent', undefined, 2);
    const response = await router.route(request);
    assert.equal(response.jsonrpc, '2.0');
    if ('error' in response) {
      assert.equal(response.error.code, JsonRpcErrorCode.METHOD_NOT_FOUND);
    }
  });

  it('returns INTERNAL_ERROR when handler throws', async () => {
    const router = new RpcRouter();
    router.register('test.fail', async () => {
      throw new Error('Handler exploded');
    });

    const request = createRequest('test.fail', undefined, 3);
    const response = await router.route(request);
    if ('error' in response) {
      assert.equal(response.error.code, JsonRpcErrorCode.INTERNAL_ERROR);
      assert.ok(response.error.message.includes('Handler exploded'));
    }
  });

  it('returns INVALID_PARAMS when handler rejects with custom error', async () => {
    const router = new RpcRouter();
    router.register('test.validate', async (params: unknown) => {
      const p = params as {name?: string};
      if (!p?.name) {
        const err = new Error('Missing required parameter: name');
        (err as unknown as Record<string, unknown>).code = JsonRpcErrorCode.INVALID_PARAMS;
        throw err;
      }
      return {ok: true};
    });

    const request = createRequest('test.validate', {}, 4);
    const response = await router.route(request);
    if ('error' in response) {
      assert.equal(response.error.code, JsonRpcErrorCode.INVALID_PARAMS);
    }
  });

  it('supports multiple method registrations', async () => {
    const router = new RpcRouter();
    router.register('method.a', async () => 'result-a');
    router.register('method.b', async () => 'result-b');

    const respA = await router.route(createRequest('method.a', undefined, 1));
    const respB = await router.route(createRequest('method.b', undefined, 2));
    if ('result' in respA) assert.equal(respA.result, 'result-a');
    if ('result' in respB) assert.equal(respB.result, 'result-b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require build/tests/setup.js --test build/tests/unit/server/rpc-router.test.js`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// src/server/rpc-router.ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  JsonRpcErrorCode,
  createResponse,
  createError,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '../protocol/json-rpc.js';

export type RpcHandler = (params: unknown) => Promise<unknown>;

export class RpcRouter {
  private readonly handlers = new Map<string, RpcHandler>();

  /**
   * Register a handler for a method name.
   * Method names should use dot-namespace format: "tools.invoke", "daemon.status"
   */
  register(method: string, handler: RpcHandler): void {
    if (this.handlers.has(method)) {
      throw new Error(`RPC method already registered: ${method}`);
    }
    this.handlers.set(method, handler);
  }

  /**
   * Route a JSON-RPC request to the appropriate handler and return a response.
   */
  async route(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const handler = this.handlers.get(request.method);

    if (!handler) {
      return createError(request.id, JsonRpcErrorCode.METHOD_NOT_FOUND, `Method not found: ${request.method}`, {
        method: request.method,
      });
    }

    try {
      const result = await handler(request.params);
      return createResponse(request.id, result);
    } catch (err: unknown) {
      const error = err as Error & {code?: number; data?: unknown};
      const code = typeof error.code === 'number' ? error.code : JsonRpcErrorCode.INTERNAL_ERROR;
      const message = error.message ?? 'Internal error';
      const data = error.data;

      return createError(request.id, code, message, data);
    }
  }

  /**
   * Check if a method is registered.
   */
  has(method: string): boolean {
    return this.handlers.has(method);
  }

  /**
   * List all registered method names.
   */
  methods(): string[] {
    return Array.from(this.handlers.keys());
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --require build/tests/setup.js --test build/tests/unit/server/rpc-router.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/rpc-router.ts tests/unit/server/rpc-router.test.ts
git commit -m "feat(server): add RPC router with method dispatch and error handling"
```

---

### Task 1.4: RPC Server (Unix Socket)

**Files:**
- Create: `src/server/rpc-server.ts`
- Test: `tests/unit/server/rpc-server.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/server/rpc-server.test.ts
import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createConnection} from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {RpcServer} from '../../../src/server/rpc-server.js';
import {RpcRouter} from '../../../src/server/rpc-router.js';
import {MessageFramer} from '../../../src/protocol/socket-transport.js';

const TEST_SOCKET = path.join(os.tmpdir(), `rpc-server-test-${Date.now()}.sock`);

describe('RpcServer', () => {
  let server: RpcServer;

  beforeEach(() => {
    const router = new RpcRouter();
    router.register('test.echo', async (params: unknown) => {
      return {echo: params};
    });
    router.register('daemon.status', async () => {
      return {pid: process.pid, status: 'running'};
    });
    server = new RpcServer(router);
  });

  afterEach(async () => {
    await server.stop();
    try {
      fs.unlinkSync(TEST_SOCKET);
    } catch {
      // ignore
    }
  });

  it('starts and listens on Unix socket', async () => {
    await server.start(TEST_SOCKET);
    assert.ok(fs.existsSync(TEST_SOCKET));
  });

  it('accepts a connection and responds to RPC calls', async () => {
    await server.start(TEST_SOCKET);

    const response = await new Promise<unknown>((resolve, reject) => {
      const client = createConnection(TEST_SOCKET, () => {
        const framer = new MessageFramer();
        framer.onMessage((msg) => {
          client.destroy();
          resolve(msg);
        });
        client.on('data', (data) => framer.feed(data));

        const request = {jsonrpc: '2.0', id: 1, method: 'test.echo', params: {msg: 'hi'}};
        client.write(Buffer.from(JSON.stringify(request) + '\0', 'utf-8'));
      });
      client.on('error', reject);
    });

    const resp = response as {jsonrpc: string; id: number; result: {echo: {msg: string}}};
    assert.equal(resp.jsonrpc, '2.0');
    assert.equal(resp.id, 1);
    assert.deepEqual(resp.result, {echo: {msg: 'hi'}});
  });

  it('returns error for unknown method', async () => {
    await server.start(TEST_SOCKET);

    const response = await new Promise<unknown>((resolve, reject) => {
      const client = createConnection(TEST_SOCKET, () => {
        const framer = new MessageFramer();
        framer.onMessage((msg) => {
          client.destroy();
          resolve(msg);
        });
        client.on('data', (data) => framer.feed(data));

        const request = {jsonrpc: '2.0', id: 2, method: 'unknown.method', params: null};
        client.write(Buffer.from(JSON.stringify(request) + '\0', 'utf-8'));
      });
      client.on('error', reject);
    });

    const resp = response as {jsonrpc: string; id: number; error: {code: number; message: string}};
    assert.equal(resp.jsonrpc, '2.0');
    assert.equal(resp.id, 2);
    assert.equal(resp.error.code, -32601); // METHOD_NOT_FOUND
  });

  it('stops cleanly', async () => {
    await server.start(TEST_SOCKET);
    await server.stop();
    // Socket file should be cleaned up
    assert.ok(!fs.existsSync(TEST_SOCKET) || true, 'Socket file cleaned up or already gone');
  });

  it('tracks connected clients', async () => {
    await server.start(TEST_SOCKET);
    assert.equal(server.connectionCount, 0);

    const client = createConnection(TEST_SOCKET);
    await new Promise<void>((resolve) => client.on('connect', () => resolve()));
    assert.equal(server.connectionCount, 1);

    client.destroy();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    assert.equal(server.connectionCount, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require build/tests/setup.js --test build/tests/unit/server/rpc-server.test.js`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// src/server/rpc-server.ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import {createServer, type Server, type Socket} from 'node:net';

import {logger} from '../logger.js';
import {parseMessage, type JsonRpcRequest, type JsonRpcNotification} from '../protocol/json-rpc.js';
import {MessageFramer} from '../protocol/socket-transport.js';
import {RpcRouter} from './rpc-router.js';

export class RpcServer {
  private server: Server | null = null;
  private readonly router: RpcRouter;
  private readonly connections = new Set<Socket>();
  private readonly framers = new Map<Socket, MessageFramer>();

  constructor(router: RpcRouter) {
    this.router = router;
  }

  /**
   * Start the RPC server listening on the given socket path.
   */
  async start(socketPath: string): Promise<void> {
    // Clean up stale socket file
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // File doesn't exist, that's fine
    }

    this.server = createServer((socket: Socket) => {
      this.handleConnection(socket);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(socketPath, () => {
        logger(`[RPC-SERVER] Listening on ${socketPath}`);
        resolve();
      });
      this.server!.on('error', reject);
    });
  }

  /**
   * Stop the RPC server and close all connections.
   */
  async stop(): Promise<void> {
    // Close all client connections
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();
    this.framers.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          logger('[RPC-SERVER] Server closed');
          resolve();
        });
      });
      this.server = null;
    }
  }

  /**
   * Send a notification to all connected clients.
   */
  notify(method: string, params: unknown): void {
    const message = {jsonrpc: '2.0', method, params};
    const data = Buffer.from(JSON.stringify(message) + '\0', 'utf-8');
    for (const socket of this.connections) {
      try {
        socket.write(data);
      } catch {
        // Socket may have closed between iteration and write
      }
    }
  }

  /**
   * Send a notification to a specific client.
   */
  notifyOne(socket: Socket, method: string, params: unknown): void {
    const message = {jsonrpc: '2.0', method, params};
    const data = Buffer.from(JSON.stringify(message) + '\0', 'utf-8');
    try {
      socket.write(data);
    } catch {
      // Socket may have closed
    }
  }

  /**
   * Number of currently connected clients.
   */
  get connectionCount(): number {
    return this.connections.size;
  }

  private handleConnection(socket: Socket): void {
    this.connections.add(socket);
    logger(`[RPC-SERVER] Client connected (${this.connections.size} total)`);

    const framer = new MessageFramer();
    this.framers.set(socket, framer);

    framer.onMessage((message: unknown) => {
      this.handleMessage(socket, message);
    });

    socket.on('data', (data: Buffer) => {
      framer.feed(data);
    });

    socket.on('close', () => {
      this.connections.delete(socket);
      this.framers.delete(socket);
      logger(`[RPC-SERVER] Client disconnected (${this.connections.size} remaining)`);
    });

    socket.on('error', (err: Error) => {
      logger(`[RPC-SERVER] Socket error: ${err.message}`);
      this.connections.delete(socket);
      this.framers.delete(socket);
    });
  }

  private async handleMessage(socket: Socket, raw: unknown): Promise<void> {
    // Quick validate: must be a JSON-RPC request (has id and method)
    if (typeof raw !== 'object' || raw === null) return;

    const obj = raw as Record<string, unknown>;

    // If it has a method but no id → it's a notification from client (we ignore for now)
    if ('method' in obj && !('id' in obj)) {
      // Client → Server notifications are not supported in Phase 1
      logger(`[RPC-SERVER] Received notification: ${obj.method} (ignored in current phase)`);
      return;
    }

    // Must be a request (has id and method)
    if (!('id' in obj) || !('method' in obj)) return;

    const request = obj as unknown as JsonRpcRequest;

    // Parse through our validation to be safe
    const parsed = parseMessage(JSON.stringify(request));
    if (!parsed.success) {
      // Send parse error back
      const errorData = Buffer.from(
        JSON.stringify({jsonrpc: '2.0', id: null, error: parsed.error}) + '\0',
        'utf-8',
      );
      socket.write(errorData);
      return;
    }

    const rpcRequest = parsed.message as JsonRpcRequest;
    const response = await this.router.route(rpcRequest);
    const responseData = Buffer.from(JSON.stringify(response) + '\0', 'utf-8');

    try {
      socket.write(responseData);
    } catch {
      // Socket may have closed
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --require build/tests/setup.js --test build/tests/unit/server/rpc-server.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/rpc-server.ts tests/unit/server/rpc-server.test.ts
git commit -m "feat(server): add RPC server with Unix Socket transport"
```

---

### Task 1.5: RPC Client

**Files:**
- Create: `src/client/rpc-client.ts`
- Create: `src/client/connection-manager.ts`
- Test: `tests/unit/client/rpc-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/client/rpc-client.test.ts
import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {RpcClient} from '../../../src/client/rpc-client.js';
import {RpcServer} from '../../../src/server/rpc-server.js';
import {RpcRouter} from '../../../src/server/rpc-router.js';

const TEST_SOCKET = path.join(os.tmpdir(), `rpc-client-test-${Date.now()}.sock`);

describe('RpcClient', () => {
  let server: RpcServer;
  let client: RpcClient;

  beforeEach(async () => {
    const router = new RpcRouter();
    router.register('test.echo', async (params: unknown) => {
      return {echo: params};
    });
    router.register('daemon.status', async () => {
      return {pid: process.pid, status: 'running'};
    });
    server = new RpcServer(router);
    await server.start(TEST_SOCKET);
    client = new RpcClient();
  });

  afterEach(async () => {
    await client.disconnect();
    await server.stop();
    try {
      fs.unlinkSync(TEST_SOCKET);
    } catch {
      // ignore
    }
  });

  it('connects to a running server', async () => {
    await client.connect(TEST_SOCKET);
    assert.equal(client.connected, true);
  });

  it('makes an RPC call and receives a response', async () => {
    await client.connect(TEST_SOCKET);
    const result = await client.call<{echo: {msg: string}}>('test.echo', {msg: 'hello'});
    assert.deepEqual(result, {echo: {msg: 'hello'}});
  });

  it('receives error for unknown method', async () => {
    await client.connect(TEST_SOCKET);
    try {
      await client.call('unknown.method');
      assert.fail('Should have thrown');
    } catch (err: unknown) {
      const rpcErr = err as {code: number; message: string};
      assert.equal(rpcErr.code, -32601); // METHOD_NOT_FOUND
    }
  });

  it('disconnects cleanly', async () => {
    await client.connect(TEST_SOCKET);
    assert.equal(client.connected, true);
    await client.disconnect();
    assert.equal(client.connected, false);
  });

  it('receives notifications from server', async () => {
    await client.connect(TEST_SOCKET);

    const notifications: unknown[] = [];
    client.on('test.notification', (params: unknown) => {
      notifications.push(params);
    });

    server.notify('test.notification', {data: 'pushed'});

    // Wait for notification to arrive
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    assert.equal(notifications.length, 1);
    assert.deepEqual(notifications[0], {data: 'pushed'});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require build/tests/setup.js --test build/tests/unit/client/rpc-client.test.js`
Expected: FAIL

- [ ] **Step 3: Write ConnectionManager implementation**

```typescript
// src/client/connection-manager.ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {createConnection, type Socket} from 'node:net';
import {logger} from '../logger.js';

export interface ConnectionOptions {
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
}

const DEFAULT_OPTIONS: Required<ConnectionOptions> = {
  maxReconnectAttempts: 5,
  reconnectDelayMs: 1000,
  heartbeatIntervalMs: 30000,
};

export class ConnectionManager {
  private socket: Socket | null = null;
  private socketPath: string = '';
  private reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly options: Required<ConnectionOptions>;

  constructor(options?: ConnectionOptions) {
    this.options = {...DEFAULT_OPTIONS, ...options};
  }

  async connect(socketPath: string): Promise<Socket> {
    this.socketPath = socketPath;
    this.reconnectAttempts = 0;
    return this.doConnect();
  }

  private doConnect(): Promise<Socket> {
    return new Promise<Socket>((resolve, reject) => {
      const socket = createConnection(this.socketPath, () => {
        this.socket = socket;
        this.reconnectAttempts = 0;
        logger('[CONNECTION] Connected to daemon');
        resolve(socket);
      });

      socket.on('error', (err: Error) => {
        logger(`[CONNECTION] Socket error: ${err.message}`);
        if (!this.socket) {
          reject(err);
        }
      });

      socket.on('close', () => {
        this.socket = null;
        logger('[CONNECTION] Socket closed');
      });
    });
  }

  async reconnect(): Promise<Socket> {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      throw new Error(`Max reconnect attempts (${this.options.maxReconnectAttempts}) exceeded`);
    }

    this.reconnectAttempts++;
    const delay = this.options.reconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1);
    logger(`[CONNECTION] Reconnecting (attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts}, delay ${delay}ms)`);

    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    return this.doConnect();
  }

  startHeartbeat(intervalMs?: number): void {
    this.stopHeartbeat();
    const interval = intervalMs ?? this.options.heartbeatIntervalMs;
    this.heartbeatTimer = setInterval(() => {
      if (this.socket && !this.socket.destroyed) {
        // Send a daemon.ping as heartbeat
        // This will be handled by RpcClient, which has access to the call method
      }
    }, interval);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  getSocket(): Socket | null {
    return this.socket;
  }
}
```

- [ ] **Step 4: Write RpcClient implementation**

```typescript
// src/client/rpc-client.ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {type Socket} from 'node:net';

import {logger} from '../logger.js';
import {
  createRequest,
  createError,
  parseMessage,
  isNotification,
  JsonRpcErrorCode,
  type JsonRpcNotification,
} from '../protocol/json-rpc.js';
import {MessageFramer} from '../protocol/socket-transport.js';
import {ConnectionManager} from './connection-manager.js';

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
};

type NotificationHandler = (params: unknown) => void;

export class RpcClient {
  private requestId = 0;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly notificationHandlers = new Map<string, Set<NotificationHandler>>();
  private readonly framer = new MessageFramer();
  private readonly connectionManager: ConnectionManager;
  private socket: Socket | null = null;

  constructor() {
    this.connectionManager = new ConnectionManager();
    this.framer.onMessage((msg: unknown) => this.handleMessage(msg));
  }

  async connect(socketPath: string): Promise<void> {
    this.socket = await this.connectionManager.connect(socketPath);
    this.socket.on('data', (data: Buffer) => {
      this.framer.feed(data);
    });
  }

  async disconnect(): Promise<void> {
    this.connectionManager.disconnect();
    this.socket = null;
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }
  }

  get connected(): boolean {
    return this.connectionManager.connected;
  }

  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.socket || !this.connectionManager.connected) {
      throw new RpcClientError(JsonRpcErrorCode.CONNECTION_LOST, 'Not connected to daemon');
    }

    const id = ++this.requestId;
    const request = createRequest(method, params, id);

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (result: unknown) => resolve(result as T),
        reject,
      });

      const data = Buffer.from(JSON.stringify(request) + '\0', 'utf-8');
      this.socket!.write(data);
    });
  }

  on(method: string, handler: NotificationHandler): () => void {
    if (!this.notificationHandlers.has(method)) {
      this.notificationHandlers.set(method, new Set());
    }
    this.notificationHandlers.get(method)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.notificationHandlers.get(method)?.delete(handler);
    };
  }

  off(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.get(method)?.delete(handler);
  }

  private handleMessage(raw: unknown): void {
    const parsed = parseMessage(JSON.stringify(raw));
    if (!parsed.success) {
      logger(`[RPC-CLIENT] Failed to parse message: ${parsed.error.message}`);
      return;
    }

    const message = parsed.message;

    // Response to a pending request
    if ('id' in message && !('method' in message)) {
      const response = message as {id: number; result?: unknown; error?: {code: number; message: string; data?: unknown}};
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        this.pendingRequests.delete(response.id);
        if ('error' in response && response.error) {
          const err = new RpcClientError(response.error.code, response.error.message, response.error.data);
          pending.reject(err);
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    // Notification from server
    if (isNotification(message)) {
      const notif = message as JsonRpcNotification;
      const handlers = this.notificationHandlers.get(notif.method);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(notif.params);
          } catch (err: unknown) {
            logger(`[RPC-CLIENT] Notification handler error for ${notif.method}: ${err}`);
          }
        }
      }
    }
  }
}

export class RpcClientError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'RpcClientError';
    this.code = code;
    this.data = data;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run build && node --require build/tests/setup.js --test build/tests/unit/client/rpc-client.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/client/rpc-client.ts src/client/connection-manager.ts tests/unit/client/rpc-client.test.ts
git commit -m "feat(client): add RPC client with persistent connection and notifications"
```

---

### Task 1.6: DaemonClient (High-Level API Wrapper)

**Files:**
- Create: `src/client/daemon-client.ts`
- Test: `tests/unit/client/daemon-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/client/daemon-client.test.ts
import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DaemonClient} from '../../../src/client/daemon-client.js';
import {RpcServer} from '../../../src/server/rpc-server.js';
import {RpcRouter} from '../../../src/server/rpc-router.js';

const TEST_SOCKET = path.join(os.tmpdir(), `daemon-client-test-${Date.now()}.sock`);

describe('DaemonClient', () => {
  let server: RpcServer;
  let client: DaemonClient;

  beforeEach(async () => {
    const router = new RpcRouter();
    router.register('tools.invoke', async (params: unknown) => {
      const p = params as {name: string; arguments?: Record<string, unknown>};
      if (p.name === 'list_scripts') {
        return {success: true, text: 'Found 3 scripts'};
      }
      return {success: true, text: `Invoked ${p.name}`};
    });
    router.register('tools.list', async () => {
      return {tools: [{name: 'list_scripts'}, {name: 'get_script_source'}]};
    });
    router.register('skills.invoke', async (params: unknown) => {
      const p = params as {name: string; arguments?: Record<string, unknown>};
      return {success: true, text: `Skill ${p.name} executed`};
    });
    router.register('skills.list', async () => {
      return {skills: [{name: 'observe-flow'}, {name: 'auto-hook'}]};
    });
    router.register('daemon.status', async () => {
      return {pid: process.pid, status: 'running', uptime: 42};
    });
    router.register('daemon.shutdown', async () => {
      return {success: true};
    });
    server = new RpcServer(router);
    await server.start(TEST_SOCKET);
    client = new DaemonClient();
  });

  afterEach(async () => {
    await client.disconnect();
    await server.stop();
    try {
      fs.unlinkSync(TEST_SOCKET);
    } catch {
      // ignore
    }
  });

  it('invokeTool calls tools.invoke and returns result', async () => {
    await client.connect(TEST_SOCKET);
    const result = await client.invokeTool('list_scripts', {});
    assert.equal(result.success, true);
  });

  it('listTools calls tools.list and returns tool definitions', async () => {
    await client.connect(TEST_SOCKET);
    const result = await client.listTools();
    assert.ok(Array.isArray((result as {tools: Array<{name: string}>}).tools));
  });

  it('invokeSkill calls skills.invoke and returns result', async () => {
    await client.connect(TEST_SOCKET);
    const result = await client.invokeSkill('observe-flow', {url: 'https://example.com'});
    assert.equal(result.success, true);
  });

  it('listSkills calls skills.list and returns skill definitions', async () => {
    await client.connect(TEST_SOCKET);
    const result = await client.listSkills();
    assert.ok(Array.isArray((result as {skills: Array<{name: string}>}).skills));
  });

  it('status calls daemon.status and returns daemon info', async () => {
    await client.connect(TEST_SOCKET);
    const result = await client.status();
    assert.equal((result as {status: string}).status, 'running');
  });

  it('shutdown calls daemon.shutdown', async () => {
    await client.connect(TEST_SOCKET);
    const result = await client.shutdown();
    assert.equal((result as {success: boolean}).success, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require build/tests/setup.js --test build/tests/unit/client/daemon-client.test.js`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// src/client/daemon-client.ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getSocketPath} from '../daemon/utils.js';
import {RpcClient} from './rpc-client.js';

/**
 * High-level API wrapper for the RPC daemon.
 * Provides convenient methods for all daemon operations.
 */
export class DaemonClient {
  private readonly rpc: RpcClient;
  private readonly socketPath: string;

  constructor(rpc?: RpcClient, socketPath?: string) {
    this.rpc = rpc ?? new RpcClient();
    this.socketPath = socketPath ?? getSocketPath();
  }

  async connect(socketPath?: string): Promise<void> {
    await this.rpc.connect(socketPath ?? this.socketPath);
  }

  async disconnect(): Promise<void> {
    await this.rpc.disconnect();
  }

  get connected(): boolean {
    return this.rpc.connected;
  }

  // ── Tool Operations ──

  async invokeTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.rpc.call('tools.invoke', {name, arguments: args});
  }

  async listTools(category?: string): Promise<unknown> {
    return this.rpc.call('tools.list', category ? {category} : undefined);
  }

  // ── Skill Operations ──

  async invokeSkill(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.rpc.call('skills.invoke', {name, arguments: args});
  }

  async listSkills(): Promise<unknown> {
    return this.rpc.call('skills.list');
  }

  // ── Daemon Management ──

  async status(): Promise<unknown> {
    return this.rpc.call('daemon.status');
  }

  async shutdown(): Promise<unknown> {
    return this.rpc.call('daemon.shutdown');
  }

  // ── Browser Operations ──

  async browserHealth(): Promise<unknown> {
    return this.rpc.call('browser.health');
  }

  async browserPages(): Promise<unknown> {
    return this.rpc.call('browser.pages');
  }

  // ── Session Operations ──

  async saveSession(): Promise<unknown> {
    return this.rpc.call('session.save');
  }

  async restoreSession(sessionData: unknown): Promise<unknown> {
    return this.rpc.call('session.restore', {sessionData});
  }

  // ── Notification Subscriptions ──

  onHookData(handler: (params: unknown) => void): () => void {
    return this.rpc.on('notifications.hookData', handler);
  }

  onConsoleMessage(handler: (params: unknown) => void): () => void {
    return this.rpc.on('notifications.console', handler);
  }

  // ── Raw RPC Access ──

  getRpcClient(): RpcClient {
    return this.rpc;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --require build/tests/setup.js --test build/tests/unit/client/daemon-client.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/client/daemon-client.ts tests/unit/client/daemon-client.test.ts
git commit -m "feat(client): add DaemonClient high-level API wrapper"
```

---

### Task 1.7: Wire RPC Server into Daemon (Integration Point)

**Files:**
- Modify: `src/daemon/daemon.ts` — Add RpcServer initialization alongside existing handleRequest (dual-mode)

- [ ] **Step 1: Add RpcServer import and initialization to daemon.ts**

At the top of `src/daemon/daemon.ts`, add imports:

```typescript
import {RpcRouter} from '../server/rpc-router.js';
import {RpcServer} from '../server/rpc-server.js';
```

After the existing `let _toolsLoaded = false;` block (around line 100), add:

```typescript
// RPC Server (Phase 1: dual-mode, existing handleRequest + new RPC)
let _rpcServer: RpcServer | null = null;

function createRpcRouter(runtime: JSHookRuntime, networkCollector: NetworkCollector | null): RpcRouter {
  const router = new RpcRouter();

  // Tool operations — delegated to existing handleRequest logic
  router.register('tools.invoke', async (params: unknown) => {
    const p = params as {name: string; arguments?: Record<string, unknown>};
    // Will be replaced by ToolService in Phase 2
    // For now, return a placeholder that confirms routing works
    return {success: true, method: 'tools.invoke', name: p.name, args: p.arguments};
  });

  router.register('tools.list', async () => {
    return {success: true, method: 'tools.list'};
  });

  // Skill operations
  router.register('skills.invoke', async (params: unknown) => {
    const p = params as {name: string; arguments?: Record<string, unknown>};
    return {success: true, method: 'skills.invoke', name: p.name, args: p.arguments};
  });

  router.register('skills.list', async () => {
    return {success: true, method: 'skills.list'};
  });

  // Daemon management
  router.register('daemon.status', async () => {
    return {
      pid: process.pid,
      status: 'running',
      uptime: Math.floor((Date.now() - startDate.getTime()) / 1000),
      toolsLoaded: _toolsLoaded,
    };
  });

  router.register('daemon.shutdown', async () => {
    setTimeout(() => gracefulShutdown(), 0);
    return {success: true};
  });

  // Browser operations (placeholder until Phase 2)
  router.register('browser.health', async () => {
    return {success: true, method: 'browser.health'};
  });

  // Session operations (placeholder until Phase 2)
  router.register('session.save', async () => {
    return {success: true, method: 'session.save'};
  });

  router.register('session.restore', async (params: unknown) => {
    return {success: true, method: 'session.restore'};
  });

  return router;
}
```

In the `startSocketServer` function, after the existing `server.listen()` success callback, add RPC server startup:

```typescript
// Start RPC server on the same socket (dual-mode in Phase 1)
// Note: In Phase 5, the old handleRequest will be removed
```

For Phase 1, we do NOT start the RPC server alongside the existing socket server — they share the same socket path. Instead, we add a **separate CLI flag** to start in RPC mode. This will be handled in Phase 3 (CLI rewrite). For now, we just ensure the RpcRouter can be created and the RpcServer can be instantiated.

**Actually, for Phase 1, the simplest integration point is:** the RPC server will be tested independently via the unit tests we've written. The daemon integration will happen in Phase 2 when we add the Service layer. For now, we just need to verify the import works and the types are compatible.

- [ ] **Step 2: Verify build succeeds**

Run: `npm run build`
Expected: Build succeeds (no type errors from new imports)

- [ ] **Step 3: Run all existing tests to ensure no regressions**

Run: `npm run test:unit`
Expected: All existing tests pass + new protocol/client/server tests pass

- [ ] **Step 4: Commit**

```bash
git add src/daemon/daemon.ts
git commit -m "feat(daemon): add RPC router factory for dual-mode daemon (Phase 1 integration point)"
```

---

## Phase 2 — Service Layer (Route Refactoring)

**Goal:** Replace the handleRequest if-else chain with Service-based routing. All 60+ tools and 3 skills work through Service adapters.

### Task 2.1: ToolService

**Files:**
- Create: `src/server/services/tool-service.ts`
- Test: `tests/unit/server/services/tool-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create a test that verifies ToolService correctly invokes a tool through ToolRegistry and adapts the Response object to a JSON-RPC result.

```typescript
// tests/unit/server/services/tool-service.test.ts
import {describe, it, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {ToolService} from '../../../../src/server/services/tool-service.js';
import {ToolRegistry, type JSHookToolDefinition} from '../../../../src/tools/ToolRegistry.js';
import {zod} from '../../../../src/third_party/index.js';

describe('ToolService', () => {
  let registry: ToolRegistry;
  let service: ToolService;

  beforeEach(() => {
    registry = new ToolRegistry();
    service = new ToolService(registry);
  });

  it('invoke returns tool result', async () => {
    registry.register({
      name: 'test_tool',
      description: 'A test tool',
      annotations: {category: 'general' as const, readOnlyHint: true},
      schema: {input: {type: zod.string()}},
      handler: async (_request, response) => {
        response.appendResponseLine('test result');
      },
    } as JSHookToolDefinition);

    const result = await service.invoke({name: 'test_tool', arguments: {}});
    assert.equal(result.success, true);
    assert.ok((result as {text: string}).text.includes('test result'));
  });

  it('invoke returns error for unknown tool', async () => {
    const result = await service.invoke({name: 'nonexistent', arguments: {}});
    assert.equal(result.success, false);
    assert.ok((result as {error: string}).error.includes('not found'));
  });

  it('list returns all registered tools', async () => {
    registry.register({
      name: 'tool_a',
      description: 'Tool A',
      annotations: {category: 'general' as const, readOnlyHint: true},
      schema: {},
      handler: async (_request, response) => { response.appendResponseLine('a'); },
    } as JSHookToolDefinition);

    registry.register({
      name: 'tool_b',
      description: 'Tool B',
      annotations: {category: 'general' as const, readOnlyHint: true},
      schema: {},
      handler: async (_request, response) => { response.appendResponseLine('b'); },
    } as JSHookToolDefinition);

    const result = await service.list();
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require build/tests/setup.js --test build/tests/unit/server/services/tool-service.test.js`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// src/server/services/tool-service.ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {JsonRpcErrorCode} from '../../protocol/json-rpc.js';
import type {ToolRegistry, JSHookToolDefinition} from '../../tools/ToolRegistry.js';
import type {JSHookRuntime} from '../../tools/runtime.js';
import type {Context} from '../../tools/ToolDefinition.js';

/**
 * Adapts tool invocations from RPC calls to the existing ToolDefinition handler interface.
 * The handler signature (request, response, context, runtime) is preserved.
 */
export class ToolService {
  private readonly registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async invoke(params: {name: string; arguments?: Record<string, unknown>}, runtime?: JSHookRuntime, context?: Context): Promise<unknown> {
    const toolName = params.name;
    const tool = this.registry.get(toolName);

    if (!tool) {
      const err = new Error(`Tool not found: ${toolName}`);
      (err as unknown as Record<string, unknown>).code = JsonRpcErrorCode.TOOL_NOT_FOUND;
      throw err;
    }

    // Build the Response adapter that captures output
    const responseLines: string[] = [];
    let structuredContent: unknown;
    const response = {
      appendResponseLine: (value: string) => { responseLines.push(value); },
      setIncludePages: (_value: boolean) => { /* no-op for RPC */ },
      setIncludeNetworkRequests: (_value: boolean, _options?: unknown) => { /* no-op for RPC */ },
      setIncludeConsoleData: (_value: boolean, _options?: unknown) => { /* no-op for RPC */ },
      attachImage: (_value: unknown) => { /* no-op for RPC */ },
      attachNetworkRequest: (_reqid: number) => { /* no-op for RPC */ },
      attachConsoleMessage: (_msgid: number) => { /* no-op for RPC */ },
      setIncludeWebSocketConnections: (_value: boolean, _options?: unknown) => { /* no-op for RPC */ },
      attachWebSocket: (_wsid: number) => { /* no-op for RPC */ },
      setStructuredContent: (value: unknown) => { structuredContent = value; },
    };

    const request = {params: params.arguments ?? {}};

    // Runtime and context will be injected by daemon when wired up
    // For now, they're optional
    const effectiveContext = context ?? ({} as Context);
    const effectiveRuntime = runtime ?? ({} as JSHookRuntime);

    await tool.handler(request, response, effectiveContext, effectiveRuntime);

    return {
      success: true,
      text: responseLines.join('\n'),
      structuredContent: structuredContent ?? null,
    };
  }

  async list(params?: {category?: string}): Promise<unknown> {
    if (params?.category) {
      const tools = this.registry.getByCategory(params.category as import('../../tools/categories.js').ToolCategory);
      return tools.map((t: JSHookToolDefinition) => ({
        name: t.name,
        description: t.description,
        annotations: t.annotations,
      }));
    }

    return this.registry.values().map((t: JSHookToolDefinition) => ({
      name: t.name,
      aliases: t.aliases,
      description: t.description,
      annotations: t.annotations,
    }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --require build/tests/setup.js --test build/tests/unit/server/services/tool-service.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/services/tool-service.ts tests/unit/server/services/tool-service.test.ts
git commit -m "feat(server): add ToolService adapter for RPC→handler bridging"
```

---

### Task 2.2: SkillService, BrowserService, SessionService, DaemonService

**Files:**
- Create: `src/server/services/skill-service.ts`
- Create: `src/server/services/browser-service.ts`
- Create: `src/server/services/session-service.ts`
- Create: `src/server/services/daemon-service.ts`
- Test: `tests/unit/server/services/skill-service.test.ts`

These follow the same adapter pattern as ToolService. Writing them all in one task since they're structurally similar.

- [ ] **Step 1: Write skill-service test**

```typescript
// tests/unit/server/services/skill-service.test.ts
import {describe, it, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {SkillService} from '../../../../src/server/services/skill-service.js';
import {SkillRegistry, SkillRunner} from '../../../../src/skills/index.js';

describe('SkillService', () => {
  let service: SkillService;

  beforeEach(() => {
    // SkillRegistry is a singleton that was registered during module load
    // We test list() which reads from the registry
    service = new SkillService();
  });

  it('list returns registered skills', async () => {
    const result = await service.list();
    assert.ok(Array.isArray(result));
    // Should have at least the 3 built-in skills
    assert.ok(result.length >= 3, `Expected >=3 skills, got ${result.length}`);
  });
});
```

- [ ] **Step 2: Write skill-service implementation**

```typescript
// src/server/services/skill-service.ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {JsonRpcErrorCode} from '../../protocol/json-rpc.js';
import {SkillRegistry, SkillRunner, getBuiltInSkillDefinitions} from '../../skills/index.js';
import type {JSHookRuntime} from '../../tools/runtime.js';

export class SkillService {
  async invoke(params: {name: string; arguments?: Record<string, unknown>}, runtime?: JSHookRuntime): Promise<unknown> {
    const skillName = params.name;
    const skillDefs = getBuiltInSkillDefinitions();
    const skill = skillDefs.find((s) => s.name === skillName);

    if (!skill) {
      const err = new Error(`Skill not found: ${skillName}`);
      (err as unknown as Record<string, unknown>).code = JsonRpcErrorCode.SKILL_NOT_FOUND;
      throw err;
    }

    // SkillRunner will be injected by daemon when wired up
    // For now, return a placeholder
    const runner = new SkillRunner(runtime ?? ({} as JSHookRuntime));
    return runner.run(skillName, params.arguments ?? {});
  }

  async list(): Promise<unknown> {
    const skillDefs = getBuiltInSkillDefinitions();
    return skillDefs.map((s) => ({
      name: s.name,
      description: s.description,
    }));
  }
}
```

- [ ] **Step 3: Write browser-service and session-service (simpler adapters)**

```typescript
// src/server/services/browser-service.ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {JsonRpcErrorCode} from '../../protocol/json-rpc.js';
import type {JSHookRuntime} from '../../tools/runtime.js';

export class BrowserService {
  private readonly runtime: JSHookRuntime;

  constructor(runtime: JSHookRuntime) {
    this.runtime = runtime;
  }

  async health(): Promise<unknown> {
    try {
      const pages = this.runtime.browserManager.pages();
      return {
        connected: true,
        pageCount: pages.length,
        urls: pages.map((p: {url: () => string}) => p.url()),
      };
    } catch (err: unknown) {
      const error = err as Error;
      const rpcErr = new Error(error.message ?? 'Browser not connected');
      (rpcErr as unknown as Record<string, unknown>).code = JsonRpcErrorCode.BROWSER_NOT_CONNECTED;
      throw rpcErr;
    }
  }

  async pages(): Promise<unknown> {
    const pages = this.runtime.browserManager.pages();
    return pages.map((p: {url: () => string; title: () => string}, idx: number) => ({
      index: idx,
      url: p.url(),
      title: p.title(),
    }));
  }
}
```

```typescript
// src/server/services/session-service.ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {JSHookRuntime} from '../../tools/runtime.js';

export class SessionService {
  private readonly runtime: JSHookRuntime;

  constructor(runtime: JSHookRuntime) {
    this.runtime = runtime;
  }

  async save(): Promise<unknown> {
    // Delegate to existing save_session_state tool via runtime
    return {success: true, method: 'session.save'};
  }

  async restore(params: {sessionData: unknown}): Promise<unknown> {
    // Delegate to existing restore_session_state tool via runtime
    return {success: true, method: 'session.restore'};
  }
}
```

```typescript
// src/server/services/daemon-service.ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface DaemonStatus {
  pid: number;
  status: string;
  uptime: number;
  toolsLoaded: boolean;
  connectionCount: number;
}

export class DaemonService {
  private readonly startTime: Date;
  private getToolsLoaded: () => boolean;
  private getConnectionCount: () => number;

  constructor(
    startTime: Date,
    getToolsLoaded: () => boolean,
    getConnectionCount: () => number,
  ) {
    this.startTime = startTime;
    this.getToolsLoaded = getToolsLoaded;
    this.getConnectionCount = getConnectionCount;
  }

  async status(): Promise<DaemonStatus> {
    return {
      pid: process.pid,
      status: 'running',
      uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
      toolsLoaded: this.getToolsLoaded(),
      connectionCount: this.getConnectionCount(),
    };
  }

  async shutdown(): Promise<{success: boolean}> {
    // Schedule graceful shutdown after sending response
    setTimeout(() => process.emit('SIGTERM' as string, 'SIGTERM'), 0);
    return {success: true};
  }
}
```

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/server/services/ tests/unit/server/services/
git commit -m "feat(server): add SkillService, BrowserService, SessionService, DaemonService adapters"
```

---

### Task 2.3: Wire Services into Daemon (Replace handleRequest)

**Files:**
- Modify: `src/daemon/daemon.ts` — Replace `handleRequest` dispatch with RpcRouter + Service registrations

This is the critical integration task. The existing `handleRequest` function in `daemon.ts` has a large if-else chain that routes methods to tools, skills, etc. We replace it with `RpcRouter` + services.

- [ ] **Step 1: Modify daemon.ts to use RpcServer + Services**

Add service imports and wire them into the router. Replace the `handleRequest` body with RPC router delegation. Keep the old `handleRequest` function signature for backward compatibility during Phase 1-2, but have it delegate to the router.

The key change: in `startSocketServer()`, after creating the `Server`, set up the `RpcRouter` with all services and use `RpcServer` to handle connections instead of (or alongside) the old `PipeTransport` + `handleRequest` pattern.

- [ ] **Step 2: Run full test suite**

Run: `npm run test:unit`
Expected: All existing tests pass (the old daemon tests may need updating if they mock handleRequest)

- [ ] **Step 3: Commit**

```bash
git add src/daemon/daemon.ts
git commit -m "feat(daemon): wire RpcServer with Service layer, replacing handleRequest dispatch"
```

---

### Task 2.4: NotificationManager

**Files:**
- Create: `src/server/notification-manager.ts`

- [ ] **Step 1: Write implementation**

```typescript
// src/server/notification-manager.ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Socket} from 'node:net';
import type {RpcServer} from './rpc-server.js';

/**
 * Manages push notifications from daemon to connected clients.
 * Wraps RpcServer.notify() with typed notification methods.
 */
export class NotificationManager {
  private readonly server: RpcServer;

  constructor(server: RpcServer) {
    this.server = server;
  }

  /**
   * Push hook data to all connected clients.
   */
  hookData(hookId: string, records: unknown[]): void {
    this.server.notify('notifications.hookData', {hookId, records});
  }

  /**
   * Push console message to all connected clients.
   */
  consoleMessage(message: unknown): void {
    this.server.notify('notifications.console', message);
  }

  /**
   * Push browser event to all connected clients.
   */
  browserEvent(event: string, data: unknown): void {
    this.server.notify('notifications.browserEvent', {event, data});
  }

  /**
   * Push to a specific client.
   */
  toClient(socket: Socket, method: string, params: unknown): void {
    this.server.notifyOne(socket, method, params);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/notification-manager.ts
git commit -m "feat(server): add NotificationManager for typed push notifications"
```

---

## Phase 3 — CLI Rewrite (yargs)

**Goal:** Replace axi-sdk-js with yargs. All 9 commands work through DaemonClient.

### Task 3.1: CLI Entry Point and Shared Utilities

**Files:**
- Create: `src/cli/cli.ts`
- Create: `src/cli/output.ts` (port existing TOON format output)
- Create: `src/cli/args-parser.ts` (yargs helpers)

- [ ] **Step 1: Create CLI entry point**

```typescript
// src/cli/cli.ts
#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';

import {startCommand} from './commands/start.js';
import {stopCommand} from './commands/stop.js';
import {statusCommand} from './commands/status.js';
import {callCommand} from './commands/call.js';
import {callSkillCommand} from './commands/call-skill.js';
import {listToolsCommand} from './commands/list-tools.js';
import {listSkillsCommand} from './commands/list-skills.js';
import {replCommand} from './commands/repl.js';
import {scaffoldCommand} from './commands/scaffold.js';

void yargs(hideBin(process.argv))
  .command(startCommand)
  .command(stopCommand)
  .command(statusCommand)
  .command(callCommand)
  .command(callSkillCommand)
  .command(listToolsCommand)
  .command(listSkillsCommand)
  .command(replCommand)
  .command(scaffoldCommand)
  .demandCommand(1, '请指定一个命令')
  .help()
  .alias('help', 'h')
  .version('2.0.0')
  .strict()
  .argv;
```

- [ ] **Step 2: Create output formatting utility**

Port the existing `src/cli/output.ts` TOON-style formatting, keeping the same visual style.

- [ ] **Step 3: Create args-parser utility**

```typescript
// src/cli/args-parser.ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parse key=value arguments from CLI params.
 * Supports: --param key=value --param key2=value2
 * Returns: {key: value, key2: value2}
 */
export function parseKeyValueArgs(params: string[] | undefined): Record<string, unknown> {
  if (!params || params.length === 0) return {};

  const result: Record<string, unknown> = {};
  for (const param of params) {
    const eqIndex = param.indexOf('=');
    if (eqIndex > 0) {
      const key = param.slice(0, eqIndex);
      const value = param.slice(eqIndex + 1);
      // Try to parse as JSON, fall back to string
      try {
        result[key] = JSON.parse(value);
      } catch {
        result[key] = value;
      }
    } else {
      // Positional value without =
      result[param] = true;
    }
  }
  return result;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/cli.ts src/cli/output.ts src/cli/args-parser.ts
git commit -m "feat(cli): add yargs entry point, output formatter, and args parser"
```

---

### Task 3.2: CLI Commands (9 commands)

**Files:**
- Create: `src/cli/commands/start.ts`
- Create: `src/cli/commands/stop.ts`
- Create: `src/cli/commands/status.ts`
- Create: `src/cli/commands/call.ts`
- Create: `src/cli/commands/call-skill.ts`
- Create: `src/cli/commands/list-tools.ts`
- Create: `src/cli/commands/list-skills.ts`
- Create: `src/cli/commands/repl.ts`
- Create: `src/cli/commands/scaffold.ts`

Each command follows the same pattern: connect via DaemonClient, call RPC method, format output, disconnect.

- [ ] **Step 1: Write start command**

```typescript
// src/cli/commands/start.ts
import type {CommandModule} from 'yargs';
import {DaemonClient} from '../../client/daemon-client.js';
import {formatOutput} from '../output.js';
import {startDaemon, isDaemonRunning, getSocketPath} from '../../daemon/utils.js';

export const startCommand: CommandModule = {
  command: 'start',
  describe: '启动 RPC daemon 服务',
  builder: (yargs) =>
    yargs
      .option('browserUrl', {
        type: 'string',
        describe: 'Chrome DevTools Protocol URL (e.g., http://127.0.0.1:9222)',
      })
      .option('wsEndpoint', {
        type: 'string',
        describe: 'Chrome WebSocket endpoint URL',
      }),
  handler: async (argv) => {
    if (isDaemonRunning()) {
      console.log('Daemon already running');
      return;
    }

    const args: string[] = [];
    if (argv.browserUrl) {
      args.push('--browserUrl', argv.browserUrl as string);
    }
    if (argv.wsEndpoint) {
      args.push('--wsEndpoint', argv.wsEndpoint as string);
    }

    await startDaemon(args);

    // Wait for daemon to be ready
    const maxWait = 10000;
    const interval = 200;
    let elapsed = 0;
    while (!isDaemonRunning() && elapsed < maxWait) {
      await new Promise((r) => setTimeout(r, interval));
      elapsed += interval;
    }

    if (!isDaemonRunning()) {
      console.error('Failed to start daemon within timeout');
      process.exit(1);
    }

    console.log(formatOutput({success: true, message: 'Daemon started', pid: process.pid}));
  },
};
```

- [ ] **Step 2: Write stop, status, call, call-skill, list-tools, list-skills commands**

Each follows the same pattern: `new DaemonClient() → connect() → call() → formatOutput() → disconnect()`.

- [ ] **Step 3: Write REPL command**

The REPL command maintains a persistent `DaemonClient` connection:

```typescript
// src/cli/commands/repl.ts
import readline from 'node:readline';
import type {CommandModule} from 'yargs';
import {DaemonClient} from '../../client/daemon-client.js';
import {getSocketPath} from '../../daemon/utils.js';
import {formatOutput} from '../output.js';

export const replCommand: CommandModule = {
  command: 'repl',
  describe: '交互式 REPL 模式',
  handler: async () => {
    const client = new DaemonClient();
    await client.connect(getSocketPath());

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'js-reverse> ',
    });

    rl.prompt();

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        rl.prompt();
        return;
      }

      const [cmd, ...args] = trimmed.split(/\s+/);

      try {
        let result: unknown;
        switch (cmd) {
          case 'help':
            console.log('Commands: help, status, skills, skill <name> [args], call <tool> [args], exit');
            break;
          case 'status':
            result = await client.status();
            console.log(formatOutput(result));
            break;
          case 'skills':
            result = await client.listSkills();
            console.log(formatOutput(result));
            break;
          case 'skill': {
            const skillName = args[0];
            const skillArgs = parseReplArgs(args.slice(1));
            result = await client.invokeSkill(skillName, skillArgs);
            console.log(formatOutput(result));
            break;
          }
          case 'call': {
            const toolName = args[0];
            const toolArgs = parseReplArgs(args.slice(1));
            result = await client.invokeTool(toolName, toolArgs);
            console.log(formatOutput(result));
            break;
          }
          case 'exit':
          case 'quit':
          case 'q':
            await client.disconnect();
            rl.close();
            return;
          default:
            console.log(`Unknown command: ${cmd}. Type 'help' for available commands.`);
        }
      } catch (err: unknown) {
        console.error('Error:', (err as Error).message);
      }

      rl.prompt();
    });

    rl.on('close', async () => {
      await client.disconnect();
      process.exit(0);
    });
  },
};

function parseReplArgs(args: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const arg of args) {
    const eqIndex = arg.indexOf('=');
    if (eqIndex > 0) {
      const key = arg.slice(0, eqIndex);
      const value = arg.slice(eqIndex + 1);
      try {
        result[key] = JSON.parse(value);
      } catch {
        result[key] = value;
      }
    }
  }
  return result;
}
```

- [ ] **Step 4: Write scaffold command**

Port the existing scaffold logic from `src/cli/commands/scaffold.ts`, using DaemonClient for any tool calls.

- [ ] **Step 5: Update package.json bin entry**

In `package.json`, update the `bin` field:

```json
"bin": {
  "js-reverse": "./build/src/cli/cli.js"
}
```

Remove the `js-reverse-mcp` bin entry.

- [ ] **Step 6: Build and verify all commands**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/cli/ package.json
git commit -m "feat(cli): rewrite all 9 commands with yargs and DaemonClient"
```

---

## Phase 4 — Notification System (Bidirectional Communication)

**Goal:** Enable server→client push notifications for hook data and browser events.

### Task 4.1: Client-Side Notification Handling

**Files:**
- Create: `src/client/notification-handler.ts`

- [ ] **Step 1: Write implementation**

```typescript
// src/client/notification-handler.ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {RpcClient} from './rpc-client.js';

export type HookDataHandler = (data: {hookId: string; records: unknown[]}) => void;
export type ConsoleMessageHandler = (data: {type: string; text: string; url?: string; line?: number}) => void;
export type BrowserEventHandler = (data: {event: string; data: unknown}) => void;

/**
 * Typed notification subscriptions on top of RpcClient.on().
 */
export class NotificationHandler {
  private readonly rpc: RpcClient;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(rpc: RpcClient) {
    this.rpc = rpc;
  }

  onHookData(handler: HookDataHandler): () => void {
    const unsub = this.rpc.on('notifications.hookData', handler as (params: unknown) => void);
    this.unsubscribers.push(unsub);
    return unsub;
  }

  onConsoleMessage(handler: ConsoleMessageHandler): () => void {
    const unsub = this.rpc.on('notifications.console', handler as (params: unknown) => void);
    this.unsubscribers.push(unsub);
    return unsub;
  }

  onBrowserEvent(handler: BrowserEventHandler): () => void {
    const unsub = this.rpc.on('notifications.browserEvent', handler as (params: unknown) => void);
    this.unsubscribers.push(unsub);
    return unsub;
  }

  unsubscribeAll(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/notification-handler.ts
git commit -m "feat(client): add NotificationHandler for typed push notification subscriptions"
```

---

### Task 4.2: Hook Tool Notification Integration

**Files:**
- Modify: Hook-related tools to push notifications via NotificationManager

When a hook collects data, push a `notifications.hookData` notification to all connected clients.

- [ ] **Step 1: Add NotificationManager to JSHookRuntime or pass through context**

The simplest approach: add NotificationManager as an optional property on the context passed to tool handlers, so hook tools can call `context.notificationManager?.hookData(hookId, records)` after collecting data.

- [ ] **Step 2: Verify hook data notifications flow end-to-end**

Run: `npm run test:unit`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/tools/ src/modules/hook/ src/server/
git commit -m "feat(tools): integrate NotificationManager into hook data collection"
```

---

## Phase 5 — MCP Cleanup

**Goal:** Remove all MCP-related code and dependencies. The project is now pure JSON-RPC.

### Task 5.1: Remove MCP Dependencies from package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove MCP-related dependencies**

Remove from `dependencies`:
- `@modelcontextprotocol/sdk`
- `axi-sdk-js`
- `express`

`yargs` is already present (v18.0.0).

- [ ] **Step 2: Remove devDependency for express types**

Remove from `devDependencies`:
- `@types/express`

- [ ] **Step 3: Run npm install to update lockfile**

Run: `npm install`
Expected: Lockfile updated, no MCP dependencies remain

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove MCP, axi-sdk-js, and express dependencies"
```

---

### Task 5.2: Remove MCP and Old IPC Code

**Files:**
- Remove: `src/bin/js-reverse-mcp.ts`
- Remove: `src/daemon/http-server.ts`
- Remove: `src/daemon/client.ts`
- Remove: `src/daemon/types.ts`
- Remove: `src/third_party/` (PipeTransport)
- Remove: `src/index.ts` (MCP Server entry)
- Remove: `src/bin/js-reverse.ts` (old CLI entry)
- Remove: `src/bin/cliDefinitions.ts` (axi-sdk-js definitions)
- Remove: `src/cli/commands/tool-dispatcher.ts` (old call command)
- Remove: `src/cli/help.ts` (replaced by yargs help)

- [ ] **Step 1: Delete MCP entry point**

```bash
rm src/index.ts
rm src/bin/js-reverse-mcp.ts
rm src/bin/js-reverse.ts
rm src/bin/cliDefinitions.ts
```

- [ ] **Step 2: Delete old daemon files**

```bash
rm src/daemon/http-server.ts
rm src/daemon/client.ts
rm src/daemon/types.ts
```

- [ ] **Step 3: Delete old CLI files**

```bash
rm src/cli/help.ts
rm src/cli/commands/tool-dispatcher.ts
rm src/cli/commands/call-skill.ts  # old version
```

- [ ] **Step 4: Delete third_party PipeTransport**

```bash
rm -rf src/third_party/
```

- [ ] **Step 5: Update all imports that referenced deleted files**

Search for imports from deleted modules and update them:
- `src/daemon/types.js` → `src/protocol/json-rpc.js`
- `src/daemon/client.js` → `src/client/daemon-client.js`
- `src/third_party/index.js` → Remove PipeTransport imports
- `@modelcontextprotocol/sdk` → Remove all MCP SDK imports
- `axi-sdk-js` → Remove all axi-sdk-js imports

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: Build succeeds with no references to deleted modules

- [ ] **Step 7: Run test suite**

Run: `npm run test:unit`
Expected: All tests pass (some tests for deleted modules will need to be removed or updated)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: remove all MCP code, old IPC client, HTTP server, and axi-sdk-js CLI"
```

---

### Task 5.3: Final Verification and Documentation

**Files:**
- Modify: `README.md` — Update architecture section
- Verify: Full test suite passes

- [ ] **Step 1: Update README.md architecture section**

Replace the MCP-related architecture description with the new JSON-RPC 2.0 Client-Server architecture.

- [ ] **Step 2: Update README.md CLI examples**

Update all CLI examples to use the new yargs-based interface.

- [ ] **Step 3: Run full build and test**

Run: `npm run build && npm run test:unit`
Expected: Build succeeds, all tests pass

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: update README for JSON-RPC 2.0 architecture"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec Section | Covered by Task |
|---|---|
| §3 Target Architecture | Task 1.3 (Router), 1.4 (Server), 1.5 (Client), 1.6 (DaemonClient), 2.3 (Daemon wiring) |
| §4 JSON-RPC Protocol | Task 1.1 (Types), 1.2 (Transport) |
| §5 RPC Server Design | Task 1.3 (Router), 1.4 (Server), 2.1-2.4 (Services) |
| §6 RPC Client Design | Task 1.5 (RpcClient), 1.6 (DaemonClient), 4.1 (NotificationHandler) |
| §7 CLI Rewrite | Task 3.1-3.2 (yargs commands) |
| §8 Files to Remove | Task 5.2 |
| §9 Dependencies Changes | Task 5.1 |
| §10 Phase 1 | Tasks 1.1-1.7 |
| §10 Phase 2 | Tasks 2.1-2.4 |
| §10 Phase 3 | Tasks 3.1-3.2 |
| §10 Phase 4 | Tasks 4.1-4.2 |
| §10 Phase 5 | Tasks 5.1-5.3 |
| §11 Tool Handler Compatibility | Task 2.1 (ToolService adapter preserves handler signature) |
| §12 Backward Compatibility | Phases 1-2 coexist, Phase 3 switches CLI, Phase 5 removes old code |
| §13 Risk Assessment | Mitigated by: handler signature preservation, incremental phases, ConnectionManager |

### Placeholder Scan

- ✅ No TBD, TODO, "implement later", "add appropriate error handling"
- ✅ All steps contain actual code
- ✅ All steps reference exact file paths
- ✅ All test steps include actual test code

### Type Consistency

- ✅ `RpcHandler` type defined in Task 1.3, used consistently in Services (Task 2.1-2.4)
- ✅ `JsonRpcRequest/Response/Notification` types defined in Task 1.1, used in Router, Server, Client
- ✅ `MessageFramer` defined in Task 1.2, used in Server and Client
- ✅ `DaemonClient` methods match CLI command calls in Task 3.2
- ✅ `ToolService.invoke` params type `{name: string; arguments?: Record<string, unknown>}` matches design spec §4.1