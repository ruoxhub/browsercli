/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import test, {describe} from 'node:test';

import {ExtensionSessionManager} from '../../../../src/modules/extension/host/ExtensionSessionManager.js';
import {
  extensionClaimTab,
  extensionExecuteCdp,
  extensionListTabs,
  extensionStatus,
} from '../../../../src/tools/extensions/extensionTools.js';

class MockResponse {
  public content: any = null;
  setStructuredContent(content: any) {
    this.content = content;
  }
}

describe('Tools - extensionTools', () => {
  test('extension_status should report status when disconnected', async () => {
    ExtensionSessionManager.resetInstance();
    const res = new MockResponse();

    await extensionStatus.handler({params: {}} as any, res as any, {} as any);

    assert.ok(res.content);
    assert.strictEqual(res.content.success, true);
    assert.strictEqual(res.content.data.connected, false);
    assert.deepStrictEqual(res.content.data.claimedTabs, []);
  });

  test('extension_list_tabs should throw when browser extension is not connected', async () => {
    ExtensionSessionManager.resetInstance();
    const res = new MockResponse();

    await assert.rejects(async () => {
      await extensionListTabs.handler(
        {params: {}} as any,
        res as any,
        {} as any,
      );
    }, /浏览器扩展尚未连接/);
  });

  test('extension_claim_tab should throw when browser extension is not connected', async () => {
    ExtensionSessionManager.resetInstance();
    const res = new MockResponse();

    await assert.rejects(async () => {
      await extensionClaimTab.handler(
        {params: {tabId: 1}} as any,
        res as any,
        {} as any,
      );
    }, /浏览器扩展尚未连接/);
  });

  test('extension_execute_cdp should throw when browser extension is not connected', async () => {
    ExtensionSessionManager.resetInstance();
    const res = new MockResponse();

    await assert.rejects(async () => {
      await extensionExecuteCdp.handler(
        {params: {tabId: 1, method: 'Runtime.evaluate'}} as any,
        res as any,
        {} as any,
      );
    }, /浏览器扩展尚未连接/);
  });
});
