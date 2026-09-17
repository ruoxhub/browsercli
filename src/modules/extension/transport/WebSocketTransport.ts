/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {EventEmitter} from 'node:events';
import type {Server} from 'node:http';
import {createServer} from 'node:http';

import {WebSocketServer, type WebSocket} from 'ws';

import type {JsonRpcMessage} from '../protocol/types.js';

export interface WebSocketExtensionServerOptions {
  port?: number;
  host?: string;
  path?: string;
}

export class WebSocketExtensionServer extends EventEmitter {
  private readonly port: number;
  private readonly host: string;
  private readonly path: string;
  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;
  private activeClient: WebSocket | null = null;

  constructor(options?: WebSocketExtensionServerOptions) {
    super();
    this.port = options?.port ?? 19823;
    this.host = options?.host ?? '127.0.0.1';
    this.path = options?.path ?? '/extension';
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.httpServer = createServer();
        this.wss = new WebSocketServer({
          server: this.httpServer,
          path: this.path,
        });

        this.wss.on('connection', (ws: WebSocket) => {
          this.activeClient = ws;
          this.emit('connection', ws);

          ws.on('message', (data: Buffer | string) => {
            try {
              const text =
                typeof data === 'string' ? data : data.toString('utf8');
              const message = JSON.parse(text) as JsonRpcMessage;
              this.emit('message', message);
            } catch (err) {
              this.emit(
                'error',
                new Error(
                  `Failed to parse WS JSON message: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                ),
              );
            }
          });

          ws.on('close', (code, reason) => {
            if (this.activeClient === ws) {
              this.activeClient = null;
            }
            this.emit('disconnect', {code, reason: reason.toString('utf8')});
          });

          ws.on('error', err => {
            this.emit('error', err);
          });
        });

        this.httpServer.listen(this.port, this.host, () => {
          resolve();
        });

        this.httpServer.on('error', err => {
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  send(message: JsonRpcMessage): void {
    if (
      !this.activeClient ||
      this.activeClient.readyState !== this.activeClient.OPEN
    ) {
      throw new Error('No active WebSocket extension client connected');
    }
    this.activeClient.send(JSON.stringify(message));
  }

  hasClient(): boolean {
    return (
      this.activeClient !== null &&
      this.activeClient.readyState === this.activeClient.OPEN
    );
  }

  async stop(): Promise<void> {
    if (this.activeClient) {
      try {
        this.activeClient.close();
      } catch {
        // ignore
      }
      this.activeClient = null;
    }

    if (this.wss) {
      await new Promise<void>(resolve => {
        this.wss?.close(() => resolve());
      });
      this.wss = null;
    }

    if (this.httpServer) {
      await new Promise<void>(resolve => {
        this.httpServer?.close(() => resolve());
      });
      this.httpServer = null;
    }
  }
}
