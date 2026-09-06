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

import {searchInSources} from '../../../../src/tools/debugger/index.js';

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

const SAMPLE_SOURCE = 'const w_rid = 1;\n';

/**
 * 模拟 DebuggerManager：searchInScripts 返回两个脚本的匹配，
 * getScriptSourcePath 在传入 filePath 时把源码写入该路径并返回绝对路径。
 */
function makeDebuggerContext() {
  return {
    searchInScripts: async () => ({
      matches: [
        {scriptId: '197383', url: 'https://a.example.com/app.js', lineNumber: 31, lineContent: 'const w_rid = 1;'},
        {scriptId: '197543', url: 'https://b.example.com/crypto.js', lineNumber: 24, lineContent: 'const w_rid = 1;'},
      ],
    }),
    getScriptSourcePath: async (scriptId: string, filePath?: string) => {
      if (filePath) {
        const resolved = path.resolve(filePath);
        mkdirSync(path.dirname(resolved), {recursive: true});
        writeFileSync(resolved, SAMPLE_SOURCE, 'utf-8');
        return resolved;
      }
      return path.join(os.tmpdir(), 'proxycli-scripts', `${scriptId}.js`);
    },
  };
}

describe('search_in_sources filePath param', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'sis-test-'));
  });

  after(() => {
    rmSync(tmpDir, {recursive: true, force: true});
  });

  it('returns the built-in cache path when filePath is omitted', async () => {
    const context = {getDebuggerContext: async () => makeDebuggerContext()};
    const response = makeResponse();

    await searchInSources.handler(
      {params: {query: 'w_rid'}} as never,
      response as never,
      context as never,
    );

    const content = response.structured as {
      success: boolean;
      data: {matches: Array<{scriptId: string; sourcePath: string}>};
    };
    assert.equal(content.success, true);
    for (const m of content.data.matches) {
      assert.equal(m.sourcePath, path.join(os.tmpdir(), 'proxycli-scripts', `${m.scriptId}.js`));
    }
  });

  it('writes each matched script into the provided directory and returns absolute paths', async () => {
    const context = {getDebuggerContext: async () => makeDebuggerContext()};
    const response = makeResponse();

    await searchInSources.handler(
      {params: {query: 'w_rid', filePath: tmpDir}} as never,
      response as never,
      context as never,
    );

    const content = response.structured as {
      success: boolean;
      data: {matches: Array<{scriptId: string; sourcePath: string}>};
    };
    assert.equal(content.success, true);
    const seen = new Set<string>();
    for (const m of content.data.matches) {
      const expected = path.join(tmpDir, `${m.scriptId}.js`);
      assert.equal(m.sourcePath, expected);
      assert.equal(readFileSync(expected, 'utf-8'), SAMPLE_SOURCE);
      seen.add(m.scriptId);
    }
    // 两个不同脚本应分别落盘
    assert.equal(seen.size, 2);
  });
});
