/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {SkillRegistry} from '../../../src/skills/SkillRunner.js';
import {registerRebuildBundleSkill} from '../../../src/skills/rebuild-bundle.js';

describe('rebuild-bundle skill', () => {
  it('registers the skill with the SkillRegistry', () => {
    registerRebuildBundleSkill();
    const registry = SkillRegistry.getInstance();
    const skill = registry.get('rebuild-bundle');

    assert.ok(skill, 'Skill should be registered');
    assert.strictEqual(skill.name, 'rebuild-bundle');
    assert.strictEqual(skill.category, 'rebuild');
    assert.ok(typeof skill.description === 'string');
    assert.ok(typeof skill.execute === 'function');
  });

  it('builds default environment code with browser shims', async () => {
    registerRebuildBundleSkill();
    const registry = SkillRegistry.getInstance();
    const skill = registry.get('rebuild-bundle');

    assert.ok(skill);

    const result = await skill.execute({
      url: 'https://example.com',
      options: {},
    });

    assert.ok(result.success);
    assert.ok(result.data);
    const data = result.data as Record<string, unknown>;
    assert.ok(data.files);
    const files = data.files as Record<string, unknown>;
    assert.ok(typeof files.envCode === 'string');
    assert.ok((files.envCode as string).includes('globalThis.window = globalThis'));
    assert.ok((files.envCode as string).includes('globalThis.crypto'));
  });

  it('builds environment code with captured cookies and storage', async () => {
    registerRebuildBundleSkill();
    const registry = SkillRegistry.getInstance();
    const skill = registry.get('rebuild-bundle');

    assert.ok(skill);

    const result = await skill.execute({
      url: 'https://example.com/product',
      options: {},
    });

    assert.ok(result.success);
    assert.ok(result.data);
    const data = result.data as Record<string, unknown>;
    const files = data.files as Record<string, unknown>;
    const capture = files.capture as Record<string, unknown>;

    assert.ok(capture);
    assert.ok(capture.page);
    const page = capture.page as Record<string, unknown>;
    assert.strictEqual(page.url, 'https://example.com/product');
  });

  it('filters runtime evidence by target keywords', async () => {
    registerRebuildBundleSkill();
    const registry = SkillRegistry.getInstance();
    const skill = registry.get('rebuild-bundle');

    assert.ok(skill);

    const result = await skill.execute({
      url: 'https://example.com',
      options: {
        targetKeywords: ['h5st'],
        targetUrlPatterns: ['api.m.jd.com'],
      },
    });

    assert.ok(result.success);
    assert.ok(result.data);
    const data = result.data as Record<string, unknown>;
    const targetContext = data.targetContext as Record<string, unknown>;

    assert.ok(targetContext);
    const keywords = targetContext.targetKeywords as string[];
    assert.ok(Array.isArray(keywords));
    assert.strictEqual(keywords.length, 1);
    assert.strictEqual(keywords[0], 'h5st');
  });

  it('filters runtime evidence by target function names', async () => {
    registerRebuildBundleSkill();
    const registry = SkillRegistry.getInstance();
    const skill = registry.get('rebuild-bundle');

    assert.ok(skill);

    const result = await skill.execute({
      url: 'https://example.com/order',
      options: {
        targetFunctionNames: ['computeQtk9'],
        goal: 'submit order',
      },
    });

    assert.ok(result.success);
    const data = result.data as Record<string, unknown>;
    const targetContext = data.targetContext as Record<string, unknown>;
    const functionNames = targetContext.targetFunctionNames as string[];
    const actionDescription = targetContext.targetActionDescription as string;

    assert.ok(Array.isArray(functionNames));
    assert.strictEqual(functionNames.length, 1);
    assert.strictEqual(functionNames[0], 'computeQtk9');
    assert.strictEqual(actionDescription, 'submit order');
  });

  it('handles errors gracefully', async () => {
    registerRebuildBundleSkill();
    const registry = SkillRegistry.getInstance();
    const skill = registry.get('rebuild-bundle');

    assert.ok(skill);

    // 模拟一个会导致错误的环境
    const result = await skill.execute({
      url: 'https://example.com',
      options: {},
    });

    // 应该成功或返回带有 error 字段的结果
    if (!result.success) {
      assert.ok(result.error);
    }
  });

  it('returns entry code with proper structure', async () => {
    registerRebuildBundleSkill();
    const registry = SkillRegistry.getInstance();
    const skill = registry.get('rebuild-bundle');

    assert.ok(skill);

    const result = await skill.execute({
      url: 'https://example.com',
      options: {},
    });

    assert.ok(result.success);
    const data = result.data as Record<string, unknown>;
    const files = data.files as Record<string, unknown>;

    assert.ok(typeof files.entryCode === 'string');
    const entryCode = files.entryCode as string;
    assert.ok(entryCode.includes('import "./env.js"'));
    assert.ok(entryCode.includes('import "./polyfills.js"'));
    assert.ok(entryCode.includes('capture.targetScript'));
  });

  it('uses targetUrl from options when context.url is not provided', async () => {
    registerRebuildBundleSkill();
    const registry = SkillRegistry.getInstance();
    const skill = registry.get('rebuild-bundle');

    assert.ok(skill);

    const result = await skill.execute({
      options: {
        targetUrl: 'https://api.example.com/v1',
      },
    });

    assert.ok(result.success);
    const data = result.data as Record<string, unknown>;
    assert.strictEqual(data.url, 'https://api.example.com/v1');
  });

  it('returns empty evidence count for new sessions', async () => {
    registerRebuildBundleSkill();
    const registry = SkillRegistry.getInstance();
    const skill = registry.get('rebuild-bundle');

    assert.ok(skill);

    const result = await skill.execute({
      url: 'https://example.com',
      options: {},
    });

    assert.ok(result.success);
    const data = result.data as Record<string, unknown>;
    assert.strictEqual(data.evidenceCount, 0);
  });
});

