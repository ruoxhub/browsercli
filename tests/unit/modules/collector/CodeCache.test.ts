/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {CodeCache} from '../../../../src/modules/collector/CodeCache.js';

describe('CodeCache.searchInCache', () => {
  let cacheDir: string;
  let cache: CodeCache;

  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codecache-test-'));
    cache = new CodeCache({cacheDir});
    await cache.init();
  });

  afterEach(async () => {
    await fs.rm(cacheDir, {recursive: true, force: true});
  });

  async function writeEntry(name: string, content: string): Promise<void> {
    const entry = {
      url: `http://example.com/${name}`,
      files: [
        {
          url: `http://example.com/${name}.js`,
          content,
          size: content.length,
          type: 'script',
        },
      ],
      totalSize: content.length,
      collectTime: Date.now(),
      timestamp: Date.now(),
      hash: name,
    };
    await fs.writeFile(path.join(cacheDir, `${name}.json`), JSON.stringify(entry));
  }

  it('匹配文件内容关键词（走磁盘缓存路径）', async () => {
    await writeEntry('a', 'function signRequest() { return encrypt(payload); }');
    await writeEntry('b', 'console.log("hello world");');

    const results = await cache.searchInCache('signRequest');
    assert.equal(results.length, 1);
    assert.match(results[0].lineContent, /signRequest/);
  });

  it('多文件 / 多行搜索返回所有命中', async () => {
    await writeEntry('a', 'line one\ntoken = generateToken()\nline three');
    await writeEntry('b', 'const token = readToken();\nfoo');

    const results = await cache.searchInCache('token');
    assert.equal(results.length, 2);
  });

  it('大体积单行（模拟混淆 JS）不崩溃且正确返回', async () => {
    const big = 'x'.repeat(5000) + 'SEARCH_ANCHOR_HERE' + 'y'.repeat(5000);
    await writeEntry('huge', big);

    const results = await cache.searchInCache('SEARCH_ANCHOR_HERE');
    assert.equal(results.length, 1);
    assert.ok(results[0].lineContent.includes('SEARCH_ANCHOR_HERE'));
  });

  it('正则模式按 isRegex 处理', async () => {
    await writeEntry('a', 'callCrypto(');
    const results = await cache.searchInCache('call[A-Z]\\w+', {isRegex: true});
    assert.equal(results.length, 1);
  });
});
