/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import fs from 'node:fs';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {
  findActiveDevToolsPort,
  getDevToolsActivePortPaths,
  readDevToolsActivePort,
} from '../../../src/modules/browser/index.js';

describe('browser-discovery DevToolsActivePort probing', () => {
  const originalReadFileSync = fs.readFileSync;

  afterEach(() => {
    fs.readFileSync = originalReadFileSync;
  });

  it('getDevToolsActivePortPaths respects custom userDataDir', () => {
    const customDir = 'C:\\custom\\profile';
    const paths = getDevToolsActivePortPaths(customDir);
    assert.strictEqual(paths.length, 1);
    assert.ok(paths[0].includes('DevToolsActivePort'));
    assert.ok(paths[0].startsWith(customDir));
  });

  it('findActiveDevToolsPort filters by expectedPort and ignores non-matching files', async () => {
    const files: Record<string, string> = {
      'C:\\mock\\Chrome\\DevToolsActivePort':
        '53687\n/devtools/browser/dead-uuid\n',
      'C:\\mock\\Ego\\DevToolsActivePort':
        '9222\n/devtools/browser/live-uuid\n',
    };

    fs.readFileSync = ((filePath: fs.PathOrFileDescriptor) => {
      const p = String(filePath);
      for (const [key, val] of Object.entries(files)) {
        if (p.endsWith('DevToolsActivePort')) {
          if (p.includes('Chrome'))
            return files['C:\\mock\\Chrome\\DevToolsActivePort'];
          if (p.includes('Ego') || p.includes('Citro Labs'))
            return files['C:\\mock\\Ego\\DevToolsActivePort'];
        }
      }
      throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'});
    }) as typeof fs.readFileSync;

    // 不做 TCP 探活时，匹配 expectedPort=9222
    const result = await findActiveDevToolsPort({
      expectedPort: 9222,
      checkLiveness: false,
    });

    assert.ok(result);
    assert.strictEqual(result.port, 9222);
    assert.strictEqual(result.wsPath, '/devtools/browser/live-uuid');
  });

  it('readDevToolsActivePort supports expectedPort filtering', () => {
    fs.readFileSync = ((filePath: fs.PathOrFileDescriptor) => {
      const p = String(filePath);
      if (p.includes('Citro Labs') || p.includes('ego')) {
        return '9222\n/devtools/browser/ego-uuid\n';
      }
      if (p.includes('Google') || p.includes('Chrome')) {
        return '53687\n/devtools/browser/stale-uuid\n';
      }
      throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'});
    }) as typeof fs.readFileSync;

    const matched = readDevToolsActivePort(undefined, 9222);
    assert.ok(matched);
    assert.strictEqual(matched.port, 9222);
    assert.strictEqual(matched.wsPath, '/devtools/browser/ego-uuid');
  });
});
