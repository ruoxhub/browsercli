/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {strict as assert} from 'node:assert';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {
  buildDefaultEnvCode,
  toStorageShimCode,
  buildAutoEnvCode,
  buildAutoEntryCode,
  appendTargetContextNotes,
  matchesTargetText,
  filterRuntimeEvidence,
  pickTargetScript,
  inferMissingCapabilities,
  writeArtifactFile,
} from '../../../src/tools/rebuild/index.js';

describe('rebuild functions', () => {
  describe('buildDefaultEnvCode', () => {
    it('应返回包含完整环境代码的字符串', () => {
      const code = buildDefaultEnvCode();
      assert.equal(typeof code, 'string');
      assert.ok(code.includes('globalThis.window = globalThis'));
      assert.ok(code.includes('globalThis.document'));
      assert.ok(code.includes('globalThis.navigator'));
      assert.ok(code.includes('globalThis.location'));
      assert.ok(code.includes('globalThis.atob'));
      assert.ok(code.includes('globalThis.btoa'));
      assert.ok(code.includes('globalThis.crypto'));
    });
  });

  describe('toStorageShimCode', () => {
    it('应生成 localStorage shim 代码', () => {
      const code = toStorageShimCode('localStorage', {key1: 'value1'});
      assert.ok(code.includes('localStorageSeed'));
      assert.ok(code.includes('globalThis.localStorage'));
      assert.ok(code.includes('getItem'));
      assert.ok(code.includes('setItem'));
    });

    it('应生成 sessionStorage shim 代码', () => {
      const code = toStorageShimCode('sessionStorage', {});
      assert.ok(code.includes('sessionStorageSeed'));
      assert.ok(code.includes('globalThis.sessionStorage'));
    });
  });

  describe('buildAutoEnvCode', () => {
    it('应整合所有环境代码', () => {
      const capture = {
        cookies: [{name: 'sid', value: 'abc123'}],
        localStorage: {token: 'xyz'},
        sessionStorage: {},
        page: {url: 'https://example.com'},
      };
      const code = buildAutoEnvCode(capture);
      assert.ok(code.includes('globalThis.window'));
      assert.ok(code.includes('globalThis.localStorage'));
      assert.ok(code.includes('globalThis.sessionStorage'));
      assert.ok(code.includes('https://example.com'));
      assert.ok(code.includes('sid=abc123'));
    });

    it('应处理空 capture', () => {
      const code = buildAutoEnvCode({});
      assert.ok(code.includes('globalThis.window'));
    });
  });

  describe('buildAutoEntryCode', () => {
    it('应生成包含 targetScript 的入口代码', () => {
      const code = buildAutoEntryCode(
        {
          url: 'https://example.com/app.js',
          content: 'var x=1',
          size: 7,
          type: 'external',
        },
        {page: {url: 'https://example.com'}},
      );
      assert.ok(code.includes('import "./env.js"'));
      assert.ok(code.includes('import "./polyfills.js"'));
      assert.ok(code.includes('eval(capture.targetScript.content)'));
    });

    it('应处理无 targetScript 的情况', () => {
      const code = buildAutoEntryCode(undefined, {
        page: {url: 'https://example.com'},
      });
      assert.ok(code.includes('capture.targetScript'));
    });
  });

  describe('appendTargetContextNotes', () => {
    it('应追加目标上下文到 notes', () => {
      const notes = appendTargetContextNotes(['existing note'], {
        targetKeywords: ['encrypt', 'sign'],
        targetUrlPatterns: ['/api/'],
        targetFunctionNames: ['getToken'],
        targetActionDescription: 'login flow',
      });
      assert.ok(notes.includes('existing note'));
      assert.ok(notes.some(n => n.includes('encrypt, sign')));
      assert.ok(notes.some(n => n.includes('/api/')));
      assert.ok(notes.some(n => n.includes('getToken')));
      assert.ok(notes.some(n => n.includes('login flow')));
    });

    it('应处理空目标', () => {
      const notes = appendTargetContextNotes([], {
        targetKeywords: [],
        targetUrlPatterns: [],
        targetFunctionNames: [],
        targetActionDescription: '',
      });
      assert.equal(notes.length, 4);
      assert.ok(notes.every(n => n.includes('(none)')));
    });
  });

  describe('matchesTargetText', () => {
    it('应匹配关键词', () => {
      assert.equal(
        matchesTargetText('encrypt function called', ['encrypt'], [], [], ''),
        true,
      );
    });

    it('应匹配 URL 模式', () => {
      assert.equal(
        matchesTargetText(
          {url: 'https://api.example.com/sign'},
          [],
          ['api.example'],
          [],
          '',
        ),
        true,
      );
    });

    it('应匹配函数名', () => {
      assert.equal(
        matchesTargetText('function getSign() {}', [], [], ['getSign'], ''),
        true,
      );
    });

    it('应不匹配无目标时', () => {
      assert.equal(matchesTargetText('random text', [], [], [], ''), false);
    });
  });

  describe('filterRuntimeEvidence', () => {
    const records = [
      {functionName: 'encrypt', url: '/api/encrypt'},
      {functionName: 'decrypt', url: '/api/decrypt'},
      {functionName: 'render', url: '/page/home'},
    ];

    it('应按关键词过滤', () => {
      const filtered = filterRuntimeEvidence(
        records,
        ['encrypt'],
        [],
        [],
        '',
        10,
      );
      assert.ok(filtered.length >= 1);
    });

    it('应遵守 maxEvidenceItems 限制', () => {
      const filtered = filterRuntimeEvidence(records, [], [], [], '', 2);
      assert.equal(filtered.length, 2);
    });

    it('无目标时返回全部（受 max 限制）', () => {
      const filtered = filterRuntimeEvidence(records, [], [], [], '', 100);
      assert.equal(filtered.length, 3);
    });
  });

  describe('pickTargetScript', () => {
    const files = [
      {
        url: 'https://example.com/app.js',
        content: 'var a=1',
        size: 7,
        type: 'external' as const,
      },
      {
        url: 'https://example.com/crypto.js',
        content: 'var b=2',
        size: 7,
        type: 'external' as const,
      },
    ];

    it('无目标时选择第一个', () => {
      const script = pickTargetScript(files, [], [], [], '');
      assert.equal(script?.url, 'https://example.com/app.js');
    });

    it('应匹配 URL 模式', () => {
      const script = pickTargetScript(files, [], ['crypto'], [], '');
      assert.equal(script?.url, 'https://example.com/crypto.js');
    });

    it('应处理空文件列表', () => {
      const script = pickTargetScript([], [], [], [], '');
      assert.equal(script, undefined);
    });
  });

  describe('inferMissingCapabilities', () => {
    it('应从 window 错误推断缺失能力', () => {
      const missing = inferMissingCapabilities(
        'ReferenceError: window is not defined',
        ['window', 'document'],
      );
      assert.ok(missing.length > 0);
      assert.equal(missing[0].capability, 'window');
    });

    it('应从多个错误推断多个缺失能力', () => {
      const missing = inferMissingCapabilities(
        'window is not defined and document is not defined',
        ['window', 'document', 'localStorage'],
      );
      assert.ok(missing.length >= 2);
    });

    it('不应推断未观测到的能力', () => {
      const missing = inferMissingCapabilities('window is not defined', [
        'document',
      ]);
      assert.equal(missing.length, 0);
    });

    it('应处理不匹配的错误', () => {
      const missing = inferMissingCapabilities(
        'TypeError: x is not a function',
        ['window'],
      );
      assert.equal(missing.length, 0);
    });
  });

  describe('writeArtifactFile', () => {
    it('应写入文件', async () => {
      const tmpDir = await mkdtemp(path.join(tmpdir(), 'rebuild-test-'));
      try {
        await writeArtifactFile(tmpDir, 'env/test.js', 'console.log("hello")');
        const content = await readFile(
          path.join(tmpDir, 'env', 'test.js'),
          'utf8',
        );
        assert.equal(content, 'console.log("hello")');
      } finally {
        await rm(tmpDir, {recursive: true});
      }
    });
  });
});
