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
    it('应返回成功结果并包含完整环境代码', () => {
      const result = buildDefaultEnvCode();
      assert.equal(result.success, true);
      assert.equal(result.tooltype, 'build_default_env');
      assert.equal(typeof result.data.code, 'string');
      assert.ok(result.data.code.includes('globalThis.window = globalThis'));
      assert.ok(result.data.code.includes('globalThis.document'));
      assert.ok(result.data.code.includes('globalThis.navigator'));
      assert.ok(result.data.code.includes('globalThis.location'));
      assert.ok(result.data.code.includes('globalThis.atob'));
      assert.ok(result.data.code.includes('globalThis.btoa'));
      assert.ok(result.data.code.includes('globalThis.crypto'));
    });
  });

  describe('toStorageShimCode', () => {
    it('应生成 localStorage shim 代码', () => {
      const result = toStorageShimCode({
        name: 'localStorage',
        values: {key1: 'value1'},
      });
      assert.equal(result.success, true);
      assert.equal(result.tooltype, 'to_storage_shim');
      assert.equal(result.data.name, 'localStorage');
      assert.ok(result.data.code.includes('localStorageSeed'));
      assert.ok(result.data.code.includes('globalThis.localStorage'));
      assert.ok(result.data.code.includes('getItem'));
      assert.ok(result.data.code.includes('setItem'));
    });

    it('应生成 sessionStorage shim 代码', () => {
      const result = toStorageShimCode({
        name: 'sessionStorage',
        values: {},
      });
      assert.equal(result.success, true);
      assert.ok(result.data.code.includes('sessionStorageSeed'));
      assert.ok(result.data.code.includes('globalThis.sessionStorage'));
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
      const result = buildAutoEnvCode({capture});
      assert.equal(result.success, true);
      assert.equal(result.tooltype, 'build_auto_env');
      assert.ok(result.data.code.includes('globalThis.window'));
      assert.ok(result.data.code.includes('globalThis.localStorage'));
      assert.ok(result.data.code.includes('globalThis.sessionStorage'));
      assert.ok(result.data.code.includes('https://example.com'));
      assert.ok(result.data.code.includes('sid=abc123'));
    });

    it('应处理空 capture', () => {
      const result = buildAutoEnvCode({capture: {}});
      assert.equal(result.success, true);
      assert.ok(result.data.code.includes('globalThis.window'));
    });
  });

  describe('buildAutoEntryCode', () => {
    it('应生成包含 targetScript 的入口代码', () => {
      const result = buildAutoEntryCode({
        targetScript: {url: 'https://example.com/app.js', content: 'var x=1', size: 7, type: 'external'},
        capture: {page: {url: 'https://example.com'}},
      });
      assert.equal(result.success, true);
      assert.equal(result.tooltype, 'build_auto_entry');
      assert.ok(result.data.code.includes('import "./env.js"'));
      assert.ok(result.data.code.includes('import "./polyfills.js"'));
      assert.ok(result.data.code.includes('eval(capture.targetScript.content)'));
    });

    it('应处理无 targetScript 的情况', () => {
      const result = buildAutoEntryCode({
        capture: {page: {url: 'https://example.com'}},
      });
      assert.equal(result.success, true);
      assert.ok(result.data.code.includes('capture.targetScript'));
    });
  });

  describe('appendTargetContextNotes', () => {
    it('应追加目标上下文到 notes', () => {
      const result = appendTargetContextNotes({
        notes: ['existing note'],
        targetKeywords: ['encrypt', 'sign'],
        targetUrlPatterns: ['/api/'],
        targetFunctionNames: ['getToken'],
        targetActionDescription: 'login flow',
      });
      assert.equal(result.success, true);
      assert.equal(result.tooltype, 'append_target_context_notes');
      assert.ok(result.data.notes.includes('existing note'));
      assert.ok(result.data.notes.some(n => n.includes('encrypt, sign')));
      assert.ok(result.data.notes.some(n => n.includes('/api/')));
      assert.ok(result.data.notes.some(n => n.includes('getToken')));
      assert.ok(result.data.notes.some(n => n.includes('login flow')));
    });

    it('应处理空目标', () => {
      const result = appendTargetContextNotes({
        notes: [],
        targetKeywords: [],
        targetUrlPatterns: [],
        targetFunctionNames: [],
        targetActionDescription: '',
      });
      assert.equal(result.success, true);
      assert.equal(result.data.notes.length, 4);
      assert.ok(result.data.notes.every(n => n.includes('(none)')));
    });
  });

  describe('matchesTargetText', () => {
    it('应匹配关键词', () => {
      const result = matchesTargetText({
        value: 'encrypt function called',
        targetKeywords: ['encrypt'],
        targetUrlPatterns: [],
        targetFunctionNames: [],
        targetActionDescription: '',
      });
      assert.equal(result.data.matched, true);
    });

    it('应匹配 URL 模式', () => {
      const result = matchesTargetText({
        value: {url: 'https://api.example.com/sign'},
        targetKeywords: [],
        targetUrlPatterns: ['api.example'],
        targetFunctionNames: [],
        targetActionDescription: '',
      });
      assert.equal(result.data.matched, true);
    });

    it('应匹配函数名', () => {
      const result = matchesTargetText({
        value: 'function getSign() {}',
        targetKeywords: [],
        targetUrlPatterns: [],
        targetFunctionNames: ['getSign'],
        targetActionDescription: '',
      });
      assert.equal(result.data.matched, true);
    });

    it('应不匹配无目标时', () => {
      const result = matchesTargetText({
        value: 'random text',
        targetKeywords: [],
        targetUrlPatterns: [],
        targetFunctionNames: [],
        targetActionDescription: '',
      });
      assert.equal(result.data.matched, false);
    });
  });

  describe('filterRuntimeEvidence', () => {
    const records = [
      {functionName: 'encrypt', url: '/api/encrypt'},
      {functionName: 'decrypt', url: '/api/decrypt'},
      {functionName: 'render', url: '/page/home'},
    ];

    it('应按关键词过滤', () => {
      const result = filterRuntimeEvidence({
        records,
        targetKeywords: ['encrypt'],
        targetUrlPatterns: [],
        targetFunctionNames: [],
        targetActionDescription: '',
        maxEvidenceItems: 10,
      });
      assert.equal(result.success, true);
      assert.equal(result.data.totalBefore, 3);
      assert.ok(result.data.filtered.length >= 1);
    });

    it('应遵守 maxEvidenceItems 限制', () => {
      const result = filterRuntimeEvidence({
        records,
        targetKeywords: [],
        targetUrlPatterns: [],
        targetFunctionNames: [],
        targetActionDescription: '',
        maxEvidenceItems: 2,
      });
      assert.equal(result.data.filtered.length, 2);
    });

    it('无目标时返回全部（受 max 限制）', () => {
      const result = filterRuntimeEvidence({
        records,
        targetKeywords: [],
        targetUrlPatterns: [],
        targetFunctionNames: [],
        targetActionDescription: '',
        maxEvidenceItems: 100,
      });
      assert.equal(result.data.filtered.length, 3);
    });
  });

  describe('pickTargetScript', () => {
    const files = [
      {url: 'https://example.com/app.js', content: 'var a=1', size: 7, type: 'external' as const},
      {url: 'https://example.com/crypto.js', content: 'var b=2', size: 7, type: 'external' as const},
    ];

    it('无目标时选择第一个', () => {
      const result = pickTargetScript({
        files,
        targetKeywords: [],
        targetUrlPatterns: [],
        targetFunctionNames: [],
        targetActionDescription: '',
      });
      assert.equal(result.success, true);
      assert.equal(result.data.index, 0);
      assert.equal(result.data.script?.url, 'https://example.com/app.js');
    });

    it('应匹配 URL 模式', () => {
      const result = pickTargetScript({
        files,
        targetKeywords: [],
        targetUrlPatterns: ['crypto'],
        targetFunctionNames: [],
        targetActionDescription: '',
      });
      assert.equal(result.data.index, 1);
      assert.equal(result.data.script?.url, 'https://example.com/crypto.js');
    });

    it('应处理空文件列表', () => {
      const result = pickTargetScript({
        files: [],
        targetKeywords: [],
        targetUrlPatterns: [],
        targetFunctionNames: [],
        targetActionDescription: '',
      });
      assert.equal(result.data.script, null);
      assert.equal(result.data.index, -1);
    });
  });

  describe('inferMissingCapabilities', () => {
    it('应从 window 错误推断缺失能力', () => {
      const result = inferMissingCapabilities({
        runtimeError: 'ReferenceError: window is not defined',
        observedCapabilities: ['window', 'document'],
      });
      assert.equal(result.success, true);
      assert.equal(result.tooltype, 'infer_missing_capabilities');
      assert.ok(result.data.missing.length > 0);
      assert.equal(result.data.missing[0].capability, 'window');
    });

    it('应从多个错误推断多个缺失能力', () => {
      const result = inferMissingCapabilities({
        runtimeError: 'window is not defined and document is not defined',
        observedCapabilities: ['window', 'document', 'localStorage'],
      });
      assert.ok(result.data.missing.length >= 2);
    });

    it('不应推断未观测到的能力', () => {
      const result = inferMissingCapabilities({
        runtimeError: 'window is not defined',
        observedCapabilities: ['document'],
      });
      assert.equal(result.data.missing.length, 0);
    });

    it('应处理不匹配的错误', () => {
      const result = inferMissingCapabilities({
        runtimeError: 'TypeError: x is not a function',
        observedCapabilities: ['window'],
      });
      assert.equal(result.data.missing.length, 0);
    });
  });

  describe('writeArtifactFile', () => {
    it('应写入文件并返回成功', async () => {
      const tmpDir = await mkdtemp(path.join(tmpdir(), 'rebuild-test-'));
      try {
        const result = await writeArtifactFile({
          taskDir: tmpDir,
          relativePath: 'env/test.js',
          content: 'console.log("hello")',
        });
        assert.equal(result.success, true);
        assert.equal(result.tooltype, 'write_artifact_file');
        assert.ok(result.data!.filePath.includes('env/test.js'));

        const content = await readFile(result.data!.filePath, 'utf8');
        assert.equal(content, 'console.log("hello")');
      } finally {
        await rm(tmpDir, {recursive: true});
      }
    });

    it('应处理写入错误', async () => {
      const result = await writeArtifactFile({
        taskDir: '/nonexistent/path/that/should/fail',
        relativePath: 'test.js',
        content: 'test',
      });
      assert.equal(result.success, false);
    });
  });
});
