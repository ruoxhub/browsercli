/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {BrowserContext, Disposable, Frame, Page} from 'patchright';

import {
  createPreloadHookId,
  PersistentHookRegistry,
} from '../../../../src/modules/hook/PersistentHookRegistry.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

class FakeDisposable implements Disposable {
  disposeCalls = 0;

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }
}

class FakeFrame {
  constructor(
    private readonly frameUrl: string,
    private readonly events: string[],
    private readonly evaluateError?: Error,
  ) {}

  url(): string {
    return this.frameUrl;
  }

  async evaluate(script: string): Promise<void> {
    this.events.push(`frame:evaluate:${this.frameUrl}:${script}`);
    if (this.evaluateError) throw this.evaluateError;
  }
}

class FakePage {
  private closed = false;

  constructor(private readonly pageFrames: FakeFrame[]) {}

  frames(): Frame[] {
    return this.pageFrames as unknown as Frame[];
  }

  isClosed(): boolean {
    return this.closed;
  }

  closeForTest(): void {
    this.closed = true;
  }
}

class FakeContext {
  private closed = false;
  private closeListener?: () => void;
  readonly addInitScripts: string[] = [];
  readonly handles: FakeDisposable[] = [];
  addInitError?: Error;
  addInitDeferred?: Deferred<Disposable>;

  constructor(
    readonly events: string[],
    private readonly contextPages: FakePage[] = [],
  ) {}

  isClosed(): boolean {
    return this.closed;
  }

  once(event: 'close', listener: () => void): this {
    assert.equal(event, 'close');
    assert.equal(
      this.closeListener,
      undefined,
      'close listener registered once',
    );
    this.closeListener = listener;
    return this;
  }

  async addInitScript(script: string): Promise<Disposable> {
    this.events.push('context:addInitScript');
    this.addInitScripts.push(script);
    if (this.addInitError) throw this.addInitError;
    if (this.addInitDeferred) return this.addInitDeferred.promise;
    const handle = new FakeDisposable();
    this.handles.push(handle);
    return handle;
  }

  pages(): Page[] {
    return this.contextPages as unknown as Page[];
  }

  closeForTest(): void {
    this.closed = true;
    this.closeListener?.();
  }
}

function register(
  registry: PersistentHookRegistry,
  context: FakeContext,
  overrides: Partial<{
    hookId: string;
    script: string;
    requestedWorld: 'main' | 'isolated';
    applyMode: 'existing-and-future' | 'future-only';
  }> = {},
) {
  return registry.register({
    context: context as unknown as BrowserContext,
    hookId: overrides.hookId ?? 'hook-1',
    script: overrides.script ?? 'globalThis.hooked = true;',
    source: 'inject_hook',
    requestedWorld: overrides.requestedWorld ?? 'main',
    applyMode: overrides.applyMode ?? 'existing-and-future',
  });
}

