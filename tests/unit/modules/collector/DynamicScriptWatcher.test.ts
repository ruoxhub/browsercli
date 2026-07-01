/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DynamicScriptWatcher} from '../../../../src/modules/collector/DynamicScriptWatcher.js';

describe('DynamicScriptWatcher', () => {
  describe('waitForStability', () => {
    it('returns immediately when waitMs <= 0', async () => {
      const watcher = new DynamicScriptWatcher();
      const page = {} as Parameters<
        DynamicScriptWatcher['waitForStability']
      >[0];
      const start = Date.now();
      await watcher.waitForStability(page, 0);
      await watcher.waitForStability(page, -1);
      const elapsed = Date.now() - start;
      // Should complete in well under 100ms
      assert.ok(elapsed < 100, `elapsed ${elapsed}ms should be < 100ms`);
    });

    it('falls back to time-based wait when waitForNetworkIdle is unavailable', async () => {
      const watcher = new DynamicScriptWatcher();
      // Page without waitForNetworkIdle method
      const page = {} as Parameters<
        DynamicScriptWatcher['waitForStability']
      >[0];
      const start = Date.now();
      await watcher.waitForStability(page, 100);
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 90, `elapsed ${elapsed}ms should be >= ~100ms`);
    });

    it('uses waitForNetworkIdle when available', async () => {
      const watcher = new DynamicScriptWatcher();
      let idleCalled = false;
      const idleOptions: {idleTime?: number; timeout?: number} = {};
      const page = {
        waitForNetworkIdle: async (options?: {
          idleTime?: number;
          timeout?: number;
        }) => {
          idleCalled = true;
          if (options) Object.assign(idleOptions, options);
        },
      } as unknown as Parameters<DynamicScriptWatcher['waitForStability']>[0];

      await watcher.waitForStability(page, 900);
      assert.strictEqual(idleCalled, true);
      // idleTime should be derived from waitMs: min(1000, max(300, 900/3=300)) = 300
      assert.strictEqual(idleOptions.idleTime, 300);
      assert.strictEqual(idleOptions.timeout, 900);
    });

    it('falls back to time wait when waitForNetworkIdle throws', async () => {
      const watcher = new DynamicScriptWatcher();
      const page = {
        waitForNetworkIdle: async () => {
          throw new Error('timeout');
        },
      } as unknown as Parameters<DynamicScriptWatcher['waitForStability']>[0];

      const start = Date.now();
      await watcher.waitForStability(page, 100);
      const elapsed = Date.now() - start;
      // Should have fallen back to 100ms time-based wait
      assert.ok(
        elapsed >= 90,
        `elapsed ${elapsed}ms should be >= ~100ms after fallback`,
      );
    });
  });
});
