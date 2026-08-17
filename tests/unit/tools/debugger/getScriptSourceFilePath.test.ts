/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {createHash} from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';

import {ScriptManager} from '../../../../src/modules/debugger/ScriptManager.js';
import type {CDPSession} from '../../../../src/third_party/index.js';
import {getScriptSource} from '../../../../src/tools/debugger/index.js';

interface CapturedResponse {
  lines: string[];
  structured: unknown;
}

function makeResponse(): CapturedResponse & {structured: unknown} {
  const lines: string[] = [];
  let structured: unknown;
  const response = {
    lines,
    get structured() {
      return structured;
    },
    appendResponseLine: (value: string) => {
      lines.push(value);
    },
    setStructuredContent: (content: unknown) => {
      structured = content;
      lines.push(JSON.stringify(content));
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludePages: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludeNetworkRequests: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludeConsoleData: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachImage: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachNetworkRequest: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachConsoleMessage: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludeWebSocketConnections: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachWebSocket: () => {},
  };
  return response as unknown as CapturedResponse & {structured: unknown};
}

const SAMPLE_SOURCE = 'const token = 1;\nfunction test(){ return token; }\n';

/**
 * 模拟 DebuggerManager.getScriptSourcePath：无 filePath 时返回内置缓存路径，
 * 有 filePath 时把源码写入该路径并返回绝对路径（对齐 ScriptManager 的真实行为）。
 */
function makeDebuggerContext(cachePath: string) {
  return {
    getScriptSourcePath: async (scriptId: string, filePath?: string) => {
      if (filePath) {
        const resolved = path.resolve(filePath);
        mkdirSync(path.dirname(resolved), {recursive: true});
        writeFileSync(resolved, SAMPLE_SOURCE, 'utf-8');
        return resolved;
      }
      return cachePath;
    },
    getScriptById: (id: string) => ({
      scriptId: id,
      url: 'https://example.com/app.js',
      sourceLength: SAMPLE_SOURCE.length,
    }),
  };
}

/**
 * 构造真实的生产 ScriptManager 实例，仅 mock CDP session I/O。
 * 用于直接测试真实的落盘持久化路径，确保回归测试能真实捕获任何潜在截断缺陷。
 */
function createProductionScriptManager(
  fixtureSource: string,
  scriptId = '67',
  url = 'https://match.yuanrenxue.com/match/18/67.js',
) {
  const listeners: Record<string, (params: unknown) => void> = {};
  const mockSession = {
    send: async (method: string, params?: {scriptId?: string}) => {
      if (
        method === 'Debugger.getScriptSource' &&
        params?.scriptId === scriptId
      ) {
        return {scriptSource: fixtureSource};
      }
      return {};
    },
    on: (event: string, handler: (params: unknown) => void) => {
      listeners[event] = handler;
    },
    off: (event: string) => {
      delete listeners[event];
    },
  };

  const scriptManager = new ScriptManager(
    () => mockSession as unknown as CDPSession,
  );
  scriptManager.attachListeners(mockSession as unknown as CDPSession);

  if (listeners['Debugger.scriptParsed']) {
    listeners['Debugger.scriptParsed']({
      scriptId,
      url,
      startLine: 0,
      startColumn: 0,
      endLine: 100,
      endColumn: 0,
      length: fixtureSource.length,
      hash: 'test-cdp-hash',
    });
  }

  return scriptManager;
}

describe('get_script_source filePath param', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'gss-test-'));
  });

  after(() => {
    rmSync(tmpDir, {recursive: true, force: true});
  });

  it('returns the built-in cache path when filePath is omitted', async () => {
    const cachePath = path.join(os.tmpdir(), 'browsercli-scripts', 'abc.js');
    const context = {
      getDebuggerContext: async () => makeDebuggerContext(cachePath),
    };
    const response = makeResponse();

    await getScriptSource.handler(
      {params: {scriptId: '1'}} as never,
      response as never,
      context as never,
    );

    const content = response.structured as {
      success: boolean;
      data: {sourcePath: string};
    };
    assert.equal(content.success, true);
    assert.equal(content.data.sourcePath, cachePath);
  });

  it('accepts a numeric scriptId (CLI coerces IDs to number) and normalizes to string', async () => {
    const cachePath = path.join(os.tmpdir(), 'browsercli-scripts', 'num.js');
    const context = {
      getDebuggerContext: async () => makeDebuggerContext(cachePath),
    };
    const response = makeResponse();

    // browsercli 会把纯数字 ID 推断为 number，工具须能接受并归一化为 string。
    await getScriptSource.handler(
      {params: {scriptId: 185205} as never} as never,
      response as never,
      context as never,
    );

    const content = response.structured as {
      success: boolean;
      data: {scriptId: string; sourcePath: string};
    };
    assert.equal(content.success, true);
    assert.equal(content.data.scriptId, '185205');
    assert.equal(content.data.sourcePath, cachePath);
  });

  it('writes source to the provided filePath and returns the absolute path', async () => {
    const target = path.join(tmpDir, 'saved-script.js');
    const context = {
      getDebuggerContext: async () => makeDebuggerContext('/ignored.js'),
    };
    const response = makeResponse();

    await getScriptSource.handler(
      {params: {scriptId: '1', filePath: target}} as never,
      response as never,
      context as never,
    );

    const content = response.structured as {
      success: boolean;
      data: {sourcePath: string};
    };
    assert.equal(content.success, true);
    assert.equal(content.data.sourcePath, path.resolve(target));
    assert.equal(readFileSync(target, 'utf-8'), SAMPLE_SOURCE);
  });

  it('returns an inclusive one-based line range', async () => {
    const target = path.join(tmpDir, 'excerpt.js');
    const context = {
      getDebuggerContext: async () => makeDebuggerContext('/ignored.js'),
    };
    const response = makeResponse();

    await getScriptSource.handler(
      {
        params: {scriptId: '1', filePath: target, startLine: 2, endLine: 2},
      } as never,
      response as never,
      context as never,
    );

    const content = response.structured as {
      success: boolean;
      data: {startLine: number; endLine: number; source: string};
    };
    assert.equal(content.success, true);
    assert.deepStrictEqual(content.data, {
      scriptId: '1',
      url: 'https://example.com/app.js',
      sourceLength: SAMPLE_SOURCE.length,
      sourcePath: path.resolve(target),
      startLine: 2,
      endLine: 2,
      source: 'function test(){ return token; }',
    });
  });

  it('preserves complete match18 67.js fixture with exact byte length and hash', async () => {
    const EXPECTED_FIXTURE_BYTE_LENGTH = 34498;
    const EXPECTED_FIXTURE_SHA256 =
      '57eaf2a680f33ab91ea6299519c676a97cb45b123c552a0e15d7715845461450';

    const fixturePath = path.resolve(
      process.cwd(),
      'tests/fixtures/jsvmp/match18/67.js',
    );
    const fixtureBuffer = readFileSync(fixturePath);
    assert.equal(fixtureBuffer.length, EXPECTED_FIXTURE_BYTE_LENGTH);

    const fixtureSource = fixtureBuffer.toString('utf8');
    assert.equal(
      Buffer.byteLength(fixtureSource, 'utf8'),
      EXPECTED_FIXTURE_BYTE_LENGTH,
    );
    const expectedHash = createHash('sha256')
      .update(fixtureBuffer)
      .digest('hex');
    assert.equal(expectedHash, EXPECTED_FIXTURE_SHA256);

    const outputPath = path.join(tmpDir, 'saved-67.js');
    const scriptManager = createProductionScriptManager(
      fixtureSource,
      '67',
      'https://match.yuanrenxue.com/match/18/67.js',
    );
    const context = {
      getDebuggerContext: async () => scriptManager,
    };
    const response = makeResponse();

    await getScriptSource.handler(
      {params: {scriptId: '67', filePath: outputPath}} as never,
      response as never,
      context as never,
    );

    const content = response.structured as {
      success: boolean;
      data: {
        scriptId: string;
        sourcePath: string;
        sourceLength: number;
        sha256?: string;
      };
    };
    assert.equal(content.success, true);
    assert.equal(content.data.sourcePath, path.resolve(outputPath));
    assert.equal(content.data.scriptId, '67');
    assert.equal(content.data.sourceLength, EXPECTED_FIXTURE_BYTE_LENGTH);

    if ('sha256' in content.data && typeof content.data.sha256 === 'string') {
      assert.equal(content.data.sha256, EXPECTED_FIXTURE_SHA256);
    }

    const savedBuffer = readFileSync(outputPath);
    assert.equal(savedBuffer.length, EXPECTED_FIXTURE_BYTE_LENGTH);
    assert.equal(statSync(outputPath).size, EXPECTED_FIXTURE_BYTE_LENGTH);
    const savedHash = createHash('sha256').update(savedBuffer).digest('hex');
    assert.equal(savedHash, EXPECTED_FIXTURE_SHA256);
  });
});