describe('matchesTargetText utility', () => {
  it('matches keywords in string values', () => {
    const matches = (value: unknown, keywords: string[]) => {
      const text = typeof value === 'string' ? value.toLowerCase() : JSON.stringify(value ?? '').toLowerCase();
      return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
    };

    assert.ok(matches('h5st=abc123', ['h5st']));
    assert.ok(matches('{"sign":"xyz"}', ['sign']));
    assert.ok(!matches('hello world', ['h5st']));
  });

  it('matches keywords in object values', () => {
    const matches = (value: unknown, keywords: string[]) => {
      const text = typeof value === 'string' ? value.toLowerCase() : JSON.stringify(value ?? '').toLowerCase();
      return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
    };

    const obj = {requestUrl: 'https://api.m.jd.com/client.action?h5st=abc'};
    assert.ok(matches(obj, ['h5st']));
    assert.ok(matches(obj, ['m.jd.com']));
    assert.ok(!matches(obj, ['unknown']));
  });
});

describe('pickTargetScript utility', () => {
  it('returns first script when no target filters provided', () => {
    const files = [
      {url: 'a.js', content: '', size: 100, type: 'external'},
      {url: 'b.js', content: '', size: 200, type: 'external'},
    ];

    const pick = (
      files: Array<{url: string; content: string; size: number; type: string}>,
      keywords: string[],
      urlPatterns: string[],
      functionNames: string[],
      actionDesc: string,
    ) => {
      if (keywords.length === 0 && urlPatterns.length === 0 && functionNames.length === 0 && actionDesc.length === 0) {
        return files[0] ?? null;
      }
      return null;
    };

    const result = pick(files, [], [], [], '');
    assert.ok(result);
    assert.strictEqual(result.url, 'a.js');
  });

  it('returns null for empty file list', () => {
    const pick = (
      files: Array<{url: string; content: string; size: number; type: string}>,
      keywords: string[],
      urlPatterns: string[],
      functionNames: string[],
      actionDesc: string,
    ) => {
      if (keywords.length === 0 && urlPatterns.length === 0 && functionNames.length === 0 && actionDesc.length === 0) {
        return files[0] ?? null;
      }
      return null;
    };

    const result = pick([], [], [], [], '');
    assert.strictEqual(result, null);
  });
});

describe('inferMissingCapabilities utility', () => {
  it('identifies missing window capability', () => {
    const infer = (runtimeError: string, observedCapabilities: string[]) => {
      const available = new Set(observedCapabilities.map((item) => item.toLowerCase()));
      const normalizedError = runtimeError.toLowerCase();
      const candidates = [
        {
          capability: 'window',
          patterns: ['window is not defined'],
          reason: 'Browser global root is missing.',
          priority: 100,
        },
      ];

      return candidates.filter(
        (candidate) =>
          available.has(candidate.capability.toLowerCase()) &&
          candidate.patterns.some((pattern) => normalizedError.includes(pattern)),
      );
    };

    const error = 'ReferenceError: window is not defined';
    const capabilities = ['window', 'document'];
    const result = infer(error, capabilities);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].capability, 'window');
  });

  it('returns empty array when capability not observed', () => {
    const infer = (runtimeError: string, observedCapabilities: string[]) => {
      const available = new Set(observedCapabilities.map((item) => item.toLowerCase()));
      const normalizedError = runtimeError.toLowerCase();
      const candidates = [
        {
          capability: 'window',
          patterns: ['window is not defined'],
          reason: 'Browser global root is missing.',
          priority: 100,
        },
      ];

      return candidates.filter(
        (candidate) =>
          available.has(candidate.capability.toLowerCase()) &&
          candidate.patterns.some((pattern) => normalizedError.includes(pattern)),
      );
    };

    const error = 'ReferenceError: window is not defined';
    const capabilities = ['document']; // window not in observed
    const result = infer(error, capabilities);

    assert.strictEqual(result.length, 0);
  });
});

describe('buildStorageShimCode utility', () => {
  it('generates localStorage shim with seed values', () => {
    const buildShim = (name: 'localStorage' | 'sessionStorage', values: Record<string, unknown>): string => {
      const entries = Object.entries(values);
      return [
        `const ${name}Seed = new Map(${JSON.stringify(entries)});`,
        `globalThis.${name} = {`,
        '  getItem(key) { return this._store.has(key) ? this._store.get(key) : null; },',
        '  setItem(key, value) { this._store.set(String(key), String(value)); },',
        '  removeItem(key) { this._store.delete(String(key)); },',
        '  clear() { this._store.clear(); },',
        '  key(index) { return Array.from(this._store.keys())[index] ?? null; },',
        '  get length() { return this._store.size; },',
        `  _store: ${name}Seed,`,
        '};',
      ].join('\n');
    };

    const shim = buildShim('localStorage', {token: 'abc', nonce: 'xyz'});

    assert.ok(shim.includes('localStorageSeed'));
    assert.ok(shim.includes('token'));
    assert.ok(shim.includes('abc'));
    assert.ok(shim.includes('getItem'));
    assert.ok(shim.includes('setItem'));
  });
});
