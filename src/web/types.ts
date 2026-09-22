/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * src/web/types.ts —— Web 控制台协议类型真理源。
 *
 * 后端 ConsoleServer / WsHub / 路由共用此定义；前端 src/web-ui/src/lib/protocol.ts
 * 通过相对路径 `../../../web/types.js` 直接重新导出本文件（前端源码已迁入 src/web-ui，
 * 与后端同源，故无需双源手动同步）。
 *
 * 任何字段变更需同步前端协议引用方（如 ws.ts / api.ts 的使用处）。
 */

import type {BrowserConfig} from '../config/schema.js';

// ==================== HTTP API ====================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {code: string; message: string; details?: unknown};
  meta?: {traceId: string; ts: number};
}

// ==================== WebSocket Channels ====================

/**
 * 状态类频道：订阅时立即回放最新快照（lastState），后续仅在状态变化时推送。
 * 适合 worker 状态、browser 状态这类「最新值」语义。
 */
export type StateChannel = 'worker.status' | 'browser.event';

/**
 * 流式频道：订阅后只推增量事件，不回放历史。
 * 适合 tool 调用流、hook 采样流、日志流这类「append-only」语义。
 */
export type StreamChannel =
  | 'tool.invoke'
  | 'hook.event'
  | 'hook.sample'
  | 'log';

export type Channel = StateChannel | StreamChannel;

/**
 * 运行时常量：用于 WsHub 判断「订阅时是否回放快照」。
 * 必须包含 StateChannel 联合类型的所有成员。
 */
export const STATE_CHANNELS: readonly StateChannel[] = [
  'worker.status',
  'browser.event',
];

// ==================== WebSocket Messages ====================

export interface ClientMsgSubscribe {
  type: 'subscribe';
  channel: Channel;
  filter?: Record<string, unknown>;
}

export interface ClientMsgUnsubscribe {
  type: 'unsubscribe';
  channel: Channel;
}

export interface ClientMsgPing {
  type: 'ping';
}

export type ClientMsg =
  | ClientMsgSubscribe
  | ClientMsgUnsubscribe
  | ClientMsgPing;

export interface ServerMsgEvent {
  type: 'event';
  channel: Channel;
  ts: number;
  payload: unknown;
}

export interface ServerMsgSnapshot {
  type: 'snapshot';
  channel: StateChannel;
  ts: number;
  payload: unknown;
}

export interface ServerMsgError {
  type: 'error';
  channel?: Channel;
  code: string;
  message: string;
}

export interface ServerMsgPong {
  type: 'pong';
  ts: number;
}

export type ServerMsg =
  | ServerMsgEvent
  | ServerMsgSnapshot
  | ServerMsgError
  | ServerMsgPong;

// ==================== Channel Payloads ====================

/**
 * Hook 采样事件（hook.sample 频道 payload 类型）。
 * 浏览器侧通过 HookStore.add() emit 后由 ConsoleServer 桥接到 WS。
 */
export interface HookSampleEvent {
  hookId: string;
  seq: number;
  ts: number;
  args?: unknown[];
  retVal?: unknown;
  stack?: Array<{
    url: string;
    line: number;
    col: number;
    functionName?: string;
  }>;
  truncated?: boolean;
  artifactRef?: string;
}

/**
 * Tool 调用事件（tool.invoke 频道 payload 类型）。
 * 由 ToolAdapter.onInvoke 桥接 contextProvider.eventBus 的
 * tool:called/error 转译产出。同一个 traceId 出现一次（phase: 'end'）。
 */
export interface ToolInvokeEvent {
  traceId: string;
  toolName: string;
  phase: 'end';
  ts: number;
  durationMs?: number;
  success: boolean;
  error?: {code: string; message: string};
}

// ==================== Worker Status (state channel: worker.status) ====================

export interface WorkerStatus {
  ok: boolean;
  version: string;
  uptime: number;
  pid: number;
}

export interface WorkerFullStatus extends WorkerStatus {
  browser: {
    connected: boolean;
    mode: string;
    wsEndpoint?: string;
    pages: number;
    sessions: number;
  };
  hooks: {
    total: number;
    active: number;
    paused: number;
  };
  tools: {
    total: number;
  };
}

// ==================== Hook Resources ====================

export interface HookSummary {
  id: string;
  name: string;
  location: string;
  captureMode: string;
  status: 'active' | 'paused' | 'detached';
  sampleCount: number;
  lastSampleAt?: string;
  createdAt: string;
}

export interface HookDetail extends HookSummary {
  maxSamples: number;
  samples: HookSampleEvent[];
}

// ==================== Invocation History ====================

/**
 * 工具调用历史记录（REST /api/invocations 与 InvocationStore 共用）。
 * traceId 必填——P0.1 已让 Pipeline 全链路透传。
 */
export interface InvocationRecord {
  id: string;
  traceId: string;
  toolName: string;
  success: boolean;
  startedAt: string;
  durationMs: number;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: {code: string; message: string};
}

// ==================== System Info & Logs ====================

export interface LogFileInfo {
  name: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface SystemInfo {
  version: string;
  node: string;
  platform: string;
  arch: string;
  pid: number;
  uptimeMs: number;
  logDir: string;
  logFiles: LogFileInfo[];
  configPath: string;
  configExists: boolean;
}

export interface LogContent {
  fileName: string;
  content: string;
  truncated: boolean;
}

/**
 * `GET /api/config/export` 的响应体 —— 只含 PERSISTED_KEYS，import 直接把这个结构
 * POST 回去（合并语义）。
 *
 * 类型取自 schema 导出的 BrowserConfig：后端 types.ts 看不到前端 protocol.ts 的
 * RuntimeConfig，且该项本就是配置文件的真理源。
 */
export interface ExportedConfig {
  browser?: BrowserConfig;
}
