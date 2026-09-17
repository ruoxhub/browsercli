/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {EventEmitter} from 'node:events';
import type {Readable, Writable} from 'node:stream';

import type {JsonRpcMessage} from '../protocol/types.js';

export interface NativeMessagingOptions {
  input?: Readable;
  output?: Writable;
}

/**
 * NativeMessagingHost:
 * Implements Chrome's Native Messaging stdio framing protocol:
 * [ 4-byte uint32 little-endian message length ][ UTF-8 JSON payload ]
 */
export class NativeMessagingHost extends EventEmitter {
  private readonly input: Readable;
  private readonly output: Writable;
  private buffer: Buffer = Buffer.alloc(0);
  private closed = false;

  constructor(options?: NativeMessagingOptions) {
    super();
    this.input = options?.input ?? process.stdin;
    this.output = options?.output ?? process.stdout;

    this.setupInputStream();
  }

  private setupInputStream(): void {
    this.input.on('data', (chunk: Buffer) => {
      if (this.closed) return;
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processBuffer();
    });

    this.input.on('end', () => {
      this.close('Input stream ended');
    });

    this.input.on('error', err => {
      this.emit('error', err);
      this.close(`Input error: ${err.message}`);
    });
  }

  private processBuffer(): void {
    while (this.buffer.length >= 4) {
      const msgLen = this.buffer.readUInt32LE(0);
      const totalLen = 4 + msgLen;

      if (this.buffer.length < totalLen) {
        // Need more data
        break;
      }

      const payloadBuf = this.buffer.subarray(4, totalLen);
      this.buffer = this.buffer.subarray(totalLen);

      try {
        const text = payloadBuf.toString('utf8');
        const parsed = JSON.parse(text) as JsonRpcMessage;
        this.emit('message', parsed);
      } catch (err) {
        this.emit(
          'error',
          new Error(
            `Failed to parse native message JSON: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
      }
    }
  }

  send(message: JsonRpcMessage): void {
    if (this.closed) {
      throw new Error('NativeMessagingHost is closed');
    }

    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);

    this.output.write(header);
    this.output.write(payload);
  }

  close(reason = 'Normal closure'): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', reason);
  }

  isClosed(): boolean {
    return this.closed;
  }
}
