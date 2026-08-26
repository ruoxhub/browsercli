/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {CaptureSessionManager} from './CaptureSessionManager.js';
import type {SessionStore} from './SessionStore.js';
import type {
  CapturedRequestInput,
  CapturedRequestRow,
  HookRecordInput,
  HookRecordRow,
  StorageSnapshotInput,
  StorageSnapshotRow,
} from './types.js';

export interface CaptureEngineOptions {
  emitToWs?: (event: {type: string; payload: unknown}) => void;
}

export class CaptureEngine {
  private readonly emitToWs?: (event: {type: string; payload: unknown}) => void;

  constructor(
    private readonly manager: CaptureSessionManager,
    private readonly store: SessionStore,
    opts: CaptureEngineOptions = {},
  ) {
    this.emitToWs = opts.emitToWs;
  }

  ingestRequest(input: CapturedRequestInput): CapturedRequestRow {
    const session = this.manager.requireActiveSession();
    const sequence = this.manager.nextSequence(session.id);
    const row: CapturedRequestRow = {
      id: `${session.id}-${sequence}`,
      sessionId: session.id,
      sequence,
      ...input,
    };
    this.store.appendRequest(row);
    this.emitToWs?.({type: 'session.request', payload: row});
    return row;
  }

  ingestHook(input: HookRecordInput): HookRecordRow {
    const session = this.manager.requireActiveSession();
    const row: HookRecordRow = {
      sessionId: session.id,
      ...input,
    };
    this.store.appendHook(row);
    this.emitToWs?.({type: 'session.hook', payload: row});
    return row;
  }

  ingestSnapshot(input: StorageSnapshotInput): StorageSnapshotRow {
    const session = this.manager.requireActiveSession();
    const row: StorageSnapshotRow = {
      sessionId: session.id,
      ...input,
    };
    this.store.appendSnapshot(row);
    this.emitToWs?.({type: 'session.snapshot', payload: row});
    return row;
  }
}
