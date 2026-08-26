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