describe('PersistentHookRegistry', () => {
  it('registers init script before backfilling every open frame', async () => {
    const events: string[] = [];
    const closedPage = new FakePage([
      new FakeFrame('https://closed.test/', events),
    ]);
    closedPage.closeForTest();
    const context = new FakeContext(events, [
      new FakePage([
        new FakeFrame('https://one.test/', events),
        new FakeFrame('https://one.test/frame', events),
      ]),
      closedPage,
      new FakePage([new FakeFrame('https://two.test/', events)]),
    ]);

    const result = await register(new PersistentHookRegistry(), context);

    assert.equal(events[0], 'context:addInitScript');
    assert.equal(result.appliedFrames, 3);
    assert.deepEqual(result.failedFrames, []);
    assert.equal(result.partial, false);
    assert.equal(
      events.some(event => event.includes('closed.test')),
      false,
    );
  });

  it('keeps registration and reports individual frame failures', async () => {
    const events: string[] = [];
    const context = new FakeContext(events, [
      new FakePage([
        new FakeFrame('https://ok.test/', events),
        new FakeFrame(
          'https://failed.test/',
          events,
          new Error('frame detached'),
        ),
      ]),
    ]);
    const registry = new PersistentHookRegistry();

    const result = await register(registry, context);

    assert.equal(result.registered, true);
    assert.equal(result.appliedFrames, 1);
    assert.equal(result.partial, true);
    assert.deepEqual(result.failedFrames, [
      {frameUrl: 'https://failed.test/', reason: 'frame detached'},
    ]);
    assert.equal(registry.list(context as unknown as BrowserContext).length, 1);
  });

  it('future-only registers without backfill', async () => {
    const events: string[] = [];
    const context = new FakeContext(events, [
      new FakePage([new FakeFrame('https://one.test/', events)]),
    ]);

    const result = await register(new PersistentHookRegistry(), context, {
      applyMode: 'future-only',
    });

    assert.deepEqual(events, ['context:addInitScript']);
    assert.equal(result.appliedFrames, 0);
  });

  it('does not register or backfill when addInitScript fails', async () => {
    const events: string[] = [];
    const context = new FakeContext(events, [
      new FakePage([new FakeFrame('https://one.test/', events)]),
    ]);
    context.addInitError = new Error('protocol failed');
    const registry = new PersistentHookRegistry();

    await assert.rejects(register(registry, context), /protocol failed/);
    assert.deepEqual(events, ['context:addInitScript']);
    assert.deepEqual(registry.list(context as unknown as BrowserContext), []);
  });

  it('rejects a closed context before browser side effects', async () => {
    const context = new FakeContext([]);
    context.closeForTest();

    await assert.rejects(
      register(new PersistentHookRegistry(), context),
      error =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'CONNECTION',
    );
    assert.deepEqual(context.events, []);
  });

  it('disposes a handle returned after context close and leaves no entry', async () => {
    const context = new FakeContext([]);
    const lateHandle = new FakeDisposable();
    context.addInitDeferred = deferred<Disposable>();
    const registry = new PersistentHookRegistry();
    const pending = register(registry, context);

    context.closeForTest();
    context.addInitDeferred.resolve(lateHandle);

    await assert.rejects(pending, /context.*closed/i);
    assert.equal(lateHandle.disposeCalls, 1);
    assert.deepEqual(registry.list(context as unknown as BrowserContext), []);
  });

  it('is idempotent for the same id and script', async () => {
    const context = new FakeContext([]);
    const registry = new PersistentHookRegistry();

    const first = await register(registry, context);
    const second = await register(registry, context);

    assert.equal(first.registered, true);
    assert.equal(first.idempotent, false);
    assert.equal(second.registered, false);
    assert.equal(second.idempotent, true);
    assert.equal(context.addInitScripts.length, 1);
  });

  it('rejects same id with another script before browser side effects', async () => {
    const context = new FakeContext([]);
    const registry = new PersistentHookRegistry();
    await register(registry, context);

    await assert.rejects(
      register(registry, context, {script: 'different();'}),
      error =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'VALIDATION' &&
        /new hookId|recreate/i.test(error.message),
    );
    assert.equal(context.addInitScripts.length, 1);
  });

  it('allows the same script under different ids', async () => {
    const context = new FakeContext([]);
    const registry = new PersistentHookRegistry();

    await register(registry, context, {hookId: 'one'});
    await register(registry, context, {hookId: 'two'});

    assert.equal(context.addInitScripts.length, 2);
  });

  it('isolates entries by context and clears visible state on close', async () => {
    const firstContext = new FakeContext([]);
    const secondContext = new FakeContext([]);
    const registry = new PersistentHookRegistry();

    await register(registry, firstContext);
    await register(registry, secondContext);
    firstContext.closeForTest();
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(
      registry.list(firstContext as unknown as BrowserContext),
      [],
    );
    assert.equal(
      registry.list(secondContext as unknown as BrowserContext).length,
      1,
    );
    assert.equal(firstContext.handles[0]?.disposeCalls, 1);
  });

  it('returns immutable snapshots without retaining full scripts', async () => {
    const context = new FakeContext([]);
    const registry = new PersistentHookRegistry();
    const script = `${'😀'.repeat(205)}suffix`;

    const result = await register(registry, context, {
      script,
      requestedWorld: 'isolated',
    });
    const entryRecord = result.entry as unknown as Record<string, unknown>;
    const listed = registry.list(context as unknown as BrowserContext);
    const listedRecord = listed[0] as unknown as Record<string, unknown>;
    listed[0]!.hookId = 'mutated';

    assert.equal(entryRecord.script, undefined);
    assert.equal(listedRecord.script, undefined);
    assert.equal(result.entry.scriptSize, Buffer.byteLength(script, 'utf8'));
    assert.equal([...result.entry.scriptPreview].length, 200);
    assert.equal(result.entry.scriptPreview.endsWith('…'), true);
    assert.equal(result.entry.effectiveWorld, 'main');
    assert.match(result.warnings.join(' '), /isolated.*main/i);
    assert.equal(
      registry.list(context as unknown as BrowserContext)[0]?.hookId,
      'hook-1',
    );
  });

  it('creates stable content-addressed preload ids', () => {
    assert.equal(createPreloadHookId('one'), createPreloadHookId('one'));
    assert.notEqual(createPreloadHookId('one'), createPreloadHookId('two'));
    assert.match(createPreloadHookId('one'), /^preload-[a-f0-9]{64}$/);
  });

  it('coalesces concurrent same-script registration', async () => {
    const context = new FakeContext([]);
    context.addInitDeferred = deferred<Disposable>();
    const handle = new FakeDisposable();
    const registry = new PersistentHookRegistry();

    const first = register(registry, context);
    const second = register(registry, context);
    assert.equal(context.addInitScripts.length, 1);
    context.addInitDeferred.resolve(handle);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.deepEqual(secondResult, firstResult);
    assert.equal(context.addInitScripts.length, 1);
  });

  it('rejects a concurrent conflicting script before another side effect', async () => {
    const context = new FakeContext([]);
    context.addInitDeferred = deferred<Disposable>();
    const registry = new PersistentHookRegistry();
    const first = register(registry, context);

    await assert.rejects(
      register(registry, context, {script: 'different();'}),
      error =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'VALIDATION',
    );
    assert.equal(context.addInitScripts.length, 1);
    context.addInitDeferred.resolve(new FakeDisposable());
    await first;
  });

  it('releases failed reservations so a later registration can retry', async () => {
    const context = new FakeContext([]);
    context.addInitError = new Error('first attempt failed');
    const registry = new PersistentHookRegistry();

    await assert.rejects(register(registry, context), /first attempt failed/);
    context.addInitError = undefined;
    const retried = await register(registry, context);

    assert.equal(retried.registered, true);
    assert.equal(context.addInitScripts.length, 2);
  });
});
