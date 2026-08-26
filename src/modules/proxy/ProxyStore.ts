/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {EventEmitter} from 'node:events';

import type {CapturedExchange, CapturedRequest} from './types.js';

/**
 * ProxyStore — MITM 捕获记录的内存环形缓冲。
 *
 * 稳定 id 从 1 递增，clear() 后重置。超过 maxRecords 时淘汰最旧记录。
 */
export class ProxyStore {
  readonly events = new EventEmitter();
  private readonly records: CapturedRequest[] = [];
  private readonly maxRecords: number;
  private nextId = 1;

  constructor(maxRecords = 2000) {
    this.maxRecords = maxRecords;
  }

  add(exchange: CapturedExchange): CapturedRequest {
    const record: CapturedRequest = {...exchange, id: this.nextId++};
    if (this.records.length >= this.maxRecords) {
      this.records.shift();
    }
    this.records.push(record);
    this.events.emit('capture', record);
    return record;
  }

  list(): CapturedRequest[] {
    return [...this.records];
  }

  get(id: number): CapturedRequest | undefined {
    return this.records.find(r => r.id === id);
  }

  clear(): void {
    this.records.length = 0;
    this.nextId = 1;
    this.events.emit('clear');
  }

  size(): number {
    return this.records.length;
  }
}
