/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {navigatePage} from '../../../../src/tools/navigation/navigatePage.js';
import type {ToolContextProvider} from '../../../../src/worker/ToolContextProvider.js';

interface MockCDPSession {
  send(method: string, params: unknown): Promise<void>;
}

interface TestPage {
  goto(url: string, options?: unknown): Promise<void>;
  goBack(options?: unknown): Promise<void>;
  goForward(options?: unknown): Promise<void>;
  reload(options?: unknown): Promise<void>;
  context(): {newCDPSession(page: TestPage): Promise<MockCDPSession>};
  url(): string;
}

function createPage(overrides: Partial<TestPage> = {}): TestPage {
  return {
    goto: async () => undefined,
    goBack: async () => undefined,
    goForward: async () => undefined,
    reload: async () => undefined,
    context: () => ({
      newCDPSession: async () => ({
        send: async () => undefined,
      }),
    }),
    url: () => 'https://example.test',
    ...overrides,
  };
}

function createRuntime(
  overrides: Record<string, unknown> = {},
): ToolContextProvider {
  return overrides as unknown as ToolContextProvider;
}

function createResponse() {
  const lines: string[] = [];
  return {
    lines,
    response: {
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
    },
  };
}

describe('navigatePage (defineTool)', () => {
  it('returns actionable message when no active page is selected', async () => {
    const runtime = createRuntime({
      getSelectedPage: () => null,
      getPages: () => [],
      getSelectedPageIndex: () => null,
    });

    const {response, lines} = createResponse();

    await navigatePage.handler(
      {params: {type: 'reload'}},
      response,
      runtime,
    );

    const output = lines.join('\n');
    assert.match(output, /new_page|select_page|无活跃页面/);
  });

  it('maps closed-page errors to actionable diagnostics', async () => {
    const page = createPage({
      reload: async () => {
        throw new Error('Target page closed');
      },
    });

    const runtime = createRuntime({
      getSelectedPage: () => page,
      getPages: () => [page],
      getSelectedPageIndex: () => 0,
    });

    const {response, lines} = createResponse();

    await navigatePage.handler(
      {params: {type: 'reload'}},
      response,
      runtime,
    );

    const output = lines.join('\n');
    assert.match(output, /页面已关闭|list_pages|导航失败/);
  });

  it('maps timeout errors to readable troubleshooting guidance', async () => {
    const page = createPage({
      goto: async () => {
        throw new Error('Navigation timeout of 10000 ms exceeded');
      },
    });

    const runtime = createRuntime({
      getSelectedPage: () => page,
      getPages: () => [page],
      getSelectedPageIndex: () => 0,
    });

    const {response, lines} = createResponse();

    await navigatePage.handler(
      {params: {type: 'url', url: 'https://slow.example'}},
      response,
      runtime,
    );

    const output = lines.join('\n');
    assert.match(output, /超时/);
  });
});
