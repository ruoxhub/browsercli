/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {afterEach, describe, it} from 'node:test';

import {SessionManager} from '../../../src/modules/browser/index.js';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface MockWindow {
  location: {href: string};
}

interface PageLike {
  evaluate<TArg, TResult>(
    callback: (arg: TArg) => TResult,
    arg?: TArg,
  ): Promise<TResult>;
  url(): string;
}

interface BrowserContextLike {
  pages(): PageLike[];
  newPage(): Promise<PageLike>;
}

class MemoryStorage implements StorageLike {
  readonly #values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }
}

class MockPage implements PageLike {
  readonly #sessionStorage = new MemoryStorage();
  readonly #localStorage: MemoryStorage;
  readonly #window: MockWindow;

  constructor(url: string, localStorage: MemoryStorage) {
    this.#window = {location: {href: url}};
    this.#localStorage = localStorage;
  }

  async evaluate<TArg, TResult>(
    callback: (arg: TArg) => TResult,
    arg?: TArg,
  ): Promise<TResult> {
    const previousWindow = globalThis.window;
    const previousSessionStorage = globalThis.sessionStorage;
    const previousLocalStorage = globalThis.localStorage;

    Object.assign(globalThis, {
      window: this.#window,
      sessionStorage: this.#sessionStorage,
      localStorage: this.#localStorage,
    });

    try {
      return callback(arg as TArg);
    } finally {
      Object.assign(globalThis, {
        window: previousWindow,
        sessionStorage: previousSessionStorage,
        localStorage: previousLocalStorage,
      });
    }
  }

  url(): string {
    return this.#window.location.href;
  }

  getSessionId(): string | null {
    return this.#sessionStorage.getItem('mcp-session-id');
  }

  getStoredTags(): string | null {
    return this.#localStorage.getItem('mcp-session-tags');
  }
}

describe('SessionManager', () => {
  afterEach(() => {
    SessionManager.cleanupAll();
  });

  it('tags pages and persists session ids per URL', async () => {
    const localStorage = new MemoryStorage();
    const page = new MockPage('https://example.com/app', localStorage);
    const context: BrowserContextLike = {
      pages: () => [page],
      newPage: async () => page,
    };

    const manager = SessionManager.getInstance(
      'session-a',
      context as unknown as never,
    );

    await manager.tagPage(page as unknown as never);

    assert.strictEqual(page.getSessionId(), 'session-a');
    assert.strictEqual(
      page.getStoredTags(),
      JSON.stringify({
        'https://example.com/app': ['session-a'],
      }),
    );
  });

  it('restores session tags from persisted storage after reload', async () => {
    const localStorage = new MemoryStorage();
    localStorage.setItem(
      'mcp-session-tags',
      JSON.stringify({
        'https://example.com/app': ['session-a'],
      }),
    );

    const page = new MockPage('https://example.com/app', localStorage);
    const context: BrowserContextLike = {
      pages: () => [page],
      newPage: async () => page,
    };

    const manager = SessionManager.getInstance(
      'session-a',
      context as unknown as never,
    );

    await manager.restoreSessionTags();

    assert.strictEqual(page.getSessionId(), 'session-a');
    assert.deepStrictEqual(await manager.getOwnedPages(), [
      page as unknown as never,
    ]);
  });

  it('removes persisted session ids when untagging a page', async () => {
    const localStorage = new MemoryStorage();
    const page = new MockPage('https://example.com/app', localStorage);
    const context: BrowserContextLike = {
      pages: () => [page],
      newPage: async () => page,
    };

    const manager = SessionManager.getInstance(
      'session-a',
      context as unknown as never,
    );

    await manager.tagPage(page as unknown as never);
    await manager.untagPage(page as unknown as never);

    assert.strictEqual(page.getSessionId(), null);
    assert.strictEqual(page.getStoredTags(), JSON.stringify({}));
  });
});
