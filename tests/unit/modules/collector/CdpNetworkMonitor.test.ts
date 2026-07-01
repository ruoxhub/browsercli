/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {CdpNetworkMonitor} from '../../../../src/modules/collector/CdpNetworkMonitor.js';
import {CollectedFileRegistry} from '../../../../src/modules/collector/CollectedFileRegistry.js';

/**
 * Mock CDPSession for testing. Records calls to send/on/off/detach.
 */
function makeMockCdpSession() {
  const listeners: Record<string, Array<(params: unknown) => void>> = {};
  const sent: Array<{method: string; params?: unknown}> = [];
  return {
    sent,
    async send(method: string, params?: unknown): Promise<unknown> {
      sent.push({method, params});
      if (method === 'Network.getResponseBody') {
        return {body: 'var x = 1;', base64Encoded: false};
      }
      return undefined;
    },
    on(event: string, handler: (params: unknown) => void): void {
      (listeners[event] ??= []).push(handler);
    },
    off(event: string, handler: (params: unknown) => void): void {
      const arr = listeners[event];
      if (arr) {
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      }
    },
    async detach(): Promise<void> {},
    emit(event: string, params: unknown): void {
      (listeners[event] ?? []).forEach(h => h(params));
    },
  };
}

/**
 * Mock Page whose context().newCDPSession() returns a mock session.
 */
function makeMockPage(cdpSession: ReturnType<typeof makeMockCdpSession>) {
  return {
    context: () => ({
      newCDPSession: async () => cdpSession,
    }),
  } as unknown as Parameters<CdpNetworkMonitor['attach']>[0];
}

describe('CdpNetworkMonitor', () => {
  describe('attach / detach lifecycle', () => {
    it('attach enables Network + Runtime domains', async () => {
      const cdp = makeMockCdpSession();
      const monitor = new CdpNetworkMonitor();
      const registry = new CollectedFileRegistry();
      const page = makeMockPage(cdp);

      await monitor.attach(page, [], registry);

      assert.strictEqual(monitor.isActive(), true);
      assert.strictEqual(monitor.getSession() !== null, true);
      const methods = cdp.sent.map(s => s.method);
      assert.strictEqual(methods.includes('Network.enable'), true);
      assert.strictEqual(methods.includes('Runtime.enable'), true);

      await monitor.detach();
      assert.strictEqual(monitor.isActive(), false);
      assert.strictEqual(monitor.getSession(), null);
    });

    it('detach is safe to call when not attached', async () => {
      const monitor = new CdpNetworkMonitor();
      await monitor.detach(); // should not throw
      assert.strictEqual(monitor.isActive(), false);
    });

    it('detach removes the responseReceived listener', async () => {
      const cdp = makeMockCdpSession();
      const monitor = new CdpNetworkMonitor();
      const registry = new CollectedFileRegistry();
      const page = makeMockPage(cdp);

      await monitor.attach(page, [], registry);
      await monitor.detach();

      // Emitting after detach should not crash — listener should be removed
      cdp.emit('Network.responseReceived', {
        response: {url: 'x'},
        requestId: '1',
        type: 'Script',
      });
      // If we reach here, the test passes (no crash, no files added)
      assert.strictEqual(registry.getStats().cacheSize, 0);
    });
  });

  describe('network response capture', () => {
    it('captures Script-type responses and adds to files + registry', async () => {
      const cdp = makeMockCdpSession();
      const monitor = new CdpNetworkMonitor();
      const registry = new CollectedFileRegistry();
      const files: unknown[] = [];
      const page = makeMockPage(cdp);

      await monitor.attach(page, files as never[], registry);

      cdp.emit('Network.responseReceived', {
        response: {
          url: 'https://example.com/app.js',
          mimeType: 'text/javascript',
        },
        requestId: 'req-1',
        type: 'Script',
      });

      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 50));

      assert.strictEqual(files.length, 1);
      assert.strictEqual(registry.hasUrl('https://example.com/app.js'), true);
      assert.strictEqual(
        registry.getFile('https://example.com/app.js')?.type,
        'external',
      );

      await monitor.detach();
    });

    it('skips non-Script responses', async () => {
      const cdp = makeMockCdpSession();
      const monitor = new CdpNetworkMonitor();
      const registry = new CollectedFileRegistry();
      const files: unknown[] = [];
      const page = makeMockPage(cdp);

      await monitor.attach(page, files as never[], registry);

      cdp.emit('Network.responseReceived', {
        response: {url: 'https://example.com/style.css', mimeType: 'text/css'},
        requestId: 'req-2',
        type: 'Stylesheet',
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      assert.strictEqual(files.length, 0);
      await monitor.detach();
    });

    it('deduplicates URLs (does not re-capture same URL)', async () => {
      const cdp = makeMockCdpSession();
      const monitor = new CdpNetworkMonitor();
      const registry = new CollectedFileRegistry();
      const files: unknown[] = [];
      const page = makeMockPage(cdp);

      await monitor.attach(page, files as never[], registry);

      const params = {
        response: {
          url: 'https://example.com/dup.js',
          mimeType: 'text/javascript',
        },
        requestId: 'req-3',
        type: 'Script',
      };
      cdp.emit('Network.responseReceived', params);
      await new Promise(resolve => setTimeout(resolve, 50));
      cdp.emit('Network.responseReceived', params);
      await new Promise(resolve => setTimeout(resolve, 50));

      assert.strictEqual(files.length, 1);
      await monitor.detach();
    });
  });

  describe('reset', () => {
    it('clears session reference without detach', () => {
      const monitor = new CdpNetworkMonitor();
      // Simulate browser disconnect: reset without detach
      monitor.reset();
      assert.strictEqual(monitor.isActive(), false);
      assert.strictEqual(monitor.getSession(), null);
    });
  });
});
