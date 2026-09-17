/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types.js';

export interface TransportSender {
  send(message: JsonRpcMessage): void;
}

export class JsonRpcPeer {
  private nextId = 1;
  private readonly pendingRequests = new Map<
    number | string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private readonly notificationHandlers = new Map<
    string,
    Set<(params: unknown) => void>
  >();
  private readonly requestHandlers = new Map<
    string,
    (params: unknown) => Promise<unknown> | unknown
  >();

  constructor(private readonly transport: TransportSender) {}

  sendRequest<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = 15000,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(
            new Error(
              `JSON-RPC request timed out for method '${method}' after ${timeoutMs}ms`,
            ),
          );
        }
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (val: unknown) => void,
        reject,
        timer,
      });

      try {
        this.transport.send({
          jsonrpc: '2.0',
          id,
          method,
          params,
        });
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  sendNotification(method: string, params?: unknown): void {
    this.transport.send({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  sendResponse(id: number | string, result: unknown): void {
    this.transport.send({
      jsonrpc: '2.0',
      id,
      result,
    });
  }

  sendError(id: number | string, code: number, message: string): void {
    this.transport.send({
      jsonrpc: '2.0',
      id,
      error: {code, message},
    });
  }

  onNotification(
    method: string,
    handler: (params: unknown) => void,
  ): () => void {
    let handlers = this.notificationHandlers.get(method);
    if (!handlers) {
      handlers = new Set();
      this.notificationHandlers.set(method, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers?.delete(handler);
    };
  }

  onRequest(
    method: string,
    handler: (params: unknown) => Promise<unknown> | unknown,
  ): () => void {
    this.requestHandlers.set(method, handler);
    return () => {
      this.requestHandlers.delete(method);
    };
  }

  async handleMessage(message: JsonRpcMessage): Promise<void> {
    // 1. Response to our pending request
    if ('id' in message && ('result' in message || 'error' in message)) {
      const response = message as JsonRpcResponse;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        this.pendingRequests.delete(response.id);
        clearTimeout(pending.timer);
        if (response.error) {
          pending.reject(
            new Error(
              response.error.message ||
                `RPC error code: ${response.error.code}`,
            ),
          );
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    // 2. Incoming Request with id
    if ('id' in message && 'method' in message) {
      const request = message as JsonRpcRequest;
      const handler = this.requestHandlers.get(request.method);
      if (!handler) {
        this.sendError(
          request.id,
          -32601,
          `Method not found: ${request.method}`,
        );
        return;
      }
      try {
        const result = await handler(request.params);
        this.sendResponse(request.id, result !== undefined ? result : {});
      } catch (err) {
        this.sendError(
          request.id,
          -32000,
          err instanceof Error ? err.message : String(err),
        );
      }
      return;
    }

    // 3. Incoming Notification (no id)
    if (!('id' in message) && 'method' in message) {
      const notification = message as JsonRpcNotification;
      const handlers = this.notificationHandlers.get(notification.method);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(notification.params);
          } catch (err) {
            console.error(
              `[JsonRpcPeer] Error in notification handler for ${notification.method}:`,
              err,
            );
          }
        }
      }
    }
  }

  close(reason = 'Peer closed'): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }
}
