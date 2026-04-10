/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {strict as assert} from 'node:assert';
import {describe, it} from 'node:test';

import {
  normalizeHookRecord,
  type NormalizedHookRecord,
  summarizeHookRecords,
  inferCandidateEnvNeeds,
  buildRequestBindings,
  toHookRecordArray,
} from '../../../src/tools/hook.js';

describe('hook.ts pure functions', () => {
  describe('normalizeHookRecord', () => {
    it('应该标准化完整的记录', () => {
      const result = normalizeHookRecord({
        target: 'fetch',
        event: 'request',
        method: 'post',
        url: 'https://example.com/api',
        status: 200,
        body: '{"token":"abc123"}',
        timestamp: 1234567890,
      });

      assert.strictEqual(result.target, 'fetch');
      assert.strictEqual(result.event, 'request');
      assert.strictEqual(result.method, 'POST');
      assert.strictEqual(result.url, 'https://example.com/api');
      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.bodySnippet, '{"token":"abc123"}');
      assert.strictEqual(result.timestamp, 1234567890);
    });

    it('应该处理缺失字段（fallback 默认值）', () => {
      const result = normalizeHookRecord({foo: 'bar'});

      assert.strictEqual(result.target, 'unknown');
      assert.strictEqual(result.event, '');
      assert.strictEqual(result.method, '');
      assert.strictEqual(result.url, '');
      assert.strictEqual(result.status, undefined);
      assert.strictEqual(result.bodySnippet, '');
      assert.strictEqual(result.timestamp, undefined);
    });

    it('应该截断超长 bodySnippet 到 200 字符', () => {
      const result = normalizeHookRecord({body: 'x'.repeat(500)});

      assert.strictEqual(result.bodySnippet.length, 200);
      assert.strictEqual(result.bodySnippet, 'x'.repeat(200));
    });

    it('应该支持 requestBody 作为 body 的 fallback', () => {
      const result = normalizeHookRecord({requestBody: '{"data":"test"}'});

      assert.strictEqual(result.bodySnippet, '{"data":"test"}');
    });

    it('应该支持 data 字段作为 body 的 fallback', () => {
      const result = normalizeHookRecord({data: 'payload data'});

      assert.strictEqual(result.bodySnippet, 'payload data');
    });
  });

  describe('summarizeHookRecords', () => {
    it('应该按 key 去重并统计数量', () => {
      const records = [
        {
          target: 'fetch',
          event: 'request',
          method: 'GET',
          url: 'https://api.example.com/users',
          bodySnippet: '',
        },
        {
          target: 'fetch',
          event: 'request',
          method: 'GET',
          url: 'https://api.example.com/users',
          bodySnippet: '',
        },
        {
          target: 'fetch',
          event: 'request',
          method: 'POST',
          url: 'https://api.example.com/login',
          bodySnippet: '{"user":"admin"}',
        },
      ];

      const result = summarizeHookRecords(records, 100);

      assert.strictEqual(result.total, 3);
      assert.strictEqual(result.unique, 2);
      assert.strictEqual(result.dropped, 0);
      assert.strictEqual(result.records.length, 2);
      assert.strictEqual(result.records[0].count, 2);
      assert.strictEqual(result.records[1].count, 1);
    });

    it('应该限制返回记录数量', () => {
      const records = Array.from({length: 50}, (_, i) => ({
        target: 'fetch',
        event: 'request',
        method: 'GET',
        url: `https://api.example.com/endpoint${i}`,
        bodySnippet: '',
      }));

      const result = summarizeHookRecords(records, 10);

      assert.strictEqual(result.records.length, 10);
      assert.strictEqual(result.dropped, 40);
    });

    it('空数组应该返回空结果', () => {
      const result = summarizeHookRecords([], 100);

      assert.strictEqual(result.total, 0);
      assert.strictEqual(result.unique, 0);
      assert.strictEqual(result.records.length, 0);
    });
  });

  describe('inferCandidateEnvNeeds', () => {
    it('应该从 URL 推断需要 location 和 fetch', () => {
      const records = [
        {
          target: 'fetch',
          event: '',
          method: 'GET',
          url: 'https://api.example.com/data',
          bodySnippet: '',
        },
      ];

      const result = inferCandidateEnvNeeds(records);

      assert.deepStrictEqual(result, ['fetch', 'location']);
    });

    it('应该从 body 推断需要 cookie 和 storage', () => {
      const records = [
        {
          target: 'hook',
          event: '',
          method: '',
          url: '',
          bodySnippet: 'token=abc123&cookie=session_id',
        },
      ];

      const result = inferCandidateEnvNeeds(records);

      assert.deepStrictEqual(result, ['cookie', 'storage']);
    });

    it('应该从 body 推断需要 Date', () => {
      const records = [
        {
          target: 'hook',
          event: '',
          method: '',
          url: '',
          bodySnippet: 'nonce=abc&timestamp=1234567890',
        },
      ];

      const result = inferCandidateEnvNeeds(records);

      assert.deepStrictEqual(result, ['Date']);
    });

    it('应该综合推断多种环境需求', () => {
      const records: Array<{
        url: string;
        bodySnippet: string;
        target: string;
        event: string;
        method: string;
      }> = [
        {
          url: 'https://api.example.com/auth',
          bodySnippet: 'token=xyz&nonce=abc',
          target: 'fetch',
          event: 'request',
          method: 'POST',
        },
      ];

      const result = inferCandidateEnvNeeds(records);

      assert.deepStrictEqual(result, [
        'Date',
        'cookie',
        'fetch',
        'location',
        'storage',
      ]);
    });

    it('空记录应该返回空数组', () => {
      const result = inferCandidateEnvNeeds([]);
      assert.deepStrictEqual(result, []);
    });
  });

  describe('buildRequestBindings', () => {
    it('应该过滤有 URL 的记录', () => {
      const records: NormalizedHookRecord[] = [
        {
          target: 'fetch',
          event: 'request',
          method: 'GET',
          url: 'https://api.example.com/1',
          status: 200,
          bodySnippet: '',
        },
        {
          target: 'xhr',
          event: 'send',
          method: 'POST',
          url: '',
          status: undefined,
          bodySnippet: '',
        },
        {
          target: 'fetch',
          event: 'request',
          method: 'PUT',
          url: 'https://api.example.com/2',
          status: 404,
          bodySnippet: '',
        },
      ];

      const result = buildRequestBindings(records);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].url, 'https://api.example.com/1');
      assert.strictEqual(result[0].status, 200);
      assert.strictEqual(result[1].url, 'https://api.example.com/2');
      assert.strictEqual(result[1].status, 404);
    });

    it('空方法应该 fallback 到 UNKNOWN', () => {
      const records: NormalizedHookRecord[] = [
        {
          target: 'fetch',
          event: 'request',
          method: '',
          url: 'https://x.com',
          bodySnippet: '',
        },
      ];

      const result = buildRequestBindings(records);

      assert.strictEqual(result[0].method, 'UNKNOWN');
    });

    it('应该限制最多 10 条记录', () => {
      const records: NormalizedHookRecord[] = Array.from(
        {length: 15},
        (_, i) => ({
          target: 'fetch',
          event: 'request',
          method: 'GET',
          url: `https://api.example.com/${i}`,
          status: 200,
          bodySnippet: '',
        }),
      );

      const result = buildRequestBindings(records);

      assert.strictEqual(result.length, 10);
    });
  });

  describe('toHookRecordArray', () => {
    it('应该过滤非对象元素', () => {
      const data: unknown[] = [
        {id: 1, name: 'valid'},
        null,
        'string',
        42,
        {id: 2, name: 'also valid'},
        undefined,
        false,
      ];

      const result = toHookRecordArray(data);

      assert.strictEqual(result.length, 2);
      assert.deepStrictEqual(result[0], {id: 1, name: 'valid'});
      assert.deepStrictEqual(result[1], {id: 2, name: 'also valid'});
    });

    it('非数组输入应该返回空数组', () => {
      assert.deepStrictEqual(toHookRecordArray(null), []);
      assert.deepStrictEqual(toHookRecordArray('string'), []);
      assert.deepStrictEqual(toHookRecordArray(42), []);
      assert.deepStrictEqual(toHookRecordArray({key: 'value'}), []);
      assert.deepStrictEqual(toHookRecordArray(undefined), []);
    });

    it('空数组应该返回空数组', () => {
      assert.deepStrictEqual(toHookRecordArray([]), []);
    });
  });
});
