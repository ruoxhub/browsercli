/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {injectHook} from '../../../../src/tools/hook/InjectHook.js';

describe('inject_hook world compatibility', () => {
  it('reports isolated requests as effective main world', async () => {
    let content: any;
    const context = {
      getBrowserContext: () => ({isClosed: () => false}),
      getPersistentHookRegistry: () => ({
        register: async (request: any) => ({
          entry: {
            requestedWorld: request.requestedWorld,
            effectiveWorld: 'main',
            applyMode: request.applyMode,
          },
          registered: false,
          idempotent: true,
          appliedFrames: 0,
          failedFrames: [],
          partial: false,
          warnings: ['isolated is unavailable; using main'],
        }),
      }),
    } as any;
    await injectHook.handler(
      {
        params: {
          hookId: 'isolated',
          script: 'hook();',
          persistent: true,
          world: 'isolated',
        },
      },
      {setStructuredContent: (value: unknown) => (content = value)} as any,
      context,
    );

    assert.equal(content.success, true);
    assert.equal(content.data.world, 'isolated');
    assert.equal(content.data.requestedWorld, 'isolated');
    assert.equal(content.data.effectiveWorld, 'main');
    assert.equal(content.data.idempotent, true);
    assert.match(content.data.warnings.join(' '), /main/);
  });
});
