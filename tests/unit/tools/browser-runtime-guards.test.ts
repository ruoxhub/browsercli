/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {listPages} from '../../../src/tools/navigation/listPages.js';
import {checkBrowserHealth as toolCheckBrowserHealth} from '../../../src/tools/page/checkBrowserHealth.js';
import {saveSessionState as toolSaveSessionState} from '../../../src/tools/page/sessionState.js';
import {takeScreenshot as toolTakeScreenshot} from '../../../src/tools/screenshot/takeScreenshot.js';

async function checkBrowserHealth(runtime: any, params?: any) {
  const request = { params: params || {} };
  const response = {
    structuredContent: null as any,
    setStructuredContent(content: any) {
      this.structuredContent = content;
    }
  };
  await toolCheckBrowserHealth.handler(request as any, response as any, runtime as any);
  return response.structuredContent;
}

async function saveSessionState(runtime: any, params?: any) {
  const request = { params: params || {} };
  const response = {
    structuredContent: null as any,
    setStructuredContent(content: any) {
      this.structuredContent = content;
    }
  };
  await toolSaveSessionState.handler(request as any, response as any, runtime as any);
  return response.structuredContent;
}

async function takeScreenshot(runtime: any, params?: any) {
  const request = { params: params || {} };
  const response = {
    structuredContent: null as any,
    setStructuredContent(content: any) {
      this.structuredContent = content;
    }
  };
  await toolTakeScreenshot.handler(request as any, response as any, runtime as any);
  return response.structuredContent;
}

function createResponse() {
  const lines: string[] = [];
  return {
    lines,
    response: {
      lines,
      appendResponseLine(value: string) {
        lines.push(value);
      },
      setIncludePages() {},
      setIncludeNetworkRequests() {},
      setIncludeConsoleData() {},
      attachImage() {},
      attachNetworkRequest() {},
      attachConsoleMessage() {},
      setIncludeWebSocketConnections() {},
      attachWebSocket() {},
      setStructuredContent(content: any) {}
    } as any,
  };
}

describe('browser runtime guards', () => {
  it('maps fetch failed into a diagnosable browser-health issue', async () => {
    const result = await checkBrowserHealth(
      {
        getActivePage: async () => {
          throw new Error('fetch failed');
        },
        isBrowserConnected: () => true,
        isCollectorRunning: async () => true,
      },
      {},
    );

    assert.equal(result.success, false);
    assert.equal(result.data?.healthy, false);
    assert.match(result.message, /发现 2 个问题/);
    assert.match(
      result.data?.issues[0]?.message ?? '',
      /浏览器连接失败.*fetch failed/,
    );
    assert.equal(result.data?.issues[1]?.code, 'PAGE_UNRESPONSIVE');
  });

  it('degrades list_pages when one title probe is unavailable', async () => {
    const runtime = {
      getPages: () => [
        {
          url: () => 'https://bad.example',
          title: async () => {
            throw new Error('fetch failed');
          },
        },
        {
          url: () => 'https://ok.example',
          title: async () => 'OK',
        },
      ],
      getPageByIdx: (idx: number) => {
        throw new Error(`unused: ${idx}`);
      },
      getSelectedPage: () =>
        ({
          url: () => 'https://ok.example',
          title: async () => 'OK',
        }) as never,
      newPage: async () => {
        throw new Error('unused');
      },
      selectPage: () => undefined,
      bringPageToFront: async () => undefined,
      syncPageContext: () => undefined,
    } as never;

    const {response, lines} = createResponse();

    await listPages.handler({params: {}}, response, runtime);

    const output = lines.join('\n');
    assert.match(output, /1 个页面标题不可用|unavailable/);
    assert.match(output, /\[unavailable\]/);
    assert.match(output, /OK/);
  });

  it('normalizes fetch-failed errors for save_session_state and take_screenshot', async () => {
    const runtime = {
      getActivePage: async () => {
        throw new Error('fetch failed');
      },
    };

    const saved = await saveSessionState(
      {
        ...runtime,
        isBrowserConnected: () => true,
        isCollectorRunning: async () => true,
      },
      {},
    );
    const screenshot = await takeScreenshot(runtime, {});

    assert.equal(saved.success, false);
    assert.match(saved.message, /浏览器连接失败.*fetch failed/);
    assert.equal(screenshot.success, false);
    assert.match(screenshot.message, /浏览器连接失败.*fetch failed/);
  });
});
