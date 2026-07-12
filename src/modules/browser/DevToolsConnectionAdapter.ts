/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CDPSession} from 'patchright';

import type {
  CDPConnection,
  CDPConnectionObserver,
  CDPCommand,
  CDPError,
  CommandParams,
  CommandResult,
} from '../../third_party/index.js';

/**
 * This class makes a Playwright CDP connection look like DevTools CDPConnection.
 *
 * Playwright CDPSession API differences from Puppeteer:
 * - Broad event listening: `session.on('event', ({method, params}) => ...)` instead of `session.on('*', handler)`
 * - `session.send(method, params)` uses Protocol.CommandParameters/CommandReturnValues (strictly typed)
 * - No `session.connection()` equivalent
 * - No `sessionattached`/`sessiondetached` events on CDPSession
 *   (these are only on BrowserContext)
 *
 * Design:
 * - We use Playwright's `session.on('event', ...)` for broad CDP event forwarding
 * - We track sessions manually since Playwright doesn't auto-propagate session lifecycle
 * - For session management, callers should use BrowserContext events
 */
export class PlaywrightDevToolsConnection implements CDPConnection {
  readonly #rootSession: CDPSession;
  readonly #childSessions = new Map<string, CDPSession>();
  readonly #observers = new Set<CDPConnectionObserver>();
  #sessionIdCounter = 0;

  constructor(session: CDPSession) {
    this.#rootSession = session;
    const rootId = `session-${this.#sessionIdCounter++}`;
    this.#childSessions.set(rootId, session);
    this.#startForwardingCdpEvents(rootId, session);
  }

  /**
   * Register a child CDPSession for forwarding.
   * Call this when a new CDP session is created via BrowserContext or page.
   */
  registerSession(session: CDPSession): string {
    const id = `session-${this.#sessionIdCounter++}`;
    this.#childSessions.set(id, session);
    this.#startForwardingCdpEvents(id, session);
    return id;
  }

  /**
   * Unregister a child CDPSession.
   */
  unregisterSession(sessionId: string): void {
    this.#childSessions.delete(sessionId);
  }

  send<T extends CDPCommand>(
    method: T,
    params: CommandParams<T>,
    sessionId: string | undefined,
  ): Promise<{result: CommandResult<T>} | {error: CDPError}> {
    if (sessionId === undefined) {
      throw new Error(
        'Attempting to send on the root session. This must not happen',
      );
    }
    const session = this.#childSessions.get(sessionId) ?? this.#rootSession;
    // Playwright's CDPSession.send is strictly typed with Protocol.CommandParameters.
    // We use type assertion since our CDPCommand is just string.
    return (
      session.send as (
        method: string,
        params?: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>
    )(method, params as Record<string, unknown>)
      .then(result => ({result: result as CommandResult<T>}))
      .catch(error => ({
        error: {
          code: -1,
          message: error instanceof Error ? error.message : String(error),
        },
      }));
  }

  observe(observer: CDPConnectionObserver): void {
    this.#observers.add(observer);
  }

  unobserve(observer: CDPConnectionObserver): void {
    this.#observers.delete(observer);
  }

  #startForwardingCdpEvents(sessionId: string, session: CDPSession): void {
    // Playwright CDPSession supports broad event listening via:
    //   session.on('event', ({method, params}) => { ... })
    // This is equivalent to Puppeteer's session.on('*', handler)
    session.on('event', (data: {method: string; params?: object}) => {
      this.#observers.forEach(observer =>
        observer.onEvent({
          method: data.method as CDPCommand,
          sessionId,
          params: (data.params ?? {}) as Record<string, unknown>,
        }),
      );
    });

    // Also forward session close events
    session.on('close', () => {
      this.#childSessions.delete(sessionId);
    });
  }
}
