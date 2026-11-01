/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {createHash} from 'node:crypto';

import type {BrowserContext, Disposable} from 'patchright';

import {createToolError, ErrorCodes} from '../../utils/errors.js';

export interface PersistentHookEntry {
  hookId: string;
  scriptHash: string;
  scriptSize: number;
  scriptPreview: string;
  registeredAt: number;
  source: 'inject_hook';
  requestedWorld: 'main' | 'isolated';
  effectiveWorld: 'main';
  applyMode: 'existing-and-future' | 'future-only';
}

export interface RegisterPersistentHookRequest {
  context: BrowserContext;
  hookId: string;
  script: string;
  source: PersistentHookEntry['source'];
  requestedWorld: PersistentHookEntry['requestedWorld'];
  applyMode: PersistentHookEntry['applyMode'];
}

export interface RegisterPersistentHookResult {
  entry: PersistentHookEntry;
  registered: boolean;
  idempotent: boolean;
  appliedFrames: number;
  failedFrames: Array<{frameUrl: string; reason: string}>;
  partial: boolean;
  warnings: string[];
}

interface InFlightRegistration {
  scriptHash: string;
  promise: Promise<RegisterPersistentHookResult>;
}

export function hashPersistentHookScript(script: string): string {
  return createHash('sha256').update(script).digest('hex');
}

