/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {clickAt} from '../../../../src/tools/input/clickAt.js';

function makeResponse() {
  let structuredContent: Record<string, unknown> | undefined;
  return {
    response: {
      setStructuredContent: (content: unknown) => {
        structuredContent = content as Record<string, unknown>;
      },
    },
    getContent: () => structuredContent,
  };
}

function makeCdpClient() {
  const calls: Array<{method: string; params?: Record<string, unknown>}> = [];
  return {
    calls,
    client: {
      send: async (method: string, params?: Record<string, unknown>) => {
        calls.push({method, params});
        switch (method) {
          case 'DOM.getContentQuads':
            return {quads: [[0, 0, 100, 0, 100, 50, 0, 50]]};
          case 'Page.getLayoutMetrics':
            return {cssLayoutViewport: {clientWidth: 800, clientHeight: 600}};
          default:
            return {};
        }
      },
      detach: async () => undefined,
    },
  };
}

function makeFrame(client: unknown) {
  return {
    page: () => ({
      context: () => ({newCDPSession: async () => client}),
      evaluate: async () => 1,
    }),
    locator: () => ({
      scrollIntoViewIfNeeded: async () => undefined,
      elementHandle: async () => ({
        _remoteObject: () => ({objectId: 'remote-1'}),
        evaluate: async () => ({x: 0, y: 0, width: 100, height: 50}),
      }),
      evaluate: async () => ({x: 50, y: 25, tag: 'BUTTON', text: '提交'}),
      click: async () => undefined,
    }),
  };
}

describe('click_at', () => {
  it('clicks at the resolved quad center for any locator', async () => {
    const {calls, client} = makeCdpClient();
    const {response, getContent} = makeResponse();

    await clickAt.handler(
      {params: {selector: 'role=button[name="提交"]'}} as never,
      response as never,
      {getSelectedFrame: () => makeFrame(client)} as never,
    );

    const pressed = calls.find(call => call.params?.type === 'mousePressed');
    assert.equal(pressed?.params?.x, 50);
    assert.equal(pressed?.params?.y, 25);
    assert.equal(
      (getContent()?.data as Record<string, unknown>)?.source,
      'contentQuads',
    );
  });
});
