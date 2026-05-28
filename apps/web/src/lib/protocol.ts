/**
 * apps/web/src/lib/protocol.ts —— 前端协议类型镜像（与 src/web/types.ts 严格对齐）。
 *
 * apps/web 是独立的 vite/tsconfig 工作区，无法直接 import 后端文件，所以
 * 这里手动镜像协议形状。任何字段变更必须**同时**改后端的 src/web/types.ts，
 * 否则会出现序列化层的静默错位。
 *
 * 仅类型 + 一个运行时常量（STATE_CHANNELS），零运行时副作用。
 */

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
 */
export type StateChannel = 'worker.status' | 'browser.event';

/**
 * 流式频道：订阅后只推增量事件，不回放历史。
 */
export type StreamChannel =
  | 'tool.invoke'
  | 'hook.event'
  | 'hook.sample'
  | 'log';

export type Channel = StateChannel | StreamChannel;

export const STATE_CHANNELS: ReadonlyArray<StateChannel> = [
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

export interface HookSampleEvent {
  hookId: string;
  seq: number;
  ts: number;
  args?: unknown[];
  retVal?: unknown;
  stack?: {
    url: string;
    line: number;
    col: number;
    functionName?: string;
  }[];
  truncated?: boolean;
  artifactRef?: string;
}

/**
 * Tool 调用事件（tool.invoke 频道 payload）。
 * 与后端 src/worker/ToolAdapter.ts 的 ToolInvokeEvent 保持完全一致。
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

// ==================== Worker Status ====================

export interface WorkerStatus {
  ok: boolean;
  version: string;
  uptime: number;
  pid: number;
  rpcHost: string;
  group: string;
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
