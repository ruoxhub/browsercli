/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {SmartCodeCollector} from '../../src/modules/collector/SmartCodeCollector.js';
import {HookManager} from '../../src/modules/hook/HookManager.js';

const runE2E = process.env.RUN_E2E_TESTS === 'true';

describe('E2E Scenarios', {skip: !runE2E}, () => {
  it('Scenario 1: code collection and analysis flow', async () => {
    const collector = new SmartCodeCollector();
    const files = [
      {
        url: 'https://x/app.js',
        content: 'const sign=md5(a);',
        size: 18,
        type: 'external',
      },
    ] as any;
    const summaries = await collector.smartCollect({} as any, files, {
      mode: 'summary',
    } as any);
    assert.ok(Array.isArray(summaries));
  });

  it('Scenario 2: hook inject preparation flow', async () => {
    const manager = new HookManager();
    const hook = manager.create({type: 'fetch'} as any);
    assert.ok(hook.script.includes('fetch'));
  });
});
