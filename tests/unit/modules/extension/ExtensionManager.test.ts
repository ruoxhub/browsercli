/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {ExtensionManager} from '../../../../src/modules/extension/ExtensionManager.js';
import type {Browser, Page} from '../../../../src/third_party/index.js';

describe('ExtensionManager', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'ext-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, {recursive: true, force: true});
  });

  it('installs unpacked extension by reading manifest.json and using CDP if available', async () => {
    const manifestContent = JSON.stringify({
      manifest_version: 3,
      name: 'My Test Extension',
      version: '2.1.0',
    });
    await writeFile(
      path.join(tempDir, 'manifest.json'),
      manifestContent,
      'utf8',
    );

    const cdpCalls: Array<{method: string; params?: unknown}> = [];
    const mockSession = {
      send: async (method: string, params?: unknown) => {
        cdpCalls.push({method, params});
        if (method === 'Extensions.loadUnpacked') {
          return {id: 'chrome-ext-id-1'};
        }
        return {};
      },
      detach: async () => {
        void 0;
      },
    };

    const mockBrowser = {
      newBrowserCDPSession: async () => mockSession,
    } as unknown as Browser;

    const manager = new ExtensionManager({
      getBrowser: () => mockBrowser,
      getSelectedPage: () => null,
    });

    const id = await manager.installExtension(tempDir);
    assert.equal(id, 'chrome-ext-id-1');
    assert.equal(cdpCalls.length, 1);
    assert.equal(cdpCalls[0].method, 'Extensions.loadUnpacked');

    const ext = await manager.getExtension('chrome-ext-id-1');
    assert.ok(ext);
    assert.equal(ext.name, 'My Test Extension');
    assert.equal(ext.version, '2.1.0');
    assert.equal(ext.enabled, true);
    assert.equal(ext.path, path.resolve(tempDir));
  });

  it('uninstalls extension via CDP and local registry', async () => {
    const cdpCalls: Array<{method: string; params?: unknown}> = [];
    const mockSession = {
      send: async (method: string, params?: unknown) => {
        cdpCalls.push({method, params});
        return {};
      },
      detach: async () => {
        void 0;
      },
    };

    const mockBrowser = {
      newBrowserCDPSession: async () => mockSession,
    } as unknown as Browser;

    const manager = new ExtensionManager({
      getBrowser: () => mockBrowser,
      getSelectedPage: () => null,
    });

    await manager.installExtension(tempDir);
    const list = await manager.listExtensions();
    const [installedId] = Array.from(list.keys());
    assert.ok(installedId);

    await manager.uninstallExtension(installedId);
    assert.equal(await manager.getExtension(installedId), undefined);
    assert.ok(cdpCalls.some(c => c.method === 'Extensions.uninstall'));
  });

  it('lists extensions from CDP merged with local registry', async () => {
    const mockSession = {
      send: async (method: string) => {
        if (method === 'Extensions.getExtensions') {
          return {
            extensions: [
              {
                id: 'cdp-ext-1',
                name: 'CDP Extension',
                version: '1.0.0',
                enabled: true,
                path: '/cdp/path',
              },
            ],
          };
        }
        return {};
      },
      detach: async () => {
        void 0;
      },
    };

    const mockBrowser = {
      newBrowserCDPSession: async () => mockSession,
    } as unknown as Browser;

    const manager = new ExtensionManager({
      getBrowser: () => mockBrowser,
      getSelectedPage: () => null,
    });

    const extensions = await manager.listExtensions();
    assert.equal(extensions.size, 1);
    const ext = extensions.get('cdp-ext-1');
    assert.ok(ext);
    assert.equal(ext.name, 'CDP Extension');
  });

  it('triggers extension action on the selected page', async () => {
    const browserCdpCalls: Array<{method: string; params?: unknown}> = [];
    const pageCdpCalls: Array<{method: string; params?: unknown}> = [];

    const mockBrowserSession = {
      send: async (method: string, params?: unknown) => {
        browserCdpCalls.push({method, params});
        return {};
      },
      detach: async () => {
        void 0;
      },
    };

    const mockPageSession = {
      send: async (method: string, params?: unknown) => {
        pageCdpCalls.push({method, params});
        if (method === 'Target.getTargetInfo') {
          return {targetInfo: {targetId: 'target-page-999'}};
        }
        return {};
      },
      detach: async () => {
        void 0;
      },
    };

    const mockBrowser = {
      newBrowserCDPSession: async () => mockBrowserSession,
    } as unknown as Browser;

    const mockPage = {
      context: () => ({
        newCDPSession: async () => mockPageSession,
      }),
    } as unknown as Page;

    const manager = new ExtensionManager({
      getBrowser: () => mockBrowser,
      getSelectedPage: () => mockPage,
    });

    const id = await manager.installExtension(tempDir);
    await manager.triggerExtensionAction(id);

    assert.ok(pageCdpCalls.some(c => c.method === 'Target.getTargetInfo'));
    const triggerCall = browserCdpCalls.find(
      c => c.method === 'Extensions.triggerAction',
    );
    assert.ok(triggerCall);
    assert.deepEqual(triggerCall.params, {
      id,
      targetId: 'target-page-999',
    });
  });

  it('triggerExtensionAction throws when extension is not found', async () => {
    const manager = new ExtensionManager({
      getBrowser: () => null,
      getSelectedPage: () => null,
    });

    await assert.rejects(
      async () => {
        await manager.triggerExtensionAction('non-existent-id');
      },
      {message: 'Extension with ID non-existent-id not found.'},
    );
  });
});
