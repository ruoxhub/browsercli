/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {BrowserContext, Response} from 'patchright';

import {DatabaseManager} from '../../../../src/database/DatabaseManager.js';
import {CaptureEngine} from '../../../../src/modules/session/CaptureEngine.js';
import {CaptureSessionManager} from '../../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../../src/modules/session/SqliteSessionStore.js';
import {SessionCaptureBridge} from '../../../../src/worker/context/SessionCaptureBridge.js';

function makeEngine(): {engine: CaptureEngine; manager: CaptureSessionManager} {
  const db = new DatabaseManager(':memory:');
  const store = new SqliteSessionStore(db);
  const manager = new CaptureSessionManager(store);
  return {engine: new CaptureEngine(manager, store), manager};
}

function makeContext(): {
  context: BrowserContext;
  emit: (response: Response) => void;
  listenerCount: () => number;
} {
  const listeners = new Set<(response: Response) => void>();
  const context = {
    on: (event: string, handler: (response: Response) => void) => {
      if (event === 'response') listeners.add(handler);
      return context;
    },
    off: (event: string, handler: (response: Response) => void) => {
      if (event === 'response') listeners.delete(handler);
      return context;
    },
  } as unknown as BrowserContext;
  return {
    context,
    emit: response => {
      for (const listener of [...listeners]) listener(response);
    },
    listenerCount: () => listeners.size,
  };
}

function makeResponse(
  overrides: Partial<{url: string; body: string}> = {},
): Response {
  const headers = {'content-type': 'application/json'};
  const request = {
    method: () => 'GET',
    url: () => overrides.url ?? 'https://a.dev/api/sign',
    headers: () => ({cookie: 'x=1'}),
    postData: () => null,
  };
  return {
    status: () => 200,
    headers: () => headers,
    request: () => request,
    url: () => overrides.url ?? 'https://a.dev/api/sign',
    text: async () => overrides.body ?? '{"ok":true}',
  } as unknown as Response;
}

/** 监听回调内部是 async 摄入；等一个宏任务即可落到库里。 */
const flush = (): Promise<void> =>
  new Promise(resolve => setImmediate(resolve));

describe('SessionCaptureBridge', () => {
  it('ingests a CDP response into the engine', async () => {
    const {engine, manager} = makeEngine();
    const {context, emit} = makeContext();
    const bridge = new SessionCaptureBridge(() => engine);

    bridge.attach(context);
    emit(makeResponse());
    await flush();

    const session = manager.getActiveSession();
    assert.ok(session, '首次摄入应自动建默认会话（spec §6）');
    const rows = manager.getRequests(session.id);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]!.source, 'cdp');
    assert.strictEqual(rows[0]!.responseBody, '{"ok":true}');
    assert.strictEqual(rows[0]!.url, 'https://a.dev/api/sign');
  });

  it('is idempotent for repeated attach on the same context', async () => {
    const {engine, manager} = makeEngine();
    const {context, emit, listenerCount} = makeContext();
    const bridge = new SessionCaptureBridge(() => engine);

    bridge.attach(context);
    bridge.attach(context);
    bridge.attach(context);
    assert.strictEqual(
      listenerCount(),
      1,
      'init() 与 setContext() 都会调 start()',
    );

    emit(makeResponse());
    await flush();

    const session = manager.getActiveSession()!;
    assert.strictEqual(manager.getRequests(session.id).length, 1);
  });

  it('does nothing when no engine is available', async () => {
    const {context, emit} = makeContext();
    const bridge = new SessionCaptureBridge(() => undefined);

    assert.doesNotThrow(() => bridge.attach(context));
    emit(makeResponse());
    await flush();
    assert.strictEqual(bridge.getDroppedCount(), 0);
  });

  it('stops ingesting after detach', async () => {
    const {engine, manager} = makeEngine();
    const {context, emit, listenerCount} = makeContext();
    const bridge = new SessionCaptureBridge(() => engine);

    bridge.attach(context);
    bridge.detach();
    assert.strictEqual(listenerCount(), 0);
    emit(makeResponse());
    await flush();

    assert.strictEqual(
      manager.getActiveSession(),
      null,
      'detach 后不应再产生会话/行',
    );
  });

  it('never lets an ingest failure escape into the Playwright callback', async () => {
    const {context, emit} = makeContext();
    const bridge = new SessionCaptureBridge(
      () =>
        ({
          ingestRequest: () => {
            throw new Error('boom');
          },
        }) as unknown as CaptureEngine,
    );

    bridge.attach(context);
    // emit 同步返回：异常若逃出回调，Playwright 会把它当监听器错误抛出
    emit(makeResponse());
    await flush();

    assert.strictEqual(
      bridge.getDroppedCount(),
      1,
      'spec §4 / R3：生产者回调绝不抛',
    );
  });

  it('counts a drop when the engine accessor itself throws', async () => {
    const {context, emit} = makeContext();
    // getEngine() 首次调用会下钻到 RuntimeServices.getCaptureEngine()
    // → ensureSessionStore() → new DatabaseManager(...)：SQLite 打开失败
    // （权限/磁盘满/锁）就从这里抛。异常若发生在 try 之外，
    // dropped 计不到、还会以 unhandled rejection 逃出 void this.ingest()。
    const bridge = new SessionCaptureBridge(() => {
      throw new Error('db open failed');
    });

    bridge.attach(context);
    emit(makeResponse());
    await flush();

    assert.strictEqual(
      bridge.getDroppedCount(),
      1,
      'engine 获取失败与落库失败必须同口径计数（spec §4 / R3）',
    );
  });

  it('skips the body when CDP body capture is disabled', async () => {
    const {engine, manager} = makeEngine();
    const {context, emit} = makeContext();
    const bridge = new SessionCaptureBridge(() => engine, {captureBody: false});

    bridge.attach(context);
    emit(makeResponse());
    await flush();

    const session = manager.getActiveSession()!;
    const rows = manager.getRequests(session.id);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]!.responseBody, null);
    assert.strictEqual(
      rows[0]!.contentType,
      'application/json',
      '关掉取体不该影响 contentType',
    );
  });
});
