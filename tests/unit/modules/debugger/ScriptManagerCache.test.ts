/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {existsSync, mkdirSync, utimesSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {ScriptManager} from '../../../../src/modules/debugger/ScriptManager.js';
import type {CDPSession} from '../../../../src/third_party/index.js';

const SOURCE = 'const token = 1;\nfunction test(){ return token; }\n';
const CACHE_DIR = path.join(os.tmpdir(), 'browsercli-scripts');

/** 极简 CDP session，只回答 Debugger.getScriptSource 并统计调用次数。 */
function createSession(scriptId: string, source: string) {
  const state = {sourceCalls: 0};
  const session = {
    send: async (method: string, params?: {scriptId?: string}) => {
      if (method === 'Debugger.getScriptSource') {
        state.sourceCalls += 1;
        assert.strictEqual(params?.scriptId, scriptId);
        return {scriptSource: source};
      }
      return {};
    },
    on: () => undefined,
    off: () => undefined,
    detach: async () => undefined,
  };
  return {session, state};
}

function createManager(scriptId: string, url: string) {
  const {session, state} = createSession(scriptId, SOURCE);
  const manager = new ScriptManager(() => session as unknown as CDPSession);
  const listeners: Record<string, (params: unknown) => void> = {};
  manager.attachListeners({
    ...session,
    on: (event: string, handler: (params: unknown) => void) => {
      listeners[event] = handler;
    },
    off: (event: string) => {
      delete listeners[event];
    },
  } as unknown as CDPSession);
  listeners['Debugger.scriptParsed']?.({
    scriptId,
    url,
    startLine: 0,
    startColumn: 0,
    endLine: 3,
    endColumn: 0,
    length: SOURCE.length,
    hash: 'test-hash',
  });
  return {manager, state};
}

describe('ScriptManager 磁盘缓存生命周期', () => {
  it('reloads the source when the cached file disappeared', async () => {
    const {manager, state} = createManager(
      '9101',
      'https://example.com/reload-me.js',
    );

    const first = await manager.getScriptSource('9101');
    assert.ok(first?.sourcePath);
    assert.ok(existsSync(first.sourcePath));

    // 模拟缓存文件被过期清理/其他实例删除，内存索引仍指向旧路径。
    const {rmSync} = await import('node:fs');
    rmSync(first.sourcePath, {force: true});

    const second = await manager.getScriptSource('9101');
    assert.ok(second?.sourcePath);
    assert.ok(existsSync(second.sourcePath));
    assert.strictEqual(manager.getScriptContent('9101'), SOURCE);
    assert.strictEqual(state.sourceCalls, 2);
  });

  it('keeps cache files on clear() so other instances stay readable', async () => {
    const {manager} = createManager('9102', 'https://example.com/keep-me.js');
    const loaded = await manager.getScriptSource('9102');
    assert.ok(loaded?.sourcePath);

    manager.clear();

    assert.ok(existsSync(loaded.sourcePath));
    assert.deepStrictEqual(manager.getAllScriptsSync(), []);
  });

  it('purges only cache files older than the stale threshold', () => {
    mkdirSync(CACHE_DIR, {recursive: true});
    const staleFile = path.join(CACHE_DIR, 'stale-unit-test.js');
    const freshFile = path.join(CACHE_DIR, 'fresh-unit-test.js');
    writeFileSync(staleFile, 'stale');
    writeFileSync(freshFile, 'fresh');
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    utimesSync(staleFile, twoDaysAgo, twoDaysAgo);

    // 构造 ScriptManager 会触发缓存清理。
    const {session} = createSession('1', '');
    new ScriptManager(() => session as unknown as CDPSession);

    assert.strictEqual(existsSync(staleFile), false);
    assert.strictEqual(existsSync(freshFile), true);
  });
});
