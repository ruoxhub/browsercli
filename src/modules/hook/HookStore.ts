/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {EventEmitter} from 'node:events';

/**
 * Hook 数据存储层。保存浏览器回传的采样记录，支持按 hookId 查询、清理、快照。
 *
 * @see {@link src/modules/hook/HookManager.ts} — 门面模式，通过 HookStore 存取数据
 * @see {@link src/web/ConsoleServer.ts} — 订阅 hookStore events 桥接到 WebSocket
 * @see {@link src/tools/hook/InjectHook.ts} — inject_hook 工具调用 HookStore.ensure()
 */

export const DEFAULT_HOOK_STORE_KEY = '__hookStore';

export type HookStoreSnapshot<RecordType> = Record<string, RecordType[]>;

/**
 * HookStoreEvents — 类型化事件签名。
 * - 'sample': 浏览器侧通过 addRecord 回传一条采样记录后触发，供 ConsoleServer 桥接到 WebSocket。
 */
export interface HookStoreEvents<RecordType> {
  sample: [hookId: string, record: RecordType];
}

export class HookStore<RecordType> {
  private readonly recordsByHook = new Map<string, RecordType[]>();
  private readonly maxRecordsPerHook: number;
  /**
   * 类型化事件发射器。监听者通过 events.on('sample', (hookId, record) => ...) 订阅。
   * 仅在 add() push 成功后发射，failure 路径不发射。
   */
  public readonly events = new EventEmitter<HookStoreEvents<RecordType>>();

  constructor(maxRecordsPerHook = 1000) {
    this.maxRecordsPerHook = maxRecordsPerHook;
  }

  ensure(hookId: string): void {
    if (!this.recordsByHook.has(hookId)) {
      this.recordsByHook.set(hookId, []);
    }
  }

  getHookIds(): string[] {
    return Array.from(this.recordsByHook.keys());
  }

  add(hookId: string, record: RecordType): void {
    const records = this.recordsByHook.get(hookId);
    if (records === undefined) {
      this.recordsByHook.set(hookId, [record]);
      this.events.emit('sample', hookId, record);
      return;
    }
    if (records.length >= this.maxRecordsPerHook) {
      records.shift();
    }
    records.push(record);
    this.events.emit('sample', hookId, record);
  }

  get(hookId: string): RecordType[] {
    return this.recordsByHook.get(hookId) ?? [];
  }

  remove(hookId: string): boolean {
    return this.recordsByHook.delete(hookId);
  }

  clear(hookId?: string): void {
    if (hookId) {
      this.recordsByHook.set(hookId, []);
      return;
    }

    this.recordsByHook.clear();
  }

  snapshot(): HookStoreSnapshot<RecordType> {
    return Object.fromEntries(
      Array.from(this.recordsByHook.entries(), ([hookId, records]) => [
        hookId,
        [...records],
      ]),
    );
  }
}
