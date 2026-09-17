/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {EventEmitter} from 'node:events';

import type {
  CDPCommand,
  CDPConnection,
  CDPConnectionObserver,
  CDPError,
  CommandParams,
  CommandResult,
} from '../../../third_party/cdp.js';
import type {ExtensionSessionManager} from '../host/ExtensionSessionManager.js';
import type {
  ExtensionCdpDetachParams,
  ExtensionCdpEventParams,
} from '../protocol/types.js';

/**
 * ExtensionCDPSession:
 * Adapts an extension-controlled Chrome Tab into a standard CDPSession
 * compatible with both Patchright/Playwright CDPSession and CDPConnection interfaces.
 */
export class ExtensionCDPSession extends EventEmitter implements CDPConnection {
  private readonly observers = new Set<CDPConnectionObserver>();
  private readonly cdpEventListener: (data: ExtensionCdpEventParams) => void;
  private readonly cdpDetachListener: (data: ExtensionCdpDetachParams) => void;
  private detached = false;

  constructor(
    public readonly tabId: number,
    private readonly manager: ExtensionSessionManager,
    public readonly sessionId?: string,
  ) {
    super();

    this.cdpEventListener = (data: ExtensionCdpEventParams) => {
      if (this.detached) return;
      if (
        this.sessionId &&
        data.sessionId &&
        data.sessionId !== this.sessionId
      ) {
        return;
      }

      // 1. Emit as standard EventEmitter: 'Debugger.paused', params
      this.emit(data.method, data.params);
      this.emit('event', {
        method: data.method,
        params: data.params,
        sessionId: data.sessionId,
      });

      // 2. Notify CDPConnection observers
      for (const obs of this.observers) {
        try {
          obs.onEvent({
            method: data.method,
            sessionId: data.sessionId,
            params: data.params,
          });
        } catch (err) {
          console.error(
            '[ExtensionCDPSession] Error in observer onEvent:',
            err,
          );
        }
      }
    };

    this.cdpDetachListener = (data: ExtensionCdpDetachParams) => {
      this.detached = true;
      this.emit('close');
      this.emit('detach', data.reason);

      for (const obs of this.observers) {
        try {
          obs.onDisconnect?.();
        } catch (err) {
          console.error(
            '[ExtensionCDPSession] Error in observer onDisconnect:',
            err,
          );
        }
      }
    };

    this.manager.on(`cdpEvent:${this.tabId}`, this.cdpEventListener);
    this.manager.on(`cdpDetach:${this.tabId}`, this.cdpDetachListener);
  }

  /**
   * Patchright / Playwright CDPSession standard send method
   */
  async send<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    if (this.detached) {
      throw new Error(`CDPSession on tab ${this.tabId} is detached`);
    }
    return this.manager.executeCdp<T>(
      this.tabId,
      method,
      params ?? {},
      this.sessionId,
    );
  }

  /**
   * Detach the debugger from this tab
   */
  async detach(): Promise<void> {
    if (this.detached) return;
    this.cleanup();
    await this.manager.detach(this.tabId);
  }

  // --- CDPConnection implementation ---

  observe(observer: CDPConnectionObserver): void {
    this.observers.add(observer);
  }

  unobserve(observer: CDPConnectionObserver): void {
    this.observers.delete(observer);
  }

  async sendCommand<T extends CDPCommand>(
    method: T,
    params: CommandParams<T>,
    sessionId: string | undefined,
  ): Promise<{result: CommandResult<T>} | {error: CDPError}> {
    try {
      const result = await this.manager.executeCdp<CommandResult<T>>(
        this.tabId,
        method,
        params as Record<string, unknown>,
        sessionId ?? this.sessionId,
      );
      return {result};
    } catch (err) {
      return {
        error: {
          code: -32000,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private cleanup(): void {
    this.detached = true;
    this.manager.removeListener(
      `cdpEvent:${this.tabId}`,
      this.cdpEventListener,
    );
    this.manager.removeListener(
      `cdpDetach:${this.tabId}`,
      this.cdpDetachListener,
    );
    this.observers.clear();
  }

  isDetached(): boolean {
    return this.detached;
  }
}
