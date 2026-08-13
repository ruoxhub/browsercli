/** Internal router for non-flat Target child sessions. */
import type {CDPSession} from 'patchright';

import {mapCDPError} from './CDPErrorMapper.js';

export type TargetEventListener = (
  params: Readonly<Record<string, unknown>>,
) => void;

interface ChildProtocolMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: {code: number; message: string; data?: string};
}

interface PendingCommand {
  resolve(value: Record<string, unknown>): void;
  reject(reason: Error): void;
  timeout: NodeJS.Timeout;
}

export class TargetSessionRouter {
  private nextMessageId = 1;
  private readonly sessionToTarget = new Map<string, string>();
  private readonly targetToSession = new Map<string, string>();
  private readonly pending = new Map<string, PendingCommand>();
  private readonly listeners = new Map<string, Set<TargetEventListener>>();
  private readonly earlyDetachedSessions = new Set<string>();
  private disposed = false;

  constructor(
    private readonly rootSession: CDPSession,
    private readonly commandTimeoutMs = 5_000,
  ) {
    rootSession.on(
      'Target.receivedMessageFromTarget',
      this.handleReceivedMessage,
    );
    rootSession.on('Target.detachedFromTarget', this.handleDetached);
    rootSession.on('close', this.handleRootClosed);
  }

  registerSession(sessionId: string, targetId: string): void {
    if (this.disposed) throw new Error('Target session router is disposed');
    if (this.earlyDetachedSessions.delete(sessionId)) {
      throw mapCDPError(new Error('Session closed before registration'), {
        sessionId,
        targetId,
      });
    }
    if (this.sessionToTarget.has(sessionId)) {
      throw new Error(`Duplicate sessionId: ${sessionId}`);
    }
    if (this.targetToSession.has(targetId)) {
      throw new Error(`Duplicate targetId: ${targetId}`);
    }
    this.sessionToTarget.set(sessionId, targetId);
    this.targetToSession.set(targetId, sessionId);
  }

  unregisterSession(sessionId: string, reason = new Error('Session closed')): void {
    const targetId = this.sessionToTarget.get(sessionId);
    if (!targetId) return;
    this.sessionToTarget.delete(sessionId);
    this.targetToSession.delete(targetId);
    this.rejectSession(sessionId, reason);
    for (const key of this.listeners.keys()) {
      if (key.startsWith(`${sessionId}:`)) this.listeners.delete(key);
    }
  }

  getSessionId(targetId: string): string | undefined {
    return this.targetToSession.get(targetId);
  }

  getTargetId(sessionId: string): string | undefined {
    return this.sessionToTarget.get(sessionId);
  }

  on(
    sessionId: string,
    method: string,
    listener: TargetEventListener,
  ): () => void {
    const key = `${sessionId}:${method}`;
    const listeners = this.listeners.get(key) ?? new Set<TargetEventListener>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(key);
    };
  }

  send<T extends Record<string, unknown>>(
    sessionId: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const targetId = this.sessionToTarget.get(sessionId);
    if (!targetId) return Promise.reject(new Error(`Unknown session: ${sessionId}`));
    const id = this.nextMessageId++;
    const key = `${sessionId}:${id}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(key);
        reject(
          mapCDPError(new Error(`Timed out after ${this.commandTimeoutMs}ms`), {
            sessionId,
            targetId,
          }),
        );
      }, this.commandTimeoutMs);
      this.pending.set(key, {
        resolve: value => resolve(value as T),
        reject,
        timeout,
      });
      void this.rootSession
        .send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({id, method, params}),
        })
        .catch(error => this.rejectPending(key, mapCDPError(error, {sessionId, targetId})));
    });
  }

  dispose(reason = new Error('Target session router disposed')): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rootSession.off(
      'Target.receivedMessageFromTarget',
      this.handleReceivedMessage,
    );
    this.rootSession.off('Target.detachedFromTarget', this.handleDetached);
    this.rootSession.off('close', this.handleRootClosed);
    for (const key of [...this.pending.keys()]) this.rejectPending(key, reason);
    this.sessionToTarget.clear();
    this.targetToSession.clear();
    this.listeners.clear();
    this.earlyDetachedSessions.clear();
  }

  private readonly handleReceivedMessage = (event: {
    sessionId: string;
    message: string;
  }): void => {
    const {sessionId} = event;
    let message: ChildProtocolMessage;
    try {
      message = JSON.parse(event.message) as ChildProtocolMessage;
    } catch (error) {
      this.rejectSession(
        sessionId,
        mapCDPError(error, {
          sessionId,
          targetId: this.sessionToTarget.get(sessionId),
        }),
      );
      return;
    }
    if (typeof message.id === 'number') {
      const key = `${sessionId}:${message.id}`;
      const pending = this.pending.get(key);
      if (!pending) return;
      this.pending.delete(key);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(
          mapCDPError(new Error(message.error.message), {
            sessionId,
            targetId: this.sessionToTarget.get(sessionId),
          }),
        );
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    if (message.method) {
      for (const listener of this.listeners.get(`${sessionId}:${message.method}`) ?? []) {
        listener(message.params ?? {});
      }
    }
  };

  private readonly handleDetached = (event: {sessionId: string}): void => {
    if (!this.sessionToTarget.has(event.sessionId)) {
      this.earlyDetachedSessions.add(event.sessionId);
      return;
    }
    this.unregisterSession(event.sessionId, new Error('Session closed'));
  };

  private readonly handleRootClosed = (): void => {
    this.dispose(new Error('Connection closed'));
  };

  private rejectSession(sessionId: string, reason: Error): void {
    for (const key of [...this.pending.keys()]) {
      if (key.startsWith(`${sessionId}:`)) this.rejectPending(key, reason);
    }
  }

  private rejectPending(key: string, reason: Error): void {
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    clearTimeout(pending.timeout);
    pending.reject(reason);
  }
}
