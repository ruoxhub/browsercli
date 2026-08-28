# Anything Analyzer 迁移 — P1 会话与 SQLite 持久化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地统一抓包会话（Session）与 SQLite 持久化地基：`DatabaseManager`、`SessionStore`（`better-sqlite3`）、`CaptureSessionManager` 状态机、`CaptureEngine` 摄入归一化，以及 `session_create` / `session_list` / `session_get_data` 三个 MCP 工具。

**Architecture:** 持久化层抽象为 `SessionStore` 接口，首期唯一实现 `SqliteSessionStore`（驱动 `better-sqlite3`，保留 Node 20.x）。`CaptureSessionManager` 管活动会话 + 序号 + 状态机；`CaptureEngine` 把 CDP/Proxy/Hook/Snapshot 事件归一化写入活动会话并桥接 WebSocket（本计划只用可注入的 `emitToWs` 回调作为 seam，真实 CDP/Proxy 订阅与 UI 消费在 P2/P3/P4）。经 `RuntimeServices` lazy getter + `runtime.ts` getter 暴露 `captureSessionManager`，MCP 工具通过 `getRuntime()` 访问。

**Tech Stack:** TypeScript ESM · `better-sqlite3`（+ `@types/better-sqlite3`）· `node:test` · `zod`（`src/third_party`）· `defineTool`

**Spec:** `docs/superpowers/specs/2026-08-26-anything-analyzer-migration-design.md`（§4 存储、§5 模块、§6 工具契约）

## Global Constraints

- Node 引擎 floor：`^20.19.0 || ^22.12.0 || >=23`；SQLite 驱动已定 `better-sqlite3`，**保留 Node 20.x 支持**（spec §4.1 / 决策项 D1 已定）。
- 数据库路径：`<packageRoot>/.cache/reverser/reverser.db`（spec §4.1）。
- `status` 值域：`idle | capturing | paused | analyzing | completed | stopped | error`（spec §4.2）。
- `hook_type` 为 `TEXT`（应用层值域 `fetch|xhr|crypto|crypto_lib|cookie|storage|websocket|wasm`），**无 SQL CHECK**（spec §4.5）。
- 会话/代理解耦：`session_create` 仅含 `name`/`targetUrl`，无 `setSystemProxy`（spec §6.1 / D4 已定）。
- 工具类别：`session_create` / `session_list` / `session_get_data` 均用 `ToolCategory.NETWORK`，与 proxy 捕获域一致。
- 工具注册走 `defineTool`（`src/tools/ToolDefinition.ts`）；新增 domain 后运行 `npm run build:index` 重新生成 `src/tools/generated-tools-index.ts`（该文件手改无效，由 `scripts/generate-tools-index.ts` 生成）。
- ESLint/Prettier：`singleQuote: true`、`trailingComma: all`、`arrowParens: avoid`、`endOfLine: lf`；内置模块 `node:` 前缀；类型导入/导出显式 `type`。
- 测试：`node:test`（`describe`/`it` + `assert`），文件 `tests/unit/**/*.test.ts` 镜像 `src/`；源码导入用 `.js` 后缀。

---

### Task 1: 依赖与数据库路径 helper

**Files:**
- Modify: `package.json`（dependencies + devDependencies）
- Modify: `src/utils/projectPaths.ts`
- Test: `tests/unit/utils/project-paths.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `resolveDefaultSessionDbFile(moduleUrl: string): string`

- [ ] **Step 1: 安装依赖**

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

Expected：`package.json` 新增 `dependencies["better-sqlite3"]` 与 `devDependencies["@types/better-sqlite3"]`，`package-lock.json` 更新。若 `better-sqlite3` 需源码编译（Windows 无 prebuilt 时），按提示安装 node-gyp + VS Build Tools；主流平台均有 prebuilt 二进制。

- [ ] **Step 2: 写失败测试**

在 `tests/unit/utils/project-paths.test.ts` 追加（文件已有 `findPackageRoot` 与 `resolvePackageRoot` 导入，按需补 `path` 导入）：

```ts
import {resolveDefaultSessionDbFile} from '../../../src/utils/projectPaths.js';

