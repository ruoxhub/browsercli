/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {BreakpointManager} from '../../../../src/modules/debugger/BreakpointManager.js';
import {DebuggerSessionStore} from '../../../../src/modules/debugger/DebuggerSessionStore.js';

describe('DebuggerSessionStore', () => {
  it('exportSession serializes breakpoints and pauseOnExceptions state', async () => {
    const sendCalls: Array<{method: string; params?: unknown}> = [];
    const session = {
      async send(method: string, params?: unknown) {
        sendCalls.push({method, params});
        return {breakpointId: 'bp-1', locations: []};
      },
    } as any;
    const bpm = new BreakpointManager(() => session);
    await bpm.setBreakpointByUrl({url: 'https://x.com', lineNumber: 5});
    await bpm.setPauseOnExceptions('all');

    const store = new DebuggerSessionStore(
      () => bpm,
      () => '/unused',
      () => true,
    );

    const session1 = store.exportSession({source: 'test'});
    assert.strictEqual(session1.version, '1.1');
    assert.strictEqual(session1.breakpoints.length, 1);
    assert.strictEqual(session1.breakpoints[0].location.url, 'https://x.com');
    assert.strictEqual(session1.pauseOnExceptions, 'all');
    assert.deepStrictEqual(session1.metadata, {source: 'test'});
  });

  it('importSession throws when debugger is not enabled', async () => {
    const bpm = new BreakpointManager(() => ({}) as any);
    const store = new DebuggerSessionStore(
      () => bpm,
      () => '/unused',
      () => false,
    );

    await assert.rejects(
      () =>
        store.importSession({
          version: '1.0',
          timestamp: Date.now(),
          breakpoints: [],
          pauseOnExceptions: 'none',
          metadata: {},
        }),
      /Debugger must be enabled before importing session/,
    );
  });

  it('importSession restores URL breakpoints via BreakpointManager', async () => {
    const sendCalls: Array<{method: string; params?: unknown}> = [];
    const session = {
      async send(method: string, params?: unknown) {
        sendCalls.push({method, params});
        if (method === 'Debugger.setBreakpointByUrl') {
          return {breakpointId: `bp-${sendCalls.length}`, locations: []};
        }
        if (method === 'Debugger.removeBreakpoint') return {};
        if (method === 'Debugger.setPauseOnExceptions') return {};
        return {};
      },
    } as any;
    const bpm = new BreakpointManager(() => session);

    const store = new DebuggerSessionStore(
      () => bpm,
      () => '/unused',
      () => true,
    );

    await store.importSession({
      version: '1.0',
      timestamp: Date.now(),
      breakpoints: [
        {
          location: {url: 'https://a.com', lineNumber: 1},
          enabled: true,
        },
        {
          location: {url: 'https://b.com', lineNumber: 2},
          enabled: true,
        },
      ],
      pauseOnExceptions: 'uncaught',
      metadata: {},
    });

    const setBpCalls = sendCalls.filter(
      c => c.method === 'Debugger.setBreakpointByUrl',
    );
    assert.strictEqual(setBpCalls.length, 2);
    assert.strictEqual(bpm.listBreakpoints().length, 2);
    assert.strictEqual(bpm.getPauseOnExceptionsState(), 'uncaught');
  });

  it('listSavedSessions returns empty array when directory does not exist', async () => {
    const bpm = new BreakpointManager(() => ({}) as any);
    const store = new DebuggerSessionStore(
      () => bpm,
      () => '/definitely/does/not/exist/12345',
      () => true,
    );

    const sessions = await store.listSavedSessions();
    assert.deepStrictEqual(sessions, []);
  });

  it('saveSession writes to a file and the path matches the default dir', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'dbg-session-'));
    try {
      const session = {
        async send(method: string) {
          if (method === 'Debugger.setBreakpointByUrl') {
            return {breakpointId: 'bp-1', locations: []};
          }
          return {};
        },
      } as any;
      const bpm = new BreakpointManager(() => session);
      await bpm.setBreakpointByUrl({url: 'https://x.com', lineNumber: 1});

      const store = new DebuggerSessionStore(
        () => bpm,
        () => tmpDir,
        () => true,
      );

      const savedPath = await store.saveSession(undefined, {source: 'test'});
      assert.ok(savedPath.startsWith(tmpDir));
      assert.ok(savedPath.endsWith('.json'));

      const sessions = await store.listSavedSessions();
      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0].path, savedPath);
      assert.ok(sessions[0].timestamp > 0);
    } finally {
      await rm(tmpDir, {recursive: true, force: true});
    }
  });
});
