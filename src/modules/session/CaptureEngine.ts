/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {logger} from '../../utils/logger.js';

import type {CaptureSessionManager} from './CaptureSessionManager.js';
import {DEFAULT_SESSION_KEEP, TRIM_EVERY_INGESTS} from './constants.js';
import type {SessionStore} from './SessionStore.js';
import {toSummary} from './summary.js';
import type {
  CaptureSource,
  CapturedRequestInput,
  CapturedRequestRow,
  HookRecordInput,
  HookRecordRow,
  StorageSnapshotInput,
  StorageSnapshotRow,
} from './types.js';

export interface CaptureEngineOptions {
  emitToWs?: (event: {type: string; payload: unknown}) => void;
  /** 会话保留配额，默认 DEFAULT_SESSION_KEEP（spec §9 / D4）。 */
  keepLast?: number;
  /** 每多少次成功落库触发一次 trim，默认 TRIM_EVERY_INGESTS。 */
  trimEveryIngests?: number;
}

/**
 * CaptureEngine —— CDP 与 MITM 两条链路的唯一聚合点（spec §3）。
 *
 * 契约：
 * 1. 摄入**绝不向生产者抛错**。落库失败只 warn + 计数，返回 null，
 *    避免异常冒泡进 Playwright / MITM 的事件回调（spec §4 / R3）。
 * 2. WS 只推摘要（`toSummary`），body 的唯一出口是 REST 详情（spec §8 / R1）。
 * 3. 配额由本类（唯一写入方）按 ingest 计数摊销维护（spec §9 / D4）。
 * 4. 双源独立开关：`enabledSources` 是 CDP / MITM 两条链路共用的总闸，
 *    关闭某源后该源的 ingestRequest 静默早退（不落库、不建会话、不推 WS）。
 *    默认双源开启，保持既有行为与测试兼容。
 */
export class CaptureEngine {
  private emitToWs?: (event: {type: string; payload: unknown}) => void;
  private readonly keepLast: number;
  private readonly trimEveryIngests: number;
  private ingestsSinceTrim = 0;
  private failureCount = 0;
  private readonly enabledSources = new Set<CaptureSource>([
    'cdp',
    'proxy',
  ]);

  constructor(
    private readonly manager: CaptureSessionManager,
    private readonly store: SessionStore,
    opts: CaptureEngineOptions = {},
  ) {
    this.emitToWs = opts.emitToWs;
    this.keepLast = opts.keepLast ?? DEFAULT_SESSION_KEEP;
    this.trimEveryIngests = opts.trimEveryIngests ?? TRIM_EVERY_INGESTS;
  }

  /**
   * 晚绑定 WS 桥接：Runtime 在 ConsoleServer 之前建立，
   * 回调只能在 server.start() 时注入（spec §8）。可传 undefined 解绑。
   */
  setEmitToWs(
    emitToWs?: (event: {type: string; payload: unknown}) => void,
  ): void {
    this.emitToWs = emitToWs;
  }

  /**
   * 只读暴露 store 引用（Task 6 的 REST 路由需要它）。
   * 返回接口而非实现类：构造方注入的就是 `SessionStore`，
   * 收窄成 `SqliteSessionStore` 会在相接处报 TS2739（缺 manager / db 私有字段）。
   */
  getStore(): SessionStore {
    return this.store;
  }

  /** 摄入失败累计次数（落库异常被隔离的次数）。 */
  getFailureCount(): number {
    return this.failureCount;
  }

  /** 该源是否开启捕获（默认 true）。 */
  isSourceEnabled(source: CaptureSource): boolean {
    return this.enabledSources.has(source);
  }

  /** 当前开启的捕获源快照（路由返回给前端渲染开关状态）。 */
  getEnabledSources(): CaptureSource[] {
    return [...this.enabledSources];
  }

  /** 开/关某条捕获源的摄入。返回更新后的开关集合。 */
  setSourceEnabled(source: CaptureSource, enabled: boolean): CaptureSource[] {
    if (enabled) this.enabledSources.add(source);
    else this.enabledSources.delete(source);
    return this.getEnabledSources();
  }

  ingestRequest(input: CapturedRequestInput): CapturedRequestRow | null {
    // 双源独立开关：关闭的源静默丢弃，不落库、不建会话、不推 WS。
    if (!this.enabledSources.has(input.source)) {
      return null;
    }
    let row: CapturedRequestRow;
    try {
      const session = this.manager.ensureActiveSession();
      const sequence = this.manager.nextSequence(session.id);
      row = {
        id: `${session.id}-${sequence}`,
        sessionId: session.id,
        sequence,
        ...input,
      };
      this.store.appendRequest(row);
      this.trackTrim(session.id);
    } catch (error) {
      this.failureCount += 1;
      logger.warn(
        `[CaptureEngine] 请求摄入落库失败，已丢弃第 ${this.failureCount} 条`,
        error,
      );
      return null;
    }
    this.emitToWs?.({type: 'session.request', payload: toSummary(row)});
    return row;
  }

  ingestHook(input: HookRecordInput): HookRecordRow | null {
    let row: HookRecordRow;
    try {
      const session = this.manager.ensureActiveSession();
      row = {sessionId: session.id, ...input};
      this.store.appendHook(row);
    } catch (error) {
      this.failureCount += 1;
      logger.warn('[CaptureEngine] Hook 摄入落库失败，已丢弃', error);
      return null;
    }
    this.emitToWs?.({type: 'session.hook', payload: row});
    return row;
  }

  ingestSnapshot(input: StorageSnapshotInput): StorageSnapshotRow | null {
    let row: StorageSnapshotRow;
    try {
      const session = this.manager.ensureActiveSession();
      row = {sessionId: session.id, ...input};
      this.store.appendSnapshot(row);
    } catch (error) {
      this.failureCount += 1;
      logger.warn('[CaptureEngine] 快照摄入落库失败，已丢弃', error);
      return null;
    }
    this.emitToWs?.({type: 'session.snapshot', payload: row});
    return row;
  }

  private trackTrim(sessionId: string): void {
    this.ingestsSinceTrim += 1;
    if (this.ingestsSinceTrim < this.trimEveryIngests) {
      return;
    }
    this.ingestsSinceTrim = 0;
    try {
      this.store.trimRequests(sessionId, this.keepLast);
    } catch (error) {
      // trim 失败只影响配额，不算摄入失败：行仍在库里，下次 ingest 再试。
      logger.warn('[CaptureEngine] trim 失败，本轮保留全部行', error);
    }
  }
}
