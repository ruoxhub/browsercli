/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {navigatePage} from '../../../../src/tools/navigation/navigatePage.js';
import {ToolError} from '../../../../src/utils/errors.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

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

function createRuntime(overrides: Record<string, unknown> = {}): any {
  return overrides;
}

function getOutput(response: ToolResponseAccumulator): string {
  const result = response.toJSON();
  const structured = result.structuredContent as {message?: string} | undefined;
  return structured?.message ?? '';
}

describe('navigatePage (defineTool)', () => {
  it('returns actionable message when no active page is selected', async () => {
    const runtime = createRuntime({
      getSelectedPage: () => null,
      getPages: () => [],
      getSelectedPageIndex: () => null,
    });

    const response = new ToolResponseAccumulator();

    await assert.rejects(
      () => navigatePage.handler({params: {type: 'reload'}}, response, runtime),
      (error: unknown) =>
        error instanceof ToolError &&
        /new_page|select_page|无活跃页面/.test(error.message),
    );
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

    const response = new ToolResponseAccumulator();

    await assert.rejects(
      () => navigatePage.handler({params: {type: 'reload'}}, response, runtime),
      (error: unknown) =>
        error instanceof ToolError &&
        /页面已关闭|list_pages|导航失败/.test(error.message),
    );
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

    const response = new ToolResponseAccumulator();

    await assert.rejects(
      () =>
        navigatePage.handler(
          {params: {type: 'url', url: 'https://slow.example'}},
          response,
          runtime,
        ),
      (error: unknown) =>
        error instanceof ToolError && /超时/.test(error.message),
    );
  });
});
