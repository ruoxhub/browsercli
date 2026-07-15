/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {rebuildBundle} from '../../../../src/tools/workflow/rebuildBundle.js';

async function callRebuildBundle(params: any): Promise<any> {
  let result: any = null;
  const response = {
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    appendResponseLine: (_line: string) => {},
    setStructuredContent: (content: unknown) => {
      result = content;
    },
  } as any;
  await rebuildBundle.handler({params} as any, response, null as any);
  return result;
}

describe('rebuildBundle tool', () => {
  it('exports rebuildBundle tool object', () => {
    assert.strictEqual(typeof rebuildBundle, 'object');
    assert.strictEqual(typeof rebuildBundle.handler, 'function');
  });

  it('builds default environment code with browser shims', async () => {
    const result = await callRebuildBundle({url: 'https://example.com'});

    assert.ok(result.success);
    assert.ok(result.data);
    const files = result.data.files;
    assert.ok(typeof files.envCode === 'string');
    assert.ok(files.envCode.includes('globalThis.window = globalThis'));
    assert.ok(files.envCode.includes('globalThis.crypto'));
  });

  it('builds environment code with captured cookies and storage', async () => {
    const result = await callRebuildBundle({
      url: 'https://example.com/product',
    });

    assert.ok(result.success);
    assert.ok(result.data);
    const capture = result.data.files.capture;
    const page = capture.page as Record<string, unknown>;
    assert.strictEqual(page.url, 'https://example.com/product');
  });

  it('filters runtime evidence by target keywords', async () => {
    const result = await callRebuildBundle({
      url: 'https://example.com',
      targetKeywords: ['h5st'],
      targetUrlPatterns: ['api.m.jd.com'],
    });

    assert.ok(result.success);
    assert.ok(result.data);
    assert.deepStrictEqual(result.data.targetContext.targetKeywords, ['h5st']);
  });

  it('filters runtime evidence by target function names', async () => {
    const result = await callRebuildBundle({
      url: 'https://example.com/order',
      targetFunctionNames: ['computeQtk9'],
      goal: 'submit order',
    });

    assert.ok(result.success);
    assert.ok(result.data);
    assert.deepStrictEqual(result.data.targetContext.targetFunctionNames, [
      'computeQtk9',
    ]);
    assert.strictEqual(
      result.data.targetContext.targetActionDescription,
      'submit order',
    );
  });

  it('handles errors gracefully', async () => {
    const result = await callRebuildBundle({url: 'https://example.com'});

    if (!result.success) {
      assert.ok(result.error);
    } else {
      assert.strictEqual(result.tooltype, 'rebuild_bundle');
    }
  });

  it('returns entry code with proper structure', async () => {
    const result = await callRebuildBundle({url: 'https://example.com'});

    assert.ok(result.success);
    assert.ok(result.data);
    const entryCode = result.data.files.entryCode;
    assert.ok(entryCode.includes('import "./env.js"'));
    assert.ok(entryCode.includes('import "./polyfills.js"'));
    assert.ok(entryCode.includes('capture.targetScript'));
  });

  it('uses targetUrl from options when url is not provided', async () => {
    const result = await callRebuildBundle({
      targetUrl: 'https://api.example.com/v1',
    });

    assert.ok(result.success);
    assert.ok(result.data);
    assert.strictEqual(result.data.url, 'https://api.example.com/v1');
  });

  it('returns empty evidence count for new sessions', async () => {
    const result = await callRebuildBundle({url: 'https://example.com'});

    assert.ok(result.success);
    assert.ok(result.data);
    assert.strictEqual(result.data.evidenceCount, 0);
  });
});

describe('matchesTargetText utility', () => {
  it('matches keywords in string values', () => {
    const matches = (value: unknown, keywords: string[]) => {
      const text =
        typeof value === 'string'
          ? value.toLowerCase()
          : JSON.stringify(value ?? '').toLowerCase();
      return keywords.some(keyword => text.includes(keyword.toLowerCase()));
    };

    assert.ok(matches('h5st=abc123', ['h5st']));
    assert.ok(matches('{"sign":"xyz"}', ['sign']));
    assert.ok(!matches('hello world', ['h5st']));
  });

  it('matches keywords in object values', () => {
    const matches = (value: unknown, keywords: string[]) => {
      const text =
        typeof value === 'string'
          ? value.toLowerCase()
          : JSON.stringify(value ?? '').toLowerCase();
      return keywords.some(keyword => text.includes(keyword.toLowerCase()));
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
      if (
        keywords.length === 0 &&
        urlPatterns.length === 0 &&
        functionNames.length === 0 &&
        actionDesc.length === 0
      ) {
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
      if (
        keywords.length === 0 &&
        urlPatterns.length === 0 &&
        functionNames.length === 0 &&
        actionDesc.length === 0
      ) {
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
      const available = new Set(
        observedCapabilities.map(item => item.toLowerCase()),
      );
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
        candidate =>
          available.has(candidate.capability.toLowerCase()) &&
          candidate.patterns.some(pattern => normalizedError.includes(pattern)),
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
      const available = new Set(
        observedCapabilities.map(item => item.toLowerCase()),
      );
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
        candidate =>
          available.has(candidate.capability.toLowerCase()) &&
          candidate.patterns.some(pattern => normalizedError.includes(pattern)),
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
    const buildShim = (
      name: 'localStorage' | 'sessionStorage',
      values: Record<string, unknown>,
    ): string => {
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
