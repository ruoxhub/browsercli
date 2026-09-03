/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * NDJSON socket 帧协议。与 browsercli/src/daemonClient.ts 中客户端配对，
 * PROTOCOL_VERSION 两侧必须同步修改。
 */

import net from 'node:net';

export const PROTOCOL_VERSION = 1;

export interface DaemonRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface DaemonError {
  code: string;
  message: string;
  details?: unknown;
}

export interface DaemonResponse {
  id: number;
  result?: unknown;
  error?: DaemonError;
}

export type DaemonMessage =
  | DaemonRequest
  | DaemonResponse
  | Record<string, unknown>;

export function pipePath(name: string): string {
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : name;
}

export class SocketConnection {
  private readonly socket: net.Socket;
  private readonly pendingBuffers: Buffer[] = [];

  onmessage?: (message: DaemonMessage) => void;
  onclose?: () => void;

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on('data', buffer => this.onData(buffer));
    socket.on('close', () => this.onclose?.());
    socket.on('error', () => {
      /* close 事件会随后触发；此处保持不抛出，行为对齐 playwright */
    });
  }

  send(message: object): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.write(`${JSON.stringify(message)}\n`, err =>
        err ? reject(err) : resolve(),
      );
    });
  }

  close(): void {
    this.socket.destroy();
  }

  private onData(buffer: Buffer): void {
    let end = buffer.indexOf('\n');
    if (end === -1) {
      this.pendingBuffers.push(buffer);
      return;
    }
    this.pendingBuffers.push(buffer.subarray(0, end));
    this.dispatch(Buffer.concat(this.pendingBuffers).toString());
    let start = end + 1;
    end = buffer.indexOf('\n', start);
    while (end !== -1) {
      this.dispatch(buffer.toString(undefined, start, end));
      start = end + 1;
      end = buffer.indexOf('\n', start);
    }
    this.pendingBuffers.length = 0;
    if (start < buffer.length) this.pendingBuffers.push(buffer.subarray(start));
  }

  private dispatch(line: string): void {
    if (!line) return;
    try {
      this.onmessage?.(JSON.parse(line) as DaemonMessage);
    } catch {
      // 非法行直接丢弃：协议双方都是本仓库产物，出现脏数据时静默比崩溃好
    }
  }
}
