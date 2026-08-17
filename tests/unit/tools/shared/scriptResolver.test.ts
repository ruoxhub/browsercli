/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {describe, it} from 'node:test';

import type {ScriptInfo} from '../../../../src/modules/debugger/ScriptManager.js';
import {
  resolveScript,
  type ScriptResolverContext,
} from '../../../../src/tools/shared/scriptResolver.js';
import {ErrorCodes, ToolError} from '../../../../src/utils/errors.js';

const SRC_A = 'console.log("a");';
const SRC_B = 'const b = 42;';

function sha256(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

interface ScriptSpec {
  scriptId: string;
  url: string;
  source: string;
  /** CDP 内部 hash，用于验证 resolver 不会误用为 contentHash。 */
  hash?: string;
}

function makeContext(
  scripts: ScriptSpec[],
  resolvePage?: ScriptResolverContext['resolvePage'],
): ScriptResolverContext {
  const infos: ScriptInfo[] = scripts.map(s => ({
    scriptId: s.scriptId,
    url: s.url,
    startLine: 0,
    startColumn: 0,
    endLine: 0,
    endColumn: 0,
    sourceLength: s.source.length,
    hash: s.hash,
  }));
  const sourceById = new Map(scripts.map(s => [s.scriptId, s.source]));
  const context: ScriptResolverContext = {
    getScripts: () => infos,
    getScriptSource: async scriptId => {
      const source = sourceById.get(scriptId);
      if (source === undefined) {
        throw new Error(`script source not found: ${scriptId}`);
      }
      return source;
    },
  };
  if (resolvePage) {
    context.resolvePage = resolvePage;
  }
  return context;
}

function expectToolError(
  error: unknown,
  code: (typeof ErrorCodes)[keyof typeof ErrorCodes],
): asserts error is ToolError {
  assert.ok(error instanceof ToolError, `expected ToolError, got ${error}`);
  assert.equal(error.code, code);
}

describe('ScriptResolver', () => {
  it('有效 scriptId 直接命中，matchedBy=scriptId', async () => {
    const context = makeContext([
      {scriptId: '1', url: 'https://example.com/a.js', source: SRC_A},
    ]);

    const result = await resolveScript(context, {scriptId: '1'});

    assert.equal(result.scriptId, '1');
    assert.equal(result.url, 'https://example.com/a.js');
    assert.equal(result.source, SRC_A);
    assert.equal(result.sourceLength, SRC_A.length);
    assert.equal(result.sha256, sha256(SRC_A));
    assert.equal(result.matchedBy, 'scriptId');
    assert.equal(result.staleScriptIdRecovered, undefined);
  });

  it('旧 scriptId + locator(url) 重定位到新 ID', async () => {
    const context = makeContext([
      {scriptId: '9', url: 'https://example.com/a.js', source: SRC_A},
    ]);

    const result = await resolveScript(context, {
      scriptId: 'stale-1',
      locator: {url: 'https://example.com/a.js'},
    });

    assert.equal(result.scriptId, '9');
    assert.equal(result.matchedBy, 'url');
    assert.equal(result.staleScriptIdRecovered, true);
    assert.equal(result.sha256, sha256(SRC_A));
  });

  it('旧 scriptId + locator(url + sourceLength) 重定位', async () => {
    const context = makeContext([
      {scriptId: '9', url: 'https://example.com/dup.js', source: SRC_A},
      {scriptId: '10', url: 'https://example.com/dup.js', source: SRC_B},
    ]);

    const result = await resolveScript(context, {
      scriptId: 'stale-1',
      locator: {url: 'https://example.com/dup.js', sourceLength: SRC_A.length},
    });

    assert.equal(result.scriptId, '9');
    assert.equal(result.staleScriptIdRecovered, true);
  });

  it('旧 scriptId + locator(contentHash) 重定位', async () => {
    const context = makeContext([
      {scriptId: '9', url: 'https://example.com/dup.js', source: SRC_A},
      {scriptId: '10', url: 'https://example.com/dup.js', source: SRC_B},
    ]);

    const result = await resolveScript(context, {
      scriptId: 'stale-1',
      locator: {contentHash: sha256(SRC_A)},
    });

    assert.equal(result.scriptId, '9');
    assert.equal(result.matchedBy, 'hash');
    assert.equal(result.staleScriptIdRecovered, true);
  });

  it('唯一 URL 命中（无 scriptId），matchedBy=url', async () => {
    const context = makeContext([
      {scriptId: '1', url: 'https://example.com/a.js', source: SRC_A},
      {scriptId: '2', url: 'https://example.com/b.js', source: SRC_B},
    ]);

    const result = await resolveScript(context, {
      locator: {url: 'https://example.com/a.js'},
    });

    assert.equal(result.scriptId, '1');
    assert.equal(result.matchedBy, 'url');
    assert.equal(result.staleScriptIdRecovered, undefined);
  });

  it('同 URL 相同内容（reload 后 stale+new）contentHash 折叠为唯一候选', async () => {
    const url = 'https://example.com/reload.js';
    const context = makeContext([
      {scriptId: 'stale-9', url, source: SRC_A},
      {scriptId: 'fresh-10', url, source: SRC_A},
    ]);

    const result = await resolveScript(context, {
      locator: {url, contentHash: sha256(SRC_A)},
    });

    assert.equal(result.scriptId, 'fresh-10');
    assert.equal(result.matchedBy, 'hash');
    assert.equal(result.sha256, sha256(SRC_A));
    assert.equal(result.staleScriptIdRecovered, undefined);
  });

  it('不同 URL 命中同一 contentHash 仍抛 SCRIPT_LOCATOR_AMBIGUOUS', async () => {
    const context = makeContext([
      {scriptId: '1', url: 'https://example.com/a.js', source: SRC_A},
      {scriptId: '2', url: 'https://example.com/b.js', source: SRC_A},
    ]);

    await assert.rejects(
      resolveScript(context, {locator: {contentHash: sha256(SRC_A)}}),
      error => {
        expectToolError(error, ErrorCodes.SCRIPT_LOCATOR_AMBIGUOUS);
        assert.match(error.message, /\[1, 2\]/);
        return true;
      },
    );
  });

  it('contentHash 对源码现算 SHA-256，不误用 CDP 内部 hash', async () => {
    const context = makeContext([
      {
        scriptId: '9',
        url: 'https://example.com/a.js',
        source: SRC_A,
        hash: 'cdp-internal-hash-123',
      },
    ]);

    const result = await resolveScript(context, {
      locator: {contentHash: sha256(SRC_A)},
    });

    assert.equal(result.scriptId, '9');
    assert.equal(result.matchedBy, 'hash');
    assert.equal(result.sha256, sha256(SRC_A));
    assert.notEqual(result.sha256, 'cdp-internal-hash-123');
  });

  it('sourceLength 使用 UTF-8 字节长度而非字符数', async () => {
    const source = '你好🙂';
    const context = makeContext([
      {scriptId: '1', url: 'https://example.com/unicode.js', source},
    ]);

    const result = await resolveScript(context, {scriptId: '1'});

    assert.equal(result.sourceLength, Buffer.byteLength(source, 'utf8'));
    assert.notEqual(result.sourceLength, source.length);
  });

  it('sourceLength 字节长度往返回填为 locator 仍能命中', async () => {
    const source = '你好🙂';
    const url = 'https://example.com/unicode.js';
    const context = makeContext([{scriptId: '1', url, source}]);

    const first = await resolveScript(context, {scriptId: '1'});
    assert.equal(first.sourceLength, Buffer.byteLength(source, 'utf8'));
    assert.notEqual(first.sourceLength, source.length);

    const second = await resolveScript(context, {
      locator: {url, sourceLength: first.sourceLength},
    });
    assert.equal(second.scriptId, '1');
    assert.equal(second.matchedBy, 'url');
  });

  it('无候选抛 SCRIPT_NOT_FOUND', async () => {
    const context = makeContext([
      {scriptId: '1', url: 'https://example.com/a.js', source: SRC_A},
    ]);

    await assert.rejects(
      resolveScript(context, {locator: {url: 'https://example.com/nope.js'}}),
      error => {
        expectToolError(error, ErrorCodes.SCRIPT_NOT_FOUND);
        return true;
      },
    );
  });

  it('多候选抛 SCRIPT_LOCATOR_AMBIGUOUS 并列出候选 ID', async () => {
    const context = makeContext([
      {scriptId: '1', url: 'https://example.com/dup.js', source: SRC_A},
      {scriptId: '2', url: 'https://example.com/dup.js', source: SRC_B},
    ]);

    await assert.rejects(
      resolveScript(context, {locator: {url: 'https://example.com/dup.js'}}),
      error => {
        expectToolError(error, ErrorCodes.SCRIPT_LOCATOR_AMBIGUOUS);
        assert.match(error.message, /\[1, 2\]/);
        return true;
      },
    );
  });

  it('locator 指向已关闭 pageId 抛 PAGE_NOT_FOUND', async () => {
    const context = makeContext(
      [{scriptId: '1', url: 'https://example.com/a.js', source: SRC_A}],
      () => {
        throw new Error('页面 page-2 已关闭');
      },
    );

    await assert.rejects(
      resolveScript(context, {
        locator: {pageId: 'page-2', url: 'https://example.com/a.js'},
      }),
      error => {
        expectToolError(error, ErrorCodes.PAGE_NOT_FOUND);
        return true;
      },
    );
  });

  it('旧 scriptId 无 locator 抛 SCRIPT_ID_STALE', async () => {
    const context = makeContext([
      {scriptId: '1', url: 'https://example.com/a.js', source: SRC_A},
    ]);

    await assert.rejects(
      resolveScript(context, {scriptId: 'stale-1'}),
      error => {
        expectToolError(error, ErrorCodes.SCRIPT_ID_STALE);
        return true;
      },
    );
  });

  it('既无 scriptId 也无 locator 抛 VALIDATION', async () => {
    const context = makeContext([]);

    await assert.rejects(resolveScript(context, {}), error => {
      expectToolError(error, ErrorCodes.VALIDATION);
      return true;
    });
  });
});