it('resolves session db under .cache/reverser from package root', () => {
  const repoRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
  assert.strictEqual(
    resolveDefaultSessionDbFile(import.meta.url),
    path.join(repoRoot, '.cache', 'reverser', 'reverser.db'),
  );
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/utils/project-paths.test.js`
Expected: FAIL（`resolveDefaultSessionDbFile` 未导出）。

- [ ] **Step 4: 实现 helper**

在 `src/utils/projectPaths.ts` 的 `resolveDefaultCodeCacheDir` 之后追加：

```ts
export function resolveDefaultSessionDbFile(moduleUrl: string): string {
  return path.join(resolvePackageRoot(moduleUrl), '.cache', 'reverser', 'reverser.db');
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/utils/project-paths.test.js`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/utils/projectPaths.ts tests/unit/utils/project-paths.test.ts
git commit -m "build(session): add better-sqlite3 dep and session db path helper"
```

---

### Task 2: DatabaseManager（建库 + 迁移）

**Files:**
- Create: `src/database/DatabaseManager.ts`
- Test: `tests/unit/database/DatabaseManager.test.ts`

**Interfaces:**
- Consumes: `resolveDefaultSessionDbFile`（Task 1）
- Produces: `DatabaseManager` 类，方法 `init(): Database.Database`、`getDb(): Database.Database`、`close(): void`、getter `path: string`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/database/DatabaseManager.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DatabaseManager} from '../../../src/database/DatabaseManager.js';

function tableNames(db: ReturnType<DatabaseManager['getDb']>): string[] {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all() as Array<{name: string}>;
  return rows.map(r => r.name);
}

describe('DatabaseManager', () => {
  it('creates all session tables and sets user_version', () => {
    const manager = new DatabaseManager(':memory:');
    try {
      const db = manager.getDb();
      const names = tableNames(db);
      for (const t of [
        'sessions',
        'captured_requests',
        'hook_records',
        'storage_snapshots',
        'ai_reports',
      ]) {
        assert.ok(names.includes(t), `missing table ${t}`);
      }
      const version = db.pragma('user_version', {simple: true});
      assert.strictEqual(version, 1);
    } finally {
      manager.close();
    }
  });

  it('enforces the status CHECK constraint', () => {
    const manager = new DatabaseManager(':memory:');
    try {
      const db = manager.getDb();
      assert.throws(() => {
        db.prepare(
          `INSERT INTO sessions (id, name, status, created_at, updated_at)
           VALUES ('s1', 'x', 'bogus', 1, 1)`,
        ).run();
      }, /CHECK/i);
    } finally {
      manager.close();
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/database/DatabaseManager.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 DatabaseManager**

创建 `src/database/DatabaseManager.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {mkdirSync} from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import {resolveDefaultSessionDbFile} from '../utils/projectPaths.js';

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('idle','capturing','paused','analyzing','completed','stopped','error')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  meta TEXT
);

CREATE TABLE IF NOT EXISTS captured_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('cdp','proxy')),
  request_headers TEXT NOT NULL,
  request_body TEXT,
  status_code INTEGER DEFAULT 0,
  response_headers TEXT,
  response_body TEXT,
  content_type TEXT,
  initiator TEXT,
  duration_ms INTEGER DEFAULT 0,
  is_streaming INTEGER DEFAULT 0,
  is_websocket INTEGER DEFAULT 0,
  truncated INTEGER DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_requests_session ON captured_requests(session_id, sequence);

CREATE TABLE IF NOT EXISTS hook_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  hook_type TEXT NOT NULL,
  function_name TEXT NOT NULL,
  arguments TEXT NOT NULL,
  result TEXT,
  call_stack TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_hooks_session ON hook_records(session_id, timestamp);

CREATE TABLE IF NOT EXISTS storage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cookie','local','session')),
  origin TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_storage_snapshots_session ON storage_snapshots(session_id, timestamp);

CREATE TABLE IF NOT EXISTS ai_reports (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  scene_hints TEXT,
  purified_summary TEXT,
  report_markdown TEXT NOT NULL,
  messages TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
`;

function applyMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', {simple: true}) as number;
  const run = db.transaction(() => {
    if (current < 1) {
      db.exec(SCHEMA_V1);
      db.pragma('user_version = 1');
    }
  });
  run();
}

export class DatabaseManager {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath?: string) {}

  get path(): string {
    return this.dbPath ?? resolveDefaultSessionDbFile(import.meta.url);
  }

  init(): Database.Database {
    if (this.db) {
      return this.db;
    }
    if (this.path !== ':memory:') {
      mkdirSync(path.dirname(this.path), {recursive: true});
    }
    const db = new Database(this.path);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    this.db = db;
    return db;
  }

  getDb(): Database.Database {
    return this.init();
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/database/DatabaseManager.test.js`
Expected: PASS（2 项）。

- [ ] **Step 5: Commit**

```bash
git add src/database/DatabaseManager.ts tests/unit/database/DatabaseManager.test.ts
git commit -m "feat(session): add DatabaseManager with schema migrations"
```

---

### Task 3: 类型 + SessionStore 接口 + SqliteSessionStore

**Files:**
- Create: `src/modules/session/types.ts`
- Create: `src/modules/session/SessionStore.ts`
- Create: `src/modules/session/SqliteSessionStore.ts`
- Test: `tests/unit/modules/session/SqliteSessionStore.test.ts`

**Interfaces:**
- Consumes: `DatabaseManager.getDb()`（Task 2）
- Produces: 这些类型/签名是全计划的契约，后续任务一律引用，不得改名：
  - `SessionStatus`、`CaptureSource`、`HookType`、`StorageKind`
  - `SessionRow`、`CapturedRequestRow`、`HookRecordRow`、`StorageSnapshotRow`
  - `CapturedRequestInput = Omit<CapturedRequestRow, 'id' | 'sessionId' | 'sequence'>`
  - `HookRecordInput = Omit<HookRecordRow, 'sessionId'>`
  - `StorageSnapshotInput = Omit<StorageSnapshotRow, 'sessionId'>`
  - `RequestFilter = {sources?: CaptureSource[]; urlFilter?: string}`
  - `interface SessionStore { createSession; updateSessionStatus; getSession; listSessions; appendRequest(row: CapturedRequestRow); appendHook(row: HookRecordRow); appendSnapshot(row: StorageSnapshotRow); getRequests(sessionId, filter?); getHooks(sessionId); getSnapshots(sessionId); close() }`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/modules/session/SqliteSessionStore.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DatabaseManager} from '../../../../src/database/DatabaseManager.js';
import {SqliteSessionStore} from '../../../../src/modules/session/SqliteSessionStore.js';
import type {
  CapturedRequestRow,
  HookRecordRow,
  StorageSnapshotRow,
} from '../../../../src/modules/session/types.js';

function makeStore(): {store: SqliteSessionStore; manager: DatabaseManager} {
  const manager = new DatabaseManager(':memory:');
  return {store: new SqliteSessionStore(manager), manager};
}

describe('SqliteSessionStore', () => {
  it('creates, lists, and updates a session', () => {
    const {store, manager} = makeStore();
    try {
      const row = store.createSession({id: 's1', name: 'demo', targetUrl: 'https://a.dev'});
      assert.strictEqual(row.id, 's1');
      assert.strictEqual(row.status, 'capturing');
      assert.strictEqual(store.listSessions().length, 1);

      store.updateSessionStatus('s1', 'stopped');
      assert.strictEqual(store.getSession('s1')?.status, 'stopped');
    } finally {
      manager.close();
    }
  });

  it('appends and filters captured requests', () => {
    const {store, manager} = makeStore();
    try {
      store.createSession({id: 's1', name: 'demo'});
      const req: CapturedRequestRow = {
        id: 's1-1',
        sessionId: 's1',
        sequence: 1,
        timestamp: 100,
        method: 'POST',
        url: 'https://a.dev/api/sign',
        source: 'proxy',
        requestHeaders: '{"content-type":"application/json"}',
        requestBody: '{"q":1}',
        statusCode: 200,
        responseHeaders: null,
        responseBody: '{"ok":true}',
        contentType: 'application/json',
        initiator: null,
        durationMs: 12,
        isStreaming: 0,
        isWebSocket: 0,
        truncated: 0,
      };
      store.appendRequest(req);

      const all = store.getRequests('s1');
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]?.url, req.url);

      assert.strictEqual(store.getRequests('s1', {urlFilter: 'SIGN'}).length, 1);
      assert.strictEqual(store.getRequests('s1', {urlFilter: 'missing'}).length, 0);
      assert.strictEqual(store.getRequests('s1', {sources: ['cdp']}).length, 0);
      assert.strictEqual(store.getRequests('s1', {sources: ['proxy']}).length, 1);
    } finally {
      manager.close();
    }
  });

  it('appends hooks and snapshots', () => {
    const {store, manager} = makeStore();
    try {
      store.createSession({id: 's1', name: 'demo'});
      const hook: HookRecordRow = {
        sessionId: 's1',
        timestamp: 101,
        hookType: 'crypto',
        functionName: 'subtle.encrypt',
        arguments: '["aes-gcm"]',
        result: '{"iv":"...","data":"..."}',
        callStack: 'at sign (app.js:1:1)',
      };
      store.appendHook(hook);
      assert.strictEqual(store.getHooks('s1').length, 1);

      const snap: StorageSnapshotRow = {
        sessionId: 's1',
        timestamp: 102,
        kind: 'cookie',
        origin: 'https://a.dev',
        key: 'session',
        value: 'MASKED',
      };
      store.appendSnapshot(snap);
      assert.strictEqual(store.getSnapshots('s1').length, 1);
    } finally {
      manager.close();
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/session/SqliteSessionStore.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 定义类型**

创建 `src/modules/session/types.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export type SessionStatus =
  | 'idle'
  | 'capturing'
  | 'paused'
  | 'analyzing'
  | 'completed'
  | 'stopped'
  | 'error';

export type CaptureSource = 'cdp' | 'proxy';

export type HookType =
  | 'fetch'
  | 'xhr'
  | 'crypto'
  | 'crypto_lib'
  | 'cookie'
  | 'storage'
  | 'websocket'
  | 'wasm';

export type StorageKind = 'cookie' | 'local' | 'session';

export interface SessionRow {
  id: string;
  name: string;
  targetUrl: string | null;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  meta: string | null;
}

export interface CapturedRequestRow {
  id: string;
  sessionId: string;
  sequence: number;
  timestamp: number;
  method: string;
  url: string;
  source: CaptureSource;
  requestHeaders: string;
  requestBody: string | null;
  statusCode: number;
  responseHeaders: string | null;
  responseBody: string | null;
  contentType: string | null;
  initiator: string | null;
  durationMs: number;
  isStreaming: number;
  isWebSocket: number;
  truncated: number;
}

export interface HookRecordRow {
  sessionId: string;
  timestamp: number;
  hookType: HookType;
  functionName: string;
  arguments: string;
  result: string | null;
  callStack: string | null;
}

export interface StorageSnapshotRow {
  sessionId: string;
  timestamp: number;
  kind: StorageKind;
  origin: string;
  key: string;
  value: string | null;
}

export type CapturedRequestInput = Omit<
  CapturedRequestRow,
  'id' | 'sessionId' | 'sequence'
>;
export type HookRecordInput = Omit<HookRecordRow, 'sessionId'>;
export type StorageSnapshotInput = Omit<StorageSnapshotRow, 'sessionId'>;

export interface RequestFilter {
  sources?: CaptureSource[];
  urlFilter?: string;
}
```

- [ ] **Step 4: 定义 SessionStore 接口**

创建 `src/modules/session/SessionStore.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  CapturedRequestRow,
  HookRecordRow,
  RequestFilter,
  SessionRow,
  SessionStatus,
  StorageSnapshotRow,
} from './types.js';

export interface SessionStore {
  createSession(input: {
    id: string;
    name: string;
    targetUrl?: string | null;
  }): SessionRow;
  updateSessionStatus(id: string, status: SessionStatus): void;
  getSession(id: string): SessionRow | null;
  listSessions(): SessionRow[];
  appendRequest(row: CapturedRequestRow): void;
  appendHook(row: HookRecordRow): void;
  appendSnapshot(row: StorageSnapshotRow): void;
  getRequests(sessionId: string, filter?: RequestFilter): CapturedRequestRow[];
  getHooks(sessionId: string): HookRecordRow[];
  getSnapshots(sessionId: string): StorageSnapshotRow[];
  close(): void;
}
```

- [ ] **Step 5: 实现 SqliteSessionStore**

创建 `src/modules/session/SqliteSessionStore.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type Database from 'better-sqlite3';

import type {DatabaseManager} from '../../database/DatabaseManager.js';

import type {SessionStore} from './SessionStore.js';
import type {
  CapturedRequestRow,
  HookRecordRow,
  RequestFilter,
  SessionRow,
  SessionStatus,
  StorageSnapshotRow,
} from './types.js';

interface SessionDbRow {
  id: string;
  name: string;
  target_url: string | null;
  status: SessionStatus;
  created_at: number;
  updated_at: number;
  meta: string | null;
}

interface RequestDbRow {
  id: string;
  session_id: string;
  sequence: number;
  timestamp: number;
  method: string;
  url: string;
  source: 'cdp' | 'proxy';
  request_headers: string;
  request_body: string | null;
  status_code: number;
  response_headers: string | null;
  response_body: string | null;
  content_type: string | null;
  initiator: string | null;
  duration_ms: number;
  is_streaming: number;
  is_websocket: number;
  truncated: number;
}

interface HookDbRow {
  session_id: string;
  timestamp: number;
  hook_type: HookRecordRow['hookType'];
  function_name: string;
  arguments: string;
  result: string | null;
  call_stack: string | null;
}

interface SnapshotDbRow {
  session_id: string;
  timestamp: number;
  kind: StorageSnapshotRow['kind'];
  origin: string;
  key: string;
  value: string | null;
}

const toSession = (r: SessionDbRow): SessionRow => ({
  id: r.id,
  name: r.name,
  targetUrl: r.target_url,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  meta: r.meta,
});

const toRequest = (r: RequestDbRow): CapturedRequestRow => ({
  id: r.id,
  sessionId: r.session_id,
  sequence: r.sequence,
  timestamp: r.timestamp,
  method: r.method,
  url: r.url,
  source: r.source,
  requestHeaders: r.request_headers,
  requestBody: r.request_body,
  statusCode: r.status_code,
  responseHeaders: r.response_headers,
  responseBody: r.response_body,
  contentType: r.content_type,
  initiator: r.initiator,
  durationMs: r.duration_ms,
  isStreaming: r.is_streaming,
  isWebSocket: r.is_websocket,
  truncated: r.truncated,
});

const toHook = (r: HookDbRow): HookRecordRow => ({
  sessionId: r.session_id,
  timestamp: r.timestamp,
  hookType: r.hook_type,
  functionName: r.function_name,
  arguments: r.arguments,
  result: r.result,
  callStack: r.call_stack,
});

const toSnapshot = (r: SnapshotDbRow): StorageSnapshotRow => ({
  sessionId: r.session_id,
  timestamp: r.timestamp,
  kind: r.kind,
  origin: r.origin,
  key: r.key,
  value: r.value,
});

export class SqliteSessionStore implements SessionStore {
  private readonly manager: DatabaseManager;
  private readonly db: Database.Database;

  constructor(manager: DatabaseManager) {
    this.manager = manager;
    this.db = manager.getDb();
  }

  createSession(input: {
    id: string;
    name: string;
    targetUrl?: string | null;
  }): SessionRow {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, name, target_url, status, created_at, updated_at, meta)
         VALUES (?, ?, ?, 'capturing', ?, ?, NULL)`,
      )
      .run(input.id, input.name, input.targetUrl ?? null, now, now);
    return this.getSession(input.id) as SessionRow;
  }

  updateSessionStatus(id: string, status: SessionStatus): void {
    this.db
      .prepare(`UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, Date.now(), id);
  }

  getSession(id: string): SessionRow | null {
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(id) as SessionDbRow | undefined;
    return row ? toSession(row) : null;
  }

  listSessions(): SessionRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`)
      .all() as SessionDbRow[];
    return rows.map(toSession);
  }

  appendRequest(row: CapturedRequestRow): void {
    this.db
      .prepare(
        `INSERT INTO captured_requests (
           id, session_id, sequence, timestamp, method, url, source,
           request_headers, request_body, status_code, response_headers,
           response_body, content_type, initiator, duration_ms,
           is_streaming, is_websocket, truncated
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.sessionId,
        row.sequence,
        row.timestamp,
        row.method,
        row.url,
        row.source,
        row.requestHeaders,
        row.requestBody,
        row.statusCode,
        row.responseHeaders,
        row.responseBody,
        row.contentType,
        row.initiator,
        row.durationMs,
        row.isStreaming,
        row.isWebSocket,
        row.truncated,
      );
  }

  appendHook(row: HookRecordRow): void {
    this.db
      .prepare(
        `INSERT INTO hook_records (
           session_id, timestamp, hook_type, function_name, arguments, result, call_stack
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.sessionId,
        row.timestamp,
        row.hookType,
        row.functionName,
        row.arguments,
        row.result,
        row.callStack,
      );
  }

  appendSnapshot(row: StorageSnapshotRow): void {
    this.db
      .prepare(
        `INSERT INTO storage_snapshots (
           session_id, timestamp, kind, origin, key, value
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.sessionId, row.timestamp, row.kind, row.origin, row.key, row.value);
  }

  getRequests(sessionId: string, filter: RequestFilter = {}): CapturedRequestRow[] {
    const clauses = ['session_id = ?'];
    const params: unknown[] = [sessionId];

    if (filter.sources && filter.sources.length > 0) {
      clauses.push(`source IN (${filter.sources.map(() => '?').join(', ')})`);
      params.push(...filter.sources);
    }
    if (filter.urlFilter) {
      clauses.push('lower(url) LIKE ?');
      params.push(`%${filter.urlFilter.toLowerCase()}%`);
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM captured_requests WHERE ${clauses.join(' AND ')} ORDER BY sequence ASC`,
      )
      .all(...params) as RequestDbRow[];
    return rows.map(toRequest);
  }

  getHooks(sessionId: string): HookRecordRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM hook_records WHERE session_id = ? ORDER BY timestamp ASC`)
      .all(sessionId) as HookDbRow[];
    return rows.map(toHook);
  }

  getSnapshots(sessionId: string): StorageSnapshotRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM storage_snapshots WHERE session_id = ? ORDER BY timestamp ASC`,
      )
      .all(sessionId) as SnapshotDbRow[];
    return rows.map(toSnapshot);
  }

  close(): void {
    this.manager.close();
  }
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/session/SqliteSessionStore.test.js`
Expected: PASS（3 项）。

- [ ] **Step 7: Commit**

```bash
git add src/modules/session/types.ts src/modules/session/SessionStore.ts src/modules/session/SqliteSessionStore.ts tests/unit/modules/session/SqliteSessionStore.test.ts
git commit -m "feat(session): add SessionStore abstraction and SQLite implementation"
```

---

### Task 4: CaptureSessionManager（状态机 + 活动会话 + 序号）

**Files:**
- Create: `src/modules/session/CaptureSessionManager.ts`
- Test: `tests/unit/modules/session/CaptureSessionManager.test.ts`

**Interfaces:**
- Consumes: `SessionStore` 接口（Task 3）
- Produces: `CaptureSessionManager`，方法：`createSession(input: {name: string; targetUrl?: string}): SessionRow`、`getActiveSession(): SessionRow | null`、`requireActiveSession(): SessionRow`、`listSessions(): SessionRow[]`、`getSession(id: string): SessionRow | null`、`transition(id: string, status: SessionStatus): void`、`nextSequence(sessionId: string): number`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/modules/session/CaptureSessionManager.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DatabaseManager} from '../../../../src/database/DatabaseManager.js';
import {CaptureSessionManager} from '../../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../../src/modules/session/SqliteSessionStore.js';

function makeManager(): {manager: CaptureSessionManager; db: DatabaseManager} {
  const db = new DatabaseManager(':memory:');
  return {manager: new CaptureSessionManager(new SqliteSessionStore(db)), db};
}

describe('CaptureSessionManager', () => {
  it('creates and activates a new session', () => {
    const {manager, db} = makeManager();
    try {
      const row = manager.createSession({name: 'demo'});
      assert.strictEqual(row.status, 'capturing');
      assert.strictEqual(manager.getActiveSession()?.id, row.id);
      assert.strictEqual(manager.requireActiveSession().id, row.id);
    } finally {
      db.close();
    }
  });

  it('allocates monotonic per-session sequences', () => {
    const {manager, db} = makeManager();
    try {
      const a = manager.createSession({name: 'a'});
      assert.strictEqual(manager.nextSequence(a.id), 1);
      assert.strictEqual(manager.nextSequence(a.id), 2);

      const b = manager.createSession({name: 'b'});
      assert.strictEqual(manager.nextSequence(b.id), 1);
    } finally {
      db.close();
    }
  });

  it('rejects illegal status transitions', () => {
    const {manager, db} = makeManager();
    try {
      const row = manager.createSession({name: 'demo'});
      manager.transition(row.id, 'paused');
      assert.strictEqual(manager.getSession(row.id)?.status, 'paused');
      manager.transition(row.id, 'capturing');
      assert.throws(() => manager.transition(row.id, 'paused'), /transition/i);
      manager.transition(row.id, 'stopped');
      assert.strictEqual(manager.getSession(row.id)?.status, 'stopped');
      assert.throws(() => manager.transition(row.id, 'capturing'), /transition/i);
    } finally {
      db.close();
    }
  });

  it('throws when no active session', () => {
    const {manager, db} = makeManager();
    try {
      assert.throws(() => manager.requireActiveSession(), /No active session/i);
    } finally {
      db.close();
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/session/CaptureSessionManager.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现 CaptureSessionManager**

创建 `src/modules/session/CaptureSessionManager.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {randomUUID} from 'node:crypto';

import type {SessionStore} from './SessionStore.js';
import type {RequestFilter, SessionRow, SessionStatus} from './types.js';

const ALLOWED: Record<SessionStatus, SessionStatus[]> = {
  idle: ['capturing'],
  capturing: ['paused', 'analyzing', 'completed', 'stopped', 'error'],
  paused: ['capturing', 'stopped', 'error'],
  analyzing: ['completed', 'error'],
  completed: [],
  stopped: [],
  error: [],
};

export class CaptureSessionManager {
  private activeSessionId: string | null = null;
  private readonly sequences = new Map<string, number>();

  constructor(private readonly store: SessionStore) {}

  createSession(input: {name: string; targetUrl?: string}): SessionRow {
    const id = randomUUID();
    const row = this.store.createSession({
      id,
      name: input.name,
      targetUrl: input.targetUrl ?? null,
    });
    this.activeSessionId = id;
    this.sequences.set(id, 0);
    return row;
  }

  getActiveSession(): SessionRow | null {
    return this.activeSessionId ? this.store.getSession(this.activeSessionId) : null;
  }

  requireActiveSession(): SessionRow {
    const session = this.getActiveSession();
    if (!session) {
      throw new Error('No active session. Call session_create first.');
    }
    return session;
  }

  listSessions(): SessionRow[] {
    return this.store.listSessions();
  }

  getSession(id: string): SessionRow | null {
    return this.store.getSession(id);
  }

  transition(id: string, status: SessionStatus): void {
    const current = this.store.getSession(id);
    if (current && !ALLOWED[current.status].includes(status)) {
      throw new Error(`Invalid session transition: ${current.status} -> ${status}`);
    }
    this.store.updateSessionStatus(id, status);
  }

  nextSequence(sessionId: string): number {
    const next = (this.sequences.get(sessionId) ?? 0) + 1;
    this.sequences.set(sessionId, next);
    return next;
  }

  getRequests(sessionId: string, filter?: RequestFilter) {
    return this.store.getRequests(sessionId, filter);
  }

  getHooks(sessionId: string) {
    return this.store.getHooks(sessionId);
  }

  getSnapshots(sessionId: string) {
    return this.store.getSnapshots(sessionId);
  }
}
```

> 注意：测试里 `manager.transition(row.id, 'paused')` 后再次 `transition(row.id, 'paused')` 会命中 `paused -> paused` 非法（不在 ALLOWED.paused 内），故第二个断言 `assert.throws` 成立；随后 `paused -> capturing` 合法、`capturing -> paused` 又非法——四步与测试代码逐行对应。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/session/CaptureSessionManager.test.js`
Expected: PASS（4 项）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/session/CaptureSessionManager.ts tests/unit/modules/session/CaptureSessionManager.test.ts
git commit -m "feat(session): add CaptureSessionManager with status state machine"
```

---

### Task 5: CaptureEngine（摄入归一化） + barrel

**Files:**
- Create: `src/modules/session/CaptureEngine.ts`
- Create: `src/modules/session/index.ts`
- Test: `tests/unit/modules/session/CaptureEngine.test.ts`

**Interfaces:**
- Consumes: `CaptureSessionManager`（Task 4）、`SessionStore`（Task 3）、`CapturedRequestInput`/`HookRecordInput`/`StorageSnapshotInput`（Task 3）
- Produces: `CaptureEngine`，方法 `ingestRequest(input: CapturedRequestInput): CapturedRequestRow`、`ingestHook(input: HookRecordInput): HookRecordRow`、`ingestSnapshot(input: StorageSnapshotInput): StorageSnapshotRow`；构造签名 `new CaptureEngine(manager, store, opts?: {emitToWs?: (e: {type: string; payload: unknown}) => void})`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/modules/session/CaptureEngine.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DatabaseManager} from '../../../../src/database/DatabaseManager.js';
import {CaptureEngine} from '../../../../src/modules/session/CaptureEngine.js';
import {CaptureSessionManager} from '../../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../../src/modules/session/SqliteSessionStore.js';

describe('CaptureEngine', () => {
  it('normalizes ingress into the active session and emits ws events', () => {
    const db = new DatabaseManager(':memory:');
    const store = new SqliteSessionStore(db);
    const manager = new CaptureSessionManager(store);
    const emitted: Array<{type: string; payload: unknown}> = [];
    const engine = new CaptureEngine(manager, store, {
      emitToWs: e => emitted.push(e),
    });

    try {
      const session = manager.createSession({name: 'demo'});

      const req = engine.ingestRequest({
        timestamp: 1,
        method: 'GET',
        url: 'https://a.dev/x',
        source: 'cdp',
        requestHeaders: '{}',
        requestBody: null,
        statusCode: 0,
        responseHeaders: null,
        responseBody: null,
        contentType: null,
        initiator: null,
        durationMs: 0,
        isStreaming: 0,
        isWebSocket: 0,
        truncated: 0,
      });
      assert.strictEqual(req.id, `${session.id}-1`);
      assert.strictEqual(req.sessionId, session.id);
      assert.strictEqual(store.getRequests(session.id).length, 1);

      engine.ingestHook({
        timestamp: 2,
        hookType: 'xhr',
        functionName: 'open',
        arguments: '[]',
        result: null,
        callStack: null,
      });
      assert.strictEqual(store.getHooks(session.id).length, 1);

      engine.ingestSnapshot({
        timestamp: 3,
        kind: 'local',
        origin: 'https://a.dev',
        key: 'token',
        value: 'MASKED',
      });
      assert.strictEqual(store.getSnapshots(session.id).length, 1);

      assert.deepStrictEqual(
        emitted.map(e => e.type),
        ['session.request', 'session.hook', 'session.snapshot'],
      );
    } finally {
      db.close();
    }
  });

  it('rejects ingress without an active session', () => {
    const db = new DatabaseManager(':memory:');
    const store = new SqliteSessionStore(db);
    const engine = new CaptureEngine(new CaptureSessionManager(store), store);
    try {
      assert.throws(
        () =>
          engine.ingestRequest({
            timestamp: 1,
            method: 'GET',
            url: 'https://a.dev/x',
            source: 'cdp',
            requestHeaders: '{}',
          }),
        /No active session/i,
      );
    } finally {
      db.close();
    }
  });
});
```

> 第二个测试的 `ingestRequest` 入参是 `CapturedRequestInput` 的子集：`statusCode`/`responseHeaders` 等省略后为 `undefined`，插入时 better-sqlite3 会因 `undefined` 绑定报错——因此**必须在** `CapturedRequestInput` 里把所有可选字段列全（该测试仅用于「无活动会话」路径，在进入 INSERT 前就会抛错，字段不全不会影响断言）。但为类型正确，实现阶段补充一个完整入参工厂更稳，见 Step 3 后的说明。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/session/CaptureEngine.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现 CaptureEngine 与 barrel**

创建 `src/modules/session/CaptureEngine.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {SessionStore} from './SessionStore.js';
import type {CaptureSessionManager} from './CaptureSessionManager.js';
import type {
  CapturedRequestInput,
  CapturedRequestRow,
  HookRecordInput,
  HookRecordRow,
  StorageSnapshotInput,
  StorageSnapshotRow,
} from './types.js';

type WsEvent = {type: string; payload: unknown};

export class CaptureEngine {
  private readonly emitToWs: (event: WsEvent) => void;

  constructor(
    private readonly manager: CaptureSessionManager,
    private readonly store: SessionStore,
    opts: {emitToWs?: (event: WsEvent) => void} = {},
  ) {
    this.emitToWs = opts.emitToWs ?? (() => {});
  }

  ingestRequest(input: CapturedRequestInput): CapturedRequestRow {
    const session = this.manager.requireActiveSession();
    const sequence = this.manager.nextSequence(session.id);
    const row: CapturedRequestRow = {
      id: `${session.id}-${sequence}`,
      sessionId: session.id,
      sequence,
      ...input,
    };
    this.store.appendRequest(row);
    this.emitToWs({type: 'session.request', payload: row});
    return row;
  }

  ingestHook(input: HookRecordInput): HookRecordRow {
    const session = this.manager.requireActiveSession();
    const row: HookRecordRow = {sessionId: session.id, ...input};
    this.store.appendHook(row);
    this.emitToWs({type: 'session.hook', payload: row});
    return row;
  }

  ingestSnapshot(input: StorageSnapshotInput): StorageSnapshotRow {
    const session = this.manager.requireActiveSession();
    const row: StorageSnapshotRow = {sessionId: session.id, ...input};
    this.store.appendSnapshot(row);
    this.emitToWs({type: 'session.snapshot', payload: row});
    return row;
  }
}
```

创建 `src/modules/session/index.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export {CaptureEngine} from './CaptureEngine.js';
export {CaptureSessionManager} from './CaptureSessionManager.js';
export {SqliteSessionStore} from './SqliteSessionStore.js';
export type {SessionStore} from './SessionStore.js';
export type {
  CapturedRequestInput,
  CapturedRequestRow,
  CaptureSource,
  HookRecordInput,
  HookRecordRow,
  HookType,
  RequestFilter,
  SessionRow,
  SessionStatus,
  StorageKind,
  StorageSnapshotInput,
  StorageSnapshotRow,
} from './types.js';
```

修正第二个测试的入参，使其满足 `CapturedRequestInput` 全字段（补在 `assert.throws` 的 `ingestRequest` 调用里）：

```ts
engine.ingestRequest({
  timestamp: 1,
  method: 'GET',
  url: 'https://a.dev/x',
  source: 'cdp',
  requestHeaders: '{}',
  requestBody: null,
  statusCode: 0,
  responseHeaders: null,
  responseBody: null,
  contentType: null,
  initiator: null,
  durationMs: 0,
  isStreaming: 0,
  isWebSocket: 0,
  truncated: 0,
}),
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/session/CaptureEngine.test.js`
Expected: PASS（2 项）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/session/CaptureEngine.ts src/modules/session/index.ts tests/unit/modules/session/CaptureEngine.test.ts
git commit -m "feat(session): add CaptureEngine ingress normalization"
```

---

### Task 6: 接线 Runtime（RuntimeServices + runtime.ts）

**Files:**
- Modify: `src/runtime/RuntimeServices.ts`
- Modify: `src/runtime.ts`

**Interfaces:**
- Consumes: `CaptureSessionManager`（Task 4）、`SqliteSessionStore`（Task 3）、`DatabaseManager`（Task 2）
- Produces: `getRuntime().captureSessionManager: CaptureSessionManager`（lazy getter）

- [ ] **Step 1: 在 RuntimeServices 注入 lazy getter**

在 `src/runtime/RuntimeServices.ts`：

1. 追加导入（字母序，放在 `import {MitmModule} ...` 之后、`import {NetworkModule}` 之前按字母序插到 `NetworkModule` 下）：

```ts
import {DatabaseManager} from '../database/DatabaseManager.js';
import {CaptureSessionManager} from '../modules/session/index.js';
import {SqliteSessionStore} from '../modules/session/SqliteSessionStore.js';
```

2. 追加私有字段与 getter：

```ts
private captureSessionManager?: CaptureSessionManager;
```

```ts
getCaptureSessionManager(): CaptureSessionManager {
  return (this.captureSessionManager ??= new CaptureSessionManager(
    new SqliteSessionStore(new DatabaseManager()),
  ));
}
```

- [ ] **Step 2: 在 runtime.ts 暴露**

在 `src/runtime.ts`：

1. 追加类型导入：

```ts
import type {CaptureSessionManager} from './modules/session/index.js';
```

2. 在 `Runtime` 接口追加字段（放在 `mitmModule` 之后）：

```ts
captureSessionManager: CaptureSessionManager;
```

3. 在 `runtime = {...}` 字面量追加 getter（放在 `mitmModule` getter 之后）：

```ts
get captureSessionManager() {
  return services.getCaptureSessionManager();
},
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 无 TypeScript 错误。

- [ ] **Step 4: Commit**

```bash
git add src/runtime/RuntimeServices.ts src/runtime.ts
git commit -m "feat(session): wire captureSessionManager into runtime services"
```

---

### Task 7: `session_create` / `session_list` 工具 + domain manifest

**Files:**
- Create: `src/tools/session/session_create.ts`
- Create: `src/tools/session/session_list.ts`
- Create: `src/tools/session/manifest.ts`
- Modify: `src/tools/generated-tools-index.ts`（经 `npm run build:index` 生成，不手改）
- Test: `tests/unit/tools/session/session-tools.test.ts`

**Interfaces:**
- Consumes: `getRuntime().captureSessionManager`（Task 6）、`defineTool`、`ToolCategory`、`zod`
- Produces: 命名导出 `sessionCreate`、`sessionList`、`manifest`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/tools/session/session-tools.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {afterEach, describe, it} from 'node:test';

import {DatabaseManager} from '../../../../src/database/DatabaseManager.js';
import {CaptureSessionManager} from '../../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../../src/modules/session/SqliteSessionStore.js';
import {getRuntime, setRuntime} from '../../../../src/runtime.js';
import type {Runtime} from '../../../../src/runtime.js';
import {sessionCreate} from '../../../../src/tools/session/session_create.js';
import {sessionList} from '../../../../src/tools/session/session_list.js';

function fakeResponse() {
  let captured: unknown;
  return {
    setStructuredContent: (c: unknown) => {
      captured = c;
    },
    appendResponseLine: () => {},
    setIncludePages: () => {},
    setIncludeNetworkRequests: () => {},
    setIncludeConsoleData: () => {},
    attachImage: () => {},
    attachNetworkRequest: () => {},
    attachConsoleMessage: () => {},
    setIncludeWebSocketConnections: () => {},
    attachWebSocket: () => {},
    get captured() {
      return captured;
    },
  };
}

const db = new DatabaseManager(':memory:');
const manager = new CaptureSessionManager(new SqliteSessionStore(db));

afterEach(() => {
  setRuntime(undefined);
});

describe('session tools', () => {
  it('session_create activates a session', async () => {
    setRuntime({captureSessionManager: manager} as unknown as Runtime);
    const res = fakeResponse();
    await sessionCreate.handler(
      {params: {name: 'demo'}} as never,
      res as never,
      {} as never,
    );
    const content = res.captured as {session: {status: string}};
    assert.strictEqual(content.session.status, 'capturing');
  });

  it('session_list returns all sessions', async () => {
    setRuntime({captureSessionManager: manager} as unknown as Runtime);
    const res = fakeResponse();
    await sessionList.handler(
      {params: {}} as never,
      res as never,
      {} as never,
    );
    const content = res.captured as {sessions: unknown[]};
    assert.ok(content.sessions.length >= 1);
  });

  it('exposes expected names', () => {
    assert.strictEqual(sessionCreate.name, 'session_create');
    assert.strictEqual(sessionList.name, 'session_list');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/session/session-tools.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现两个工具**

创建 `src/tools/session/session_create.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const sessionCreate = defineTool({
  name: 'session_create',
  description: '创建并激活一个抓包与逆向分析会话。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    name: zod.string().min(1).describe('会话名称。'),
    targetUrl: zod.string().optional().describe('目标网页 URL。'),
  },
  handler: async (request, response) => {
    const session = getRuntime().captureSessionManager.createSession(request.params);
    response.setStructuredContent({session, tooltype: 'session_create'});
  },
});
```

创建 `src/tools/session/session_list.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {getRuntime} from '../../runtime.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const sessionList = defineTool({
  name: 'session_list',
  description: '列出全部抓包与逆向分析会话及其状态。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response) => {
    const sessions = getRuntime().captureSessionManager.listSessions();
    response.setStructuredContent({sessions, tooltype: 'session_list'});
  },
});
```

创建 `src/tools/session/manifest.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'session',
  description: 'Unified capture session management and data query tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './session/session_create.js', handlerName: 'sessionCreate'},
    {modulePath: './session/session_list.js', handlerName: 'sessionList'},
  ],
} satisfies DomainManifest;
```

- [ ] **Step 4: 重新生成工具索引**

Run: `npm run build:index && npm run build:compile`
Expected: 无错误；`src/tools/generated-tools-index.ts` 新出现 `sessionManifest` 导入与 `GENERATED_DOMAIN_MANIFESTS` 条目。

- [ ] **Step 5: 运行测试与契约校验**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/session/session-tools.test.js`
Expected: PASS（3 项）。

Run: `npm run test:contracts`
Expected: PASS（新工具通过唯一命名 / schema 契约）。

- [ ] **Step 6: Commit**

```bash
git add src/tools/session/session_create.ts src/tools/session/session_list.ts src/tools/session/manifest.ts src/tools/generated-tools-index.ts tests/unit/tools/session/session-tools.test.ts
git commit -m "feat(session): add session_create and session_list MCP tools"
```

---

### Task 8: `session_get_data` 工具

**Files:**
- Create: `src/tools/session/session_get_data.ts`
- Modify: `src/tools/session/manifest.ts`
- Modify: `src/tools/generated-tools-index.ts`（经 `npm run build:index` 生成）
- Test: `tests/unit/tools/session/session-tools.test.ts`（追加用例）

**Interfaces:**
- Consumes: `getRuntime().captureSessionManager`（Task 6）、`createToolError`/`ErrorCodes`（`src/utils/errors.ts`）
- Produces: 命名导出 `sessionGetData`

- [ ] **Step 1: 追加失败测试**

在 `tests/unit/tools/session/session-tools.test.ts` 追加导入与用例：

```ts
import {sessionGetData} from '../../../../src/tools/session/session_get_data.js';
```

```ts
it('session_get_data returns rows for the active session', async () => {
  setRuntime({captureSessionManager: manager} as unknown as Runtime);
  const res = fakeResponse();
  await sessionGetData.handler(
    {params: {includeHooks: true, includeSnapshots: true}} as never,
    res as never,
    {} as never,
  );
  const content = res.captured as {
    session: {id: string};
    requests: unknown[];
    hooks: unknown[];
    snapshots: unknown[];
  };
  assert.ok(content.session.id.length > 0);
  assert.ok(Array.isArray(content.requests));
  assert.ok(Array.isArray(content.hooks));
  assert.ok(Array.isArray(content.snapshots));
});

it('session_get_data not_found when sessionId unknown', async () => {
  setRuntime({captureSessionManager: manager} as unknown as Runtime);
  await assert.rejects(
    sessionGetData.handler(
      {params: {sessionId: 'nope'}} as never,
      fakeResponse() as never,
      {} as never,
    ),
    /session/i,
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/session/session-tools.test.js`
Expected: FAIL（`sessionGetData` 未定义）。

- [ ] **Step 3: 实现 session_get_data**

创建 `src/tools/session/session_get_data.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import type {CaptureSessionManager} from '../../modules/session/index.js';

function resolveSession(
  manager: CaptureSessionManager,
  sessionId: string | undefined,
) {
  if (sessionId) {
    const session = manager.getSession(sessionId);
    if (!session) {
      throw createToolError(
        ErrorCodes.NOT_FOUND,
        `No session found with id: ${sessionId}`,
      );
    }
    return session;
  }
  return manager.requireActiveSession();
}

export const sessionGetData = defineTool({
  name: 'session_get_data',
  description:
    '获取指定会话的结构化请求、加解密 Hook 日志与 Storage 快照。默认取当前活动会话。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    sessionId: zod.string().optional().describe('会话 ID，默认当前活动会话。'),
    sources: zod
      .array(zod.enum(['cdp', 'proxy']))
      .optional()
      .describe('来源过滤。'),
    urlFilter: zod.string().optional().describe('URL 关键字过滤。'),
    includeHooks: zod.boolean().optional().describe('是否包含 Hook 日志，默认 true。'),
    includeSnapshots: zod
      .boolean()
      .optional()
      .describe('是否包含 Storage 快照，默认 true。'),
  },
  handler: async (request, response) => {
    const {
      sessionId,
      sources,
      urlFilter,
      includeHooks = true,
      includeSnapshots = true,
    } = request.params;
    const manager = getRuntime().captureSessionManager;
    const session = resolveSession(manager, sessionId);

    response.setStructuredContent({
      session,
      requests: manager.getRequests(session.id, {sources, urlFilter}),
      hooks: includeHooks ? manager.getHooks(session.id) : [],
      snapshots: includeSnapshots ? manager.getSnapshots(session.id) : [],
      tooltype: 'session_get_data',
    });
  },
});
```

- [ ] **Step 4: 更新 manifest**

在 `src/tools/session/manifest.ts` 的 `tools` 数组追加：

```ts
{modulePath: './session/session_get_data.js', handlerName: 'sessionGetData'},
```

- [ ] **Step 5: 重新生成索引 + 构建**

Run: `npm run build:index && npm run build:compile`
Expected: 无错误。

- [ ] **Step 6: 运行测试与契约校验**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/session/session-tools.test.js`
Expected: PASS（新增 2 项）。

Run: `npm run test:contracts`
Expected: PASS。

- [ ] **Step 7: 提交前完整验证**

Run: `npm run typecheck`
Run: `npm run test:unit`
Run: `npm run check-format`

Expected: 全部通过。若 `check-format` 报格式问题，运行 `npm run format` 后重跑 `npm run check-format`。

- [ ] **Step 8: Commit**

```bash
git add src/tools/session/session_get_data.ts src/tools/session/manifest.ts src/tools/generated-tools-index.ts tests/unit/tools/session/session-tools.test.ts
git commit -m "feat(session): add session_get_data MCP tool"
```

---

## Self-Review 结果（作者自查）

**1. Spec 覆盖（P1 边界内）**
- §4.1 驱动选型 → Task 1（better-sqlite3）+ Task 2（DatabaseManager）。
- §4.2 Schema（5 表 + 索引 + `truncated` + `UNIQUE(session_id,sequence)`）→ Task 2 SCHEMA_V1。
- §4.5 `hook_type` TEXT 无 CHECK → Task 2 / Task 3。
- §4.6 状态机（`paused/stopped/error`）→ Task 4 ALLOWED 表。
- §5 模块（DatabaseManager / CaptureSessionManager / CaptureEngine / SessionStore）→ Task 2/3/4/5。
- §6.1 / §6.2 / §6.3（`session_create` / `session_list` / `session_get_data`）→ Task 7/8。
- §2 现状对照「复用 ProxyStore 为前端接入层，持久化下沉 SessionStore」：`session_get_data` 读 SessionStore，满足；**CDP/Proxy 实时事件订阅接入** 属于 P2/P3（不在本计划）。

**已知边界（不在 P1，已在 Architecture 声明）**：`streams/` 旁路文件（D3）、实时 CDP/Proxy 订阅、`ai_reports` 写入（属 P2 `session_generate_report`）、WebSocket 桥接的真实 `WsHub` 接线（P4）、`storage_snapshots` 变更 diff（D2，P2）。

**2. Placeholder 扫描**：无 TBD/TODO；每步含真实代码；未引用未定义符号。

**3. 类型一致性**：`CapturedRequestInput`/`HookRecordInput`/`StorageSnapshotInput` 在 Task 3 定义，Task 5 引用同名；`SessionStore` 方法签名 Task 3 定义、Task 4/5/7/8 引用同名；`captureSessionManager` 在 Task 6 定义、Task 7/8 引用；`resolveDefaultSessionDbFile` Task 1 定义、Task 2 引用。一致。