function createScriptPreview(script: string): string {
  const characters: string[] = [];
  for (const character of script) {
    if (characters.length === 200) {
      return `${characters.slice(0, 199).join('')}…`;
    }
    characters.push(character);
  }
  return characters.join('');
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function contextClosedError(): Error {
  return createToolError(
    ErrorCodes.CONNECTION,
    'Browser context is closed; reconnect or create a new context and retry.',
  );
}

function conflictError(hookId: string): Error {
  return createToolError(
    ErrorCodes.VALIDATION,
    `Persistent hook "${hookId}" already uses a different script. Use a new hookId or recreate the BrowserContext.`,
  );
}

export class PersistentHookRegistry {
  private readonly entriesByContext = new WeakMap<
    BrowserContext,
    Map<string, PersistentHookEntry>
  >();
  private readonly observedContexts = new WeakSet<BrowserContext>();
  private readonly inFlightByContext = new WeakMap<
    BrowserContext,
    Map<string, InFlightRegistration>
  >();
  private readonly disposablesByContext = new WeakMap<
    BrowserContext,
    Map<string, Disposable>
  >();

  register(
    request: RegisterPersistentHookRequest,
  ): Promise<RegisterPersistentHookResult> {
    const hookId = request.hookId.trim();
    if (!hookId || !request.script.trim()) {
      return Promise.reject(
        createToolError(
          ErrorCodes.VALIDATION,
          'Persistent hookId and script must not be empty.',
        ),
      );
    }
    if (request.context.isClosed()) {
      return Promise.reject(contextClosedError());
    }

    const scriptHash = hashPersistentHookScript(request.script);
    const entries = this.getOrCreateEntries(request.context);
    const existing = entries.get(hookId);
    if (existing) {
      return existing.scriptHash === scriptHash
        ? Promise.resolve(this.idempotentResult(existing))
        : Promise.reject(conflictError(hookId));
    }

    const inFlight = this.getOrCreateInFlight(request.context);
    const reservation = inFlight.get(hookId);
    if (reservation) {
      return reservation.scriptHash === scriptHash
        ? reservation.promise
        : Promise.reject(conflictError(hookId));
    }

    let resolveRegistration!: (result: RegisterPersistentHookResult) => void;
    let rejectRegistration!: (error: unknown) => void;
    const promise = new Promise<RegisterPersistentHookResult>(
      (resolve, reject) => {
        resolveRegistration = resolve;
        rejectRegistration = reject;
      },
    );
    const currentReservation = {scriptHash, promise};
    inFlight.set(hookId, currentReservation);

    void this.performRegistration(request, hookId, scriptHash, entries)
      .then(resolveRegistration, rejectRegistration)
      .finally(() => {
        if (inFlight.get(hookId) === currentReservation) {
          inFlight.delete(hookId);
        }
      });
    return promise;
  }

  list(context: BrowserContext): PersistentHookEntry[] {
    if (context.isClosed()) return [];
    return [...(this.entriesByContext.get(context)?.values() ?? [])].map(
      entry => ({...entry}),
    );
  }

  private getOrCreateEntries(
    context: BrowserContext,
  ): Map<string, PersistentHookEntry> {
    let entries = this.entriesByContext.get(context);
    if (!entries) {
      entries = new Map();
      this.entriesByContext.set(context, entries);
    }
    if (!this.observedContexts.has(context)) {
      this.observedContexts.add(context);
      context.once('close', () => this.cleanupContext(context));
    }
    return entries;
  }

  private getOrCreateInFlight(
    context: BrowserContext,
  ): Map<string, InFlightRegistration> {
    let inFlight = this.inFlightByContext.get(context);
    if (!inFlight) {
      inFlight = new Map();
      this.inFlightByContext.set(context, inFlight);
    }
    return inFlight;
  }

  private cleanupContext(context: BrowserContext): void {
    this.entriesByContext.delete(context);
    this.inFlightByContext.delete(context);
    const handles = this.disposablesByContext.get(context);
    this.disposablesByContext.delete(context);
    void Promise.allSettled(
      [...(handles?.values() ?? [])].map(handle => handle.dispose()),
    );
  }

  private async performRegistration(
    request: RegisterPersistentHookRequest,
    hookId: string,
    scriptHash: string,
    entries: Map<string, PersistentHookEntry>,
  ): Promise<RegisterPersistentHookResult> {
    const entry: PersistentHookEntry = {
      hookId,
      scriptHash,
      scriptSize: Buffer.byteLength(request.script, 'utf8'),
      scriptPreview: createScriptPreview(request.script),
      registeredAt: Date.now(),
      source: request.source,
      requestedWorld: request.requestedWorld,
      effectiveWorld: 'main',
      applyMode: request.applyMode,
    };
    const warnings =
      request.requestedWorld === 'isolated'
        ? [
            'requestedWorld isolated is not supported for persistent hooks; effectiveWorld is main.',
          ]
        : [];

    const handle = await request.context.addInitScript(request.script);
    if (
      request.context.isClosed() ||
      this.entriesByContext.get(request.context) !== entries
    ) {
      await handle.dispose().catch(() => undefined);
      throw contextClosedError();
    }

    let handles = this.disposablesByContext.get(request.context);
    if (!handles) {
      handles = new Map();
      this.disposablesByContext.set(request.context, handles);
    }
    handles.set(hookId, handle);
    entries.set(hookId, entry);

    if (request.applyMode === 'future-only') {
      return this.successResult(entry, warnings, 0, []);
    }

    let appliedFrames = 0;
    const failedFrames: RegisterPersistentHookResult['failedFrames'] = [];
    const pages = request.context.pages().filter(page => !page.isClosed());
    for (const page of pages) {
      for (const frame of page.frames()) {
        try {
          await frame.evaluate(request.script);
          appliedFrames += 1;
        } catch (error) {
          failedFrames.push({
            frameUrl: frame.url(),
            reason: getErrorMessage(error),
          });
        }
        if (request.context.isClosed()) throw contextClosedError();
      }
    }

    return this.successResult(entry, warnings, appliedFrames, failedFrames);
  }

  private successResult(
    entry: PersistentHookEntry,
    warnings: string[],
    appliedFrames: number,
    failedFrames: RegisterPersistentHookResult['failedFrames'],
  ): RegisterPersistentHookResult {
    return {
      entry: {...entry},
      registered: true,
      idempotent: false,
      appliedFrames,
      failedFrames,
      partial: failedFrames.length > 0,
      warnings: [...warnings],
    };
  }

  private idempotentResult(
    entry: PersistentHookEntry,
  ): RegisterPersistentHookResult {
    return {
      entry: {...entry},
      registered: false,
      idempotent: true,
      appliedFrames: 0,
      failedFrames: [],
      partial: false,
      warnings:
        entry.requestedWorld === 'isolated'
          ? [
              'requestedWorld isolated is not supported for persistent hooks; effectiveWorld is main.',
            ]
          : [],
    };
  }
}
