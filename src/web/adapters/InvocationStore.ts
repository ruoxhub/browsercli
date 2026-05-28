/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * InvocationStore —— 工具调用历史的内存环形缓冲（max 1000 条）。
 *
 * 由 ConsoleServer 在启动时实例化，订阅 ToolAdapter.onInvoke 把
 * ToolInvokeEvent 落到这里；REST /api/invocations 直接读它。
 *
 * 设计取舍：
 * - 内存存储而非持久化。Worker 进程重启即清，与 ToolResultRecorder 的 JSONL
 *   落盘分工：Recorder 是审计长存，InvocationStore 是 UI 即时回看（最近 N 条）。
 * - 环形缓冲固定上限，避免长时运行 OOM。
 * - traceId 作为外部主键，id 作为内部主键（rec_<base36ts>_<seq6>）。同一调用的
 *   InvocationRecord.traceId 与 ToolInvokeEvent.traceId 是 1:1 关系。
 */

import type {InvocationRecord} from '../types.js';

const DEFAULT_MAX = 1000;

export class InvocationStore {
  private readonly max: number;
  private readonly records: InvocationRecord[] = [];
  private seq = 0;

  constructor(max = DEFAULT_MAX) {
    this.max = max;
  }

  /**
   * 追加一条调用记录，分配内部 id。返回带 id 的完整记录（调用方可拿到该 id 用于 GET /:id）。
   * 超过 max 时从队首淘汰最旧的一条。
   */
  add(record: Omit<InvocationRecord, 'id'>): InvocationRecord {
    const id = this.nextId();
    const full: InvocationRecord = {id, ...record};
    if (this.records.length >= this.max) this.records.shift();
    this.records.push(full);
    return full;
  }

  /**
   * 返回最近 limit 条记录（默认全部，按时间倒序）。
   * limit > store size 时不报错，返回全部。
   */
  getRecent(limit?: number): InvocationRecord[] {
    const reversed = [...this.records].reverse();
    if (limit === undefined || limit >= reversed.length) return reversed;
    return reversed.slice(0, limit);
  }

  /** 按内部 id 查单条；找不到返回 undefined。 */
  getById(id: string): InvocationRecord | undefined {
    return this.records.find(r => r.id === id);
  }

  /** 按 traceId 查单条；找不到返回 undefined。 */
  getByTraceId(traceId: string): InvocationRecord | undefined {
    return this.records.find(r => r.traceId === traceId);
  }

  /** 当前缓冲大小（测试用）。 */
  size(): number {
    return this.records.length;
  }

  /** 清空缓冲（仅供测试与诊断）。 */
  clear(): void {
    this.records.length = 0;
    this.seq = 0;
  }

  private nextId(): string {
    this.seq = (this.seq + 1) & 0xffffff;
    const seqPart = this.seq.toString(36).padStart(6, '0');
    const tsPart = Date.now().toString(36);
    return `rec_${tsPart}_${seqPart}`;
  }
}
