/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';

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
    const context = {getDebuggerContext: async () => makeDebuggerContext(cachePath)};
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
    const context = {getDebuggerContext: async () => makeDebuggerContext(cachePath)};
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
});
