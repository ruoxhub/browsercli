/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  toMirroredNetworkEntry,
  toMirroredScriptEntry,
  toRecord,
} from '../../../../src/tools/analyzer/normalize.js';

describe('analyzer/normalize 防御性行为', () => {
  describe('toMirroredNetworkEntry', () => {
    it('entry 为 undefined 时返回 undefined，不抛', () => {
      assert.equal(toMirroredNetworkEntry(undefined), undefined);
    });

    it('entry 为 null 时返回 undefined', () => {
      assert.equal(toMirroredNetworkEntry(null), undefined);
    });

    it('entry 为空对象时返回 undefined', () => {
      assert.equal(toMirroredNetworkEntry({}), undefined);
    });

    it('entry.request 非对象时返回 undefined', () => {
      assert.equal(
        toMirroredNetworkEntry({request: 'not-an-object'}),
        undefined,
      );
    });

    it('完整 entry 正常镜像', () => {
      const result = toMirroredNetworkEntry({
        ts: '2026-05-11T00:00:00Z',
        stage: 'hook',
        source: 'fetch',
        request: {url: 'https://example.com/api'},
        response: {status: 200},
        note: 'test',
      });
      assert.ok(result);
      assert.equal(
        (result?.request as Record<string, unknown>).url,
        'https://example.com/api',
      );
      assert.equal(result?.ts, '2026-05-11T00:00:00Z');
      assert.equal(result?.note, 'test');
    });
  });

  describe('toMirroredScriptEntry', () => {
    it('entry 为 undefined 时返回 undefined', () => {
      assert.equal(toMirroredScriptEntry(undefined), undefined);
    });

    it('缺少 scriptUrl 时返回 undefined', () => {
      assert.equal(toMirroredScriptEntry({scriptId: 'x'}), undefined);
    });

    it('有 scriptUrl + scriptId 时正常镜像', () => {
      const result = toMirroredScriptEntry({
        scriptUrl: 'https://cdn.example.com/a.js',
        scriptId: 'abc',
      });
      assert.ok(result);
      assert.equal(result?.url, 'https://cdn.example.com/a.js');
      assert.equal(result?.scriptId, 'abc');
    });
  });

  describe('toRecord', () => {
    it('数组不视为 record', () => {
      assert.equal(toRecord([1, 2]), undefined);
    });

    it('null/undefined 返回 undefined', () => {
      assert.equal(toRecord(null), undefined);
      assert.equal(toRecord(undefined), undefined);
    });

    it('普通对象直接返回', () => {
      const obj = {a: 1};
      assert.equal(toRecord(obj), obj);
    });
  });
});
