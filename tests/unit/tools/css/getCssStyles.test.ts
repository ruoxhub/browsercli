/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {getCssStyles} from '../../../../src/tools/css/getCssStyles.js';

interface Capture {
  content?: Record<string, unknown>;
  lines: string[];
  response: {
    setStructuredContent(value: Record<string, unknown>): void;
    appendResponseLine(value: string): void;
  };
}

function captureResponse(): Capture {
  const capture: Capture = {
    lines: [],
    response: {
      setStructuredContent(value) {
        capture.content = value;
      },
      appendResponseLine(value) {
        capture.lines.push(value);
      },
    },
  };
  return capture;
}

/** CDP session mock: DOM.getDocument → DOM.querySelector → CSS.getMatchedStylesForNode */
function makeCdpClient(opts: {nodeId?: number; matched?: unknown} = {}) {
  const calls: Array<{method: string; params?: unknown}> = [];
  return {
    calls,
    send: async (method: string, params?: unknown) => {
      calls.push({method, params});
      switch (method) {
        case 'DOM.enable':
        case 'CSS.enable':
          return {};
        case 'DOM.getDocument':
          return {root: {nodeId: 1}};
        case 'DOM.querySelector':
          return {nodeId: opts.nodeId ?? 5};
        case 'CSS.getMatchedStylesForNode':
          return opts.matched ?? {};
        default:
          throw new Error(`unexpected CDP method ${method}`);
      }
    },
    on: () => undefined,
    off: () => undefined,
    detach: async () => undefined,
  };
}

function makePage(
  cdpClient: unknown,
  evaluateImpl?: (fn: string, arg?: unknown) => Promise<unknown>,
) {
  return {
    context: () => ({
      newCDPSession: async () => cdpClient,
    }),
    mainFrame: () => ({
      locator: (_selector: string) => ({
        first: () => ({
          evaluate:
            evaluateImpl ??
            (async (fn: string) => {
              throw new Error(`unexpected locator evaluate: ${fn}`);
            }),
        }),
      }),
    }),
  };
}

function makeContext(page: unknown) {
  // Real Frame exposes both locator() and page(); the mock page carries the
  // locator bridge, so compose them into the selected-frame shape.
  const mockPage = page as {mainFrame: () => Record<string, unknown>};
  return {
    getSelectedFrame: () => ({...mockPage.mainFrame(), page: () => page}),
    getSelectedPage: () => page,
  };
}

describe('get_css_styles', () => {
  const sampleMatched = {
    matchedCSSRules: [
      {
        rule: {
          selectorList: {text: '.btn'},
          origin: 'regular',
          style: {
            cssProperties: [
              {
                name: 'color',
                value: 'red',
                text: 'color: red;',
                important: false,
              },
            ],
          },
        },
      },
    ],
  };

  it('marks the located element, fetches matched styles, returns structured + text output', async () => {
    const cdp = makeCdpClient({nodeId: 7, matched: sampleMatched});
    const evaluateCalls: Array<{fn: string; attr: unknown}> = [];
    const page = makePage(cdp, async (fn: string, attr?: unknown) => {
      evaluateCalls.push({fn, attr});
      return undefined;
    });
    const output = captureResponse();

    await getCssStyles.handler(
      {params: {selector: '.btn'}} as never,
      output.response as never,
      makeContext(page) as never,
    );

    // locator evaluate ran (probe attribute bridge)
    assert.equal(evaluateCalls.length, 2); // set attr + remove attr
    // CDP calls in order
    assert.deepEqual(
      cdp.calls.map(c => c.method).filter(m => m !== 'Runtime.evaluate'),
      [
        'DOM.enable',
        'CSS.enable',
        'DOM.getDocument',
        'DOM.querySelector',
        'CSS.getMatchedStylesForNode',
      ],
    );
    // DOM.querySelector used the probe attribute selector
    const query = cdp.calls.find(c => c.method === 'DOM.querySelector')!;
    assert.ok(
      String((query.params as {selector: string}).selector).includes(
        'data-pcli-css-probe',
      ),
    );
    // structured content contains the cascade report
    assert.equal(output.content?.success, true);
    const data = output.content?.data as {
      elementSelector: string;
      totalRules: number;
    };
    assert.equal(data.elementSelector, '.btn');
    assert.equal(data.totalRules, 1);
    // text output rendered
    assert.ok(
      output.lines.length > 0 || typeof output.content?.message === 'string',
    );
  });

  it('passes pageSize/pageIdx through to the formatter', async () => {
    const cdp = makeCdpClient({matched: sampleMatched});
    const page = makePage(cdp, async () => undefined);
    const output = captureResponse();

    await getCssStyles.handler(
      {params: {selector: '.btn', pageSize: 1, pageIdx: 0}} as never,
      output.response as never,
      makeContext(page) as never,
    );

    const data = output.content?.data as {
      page: {pageSize?: number; pageIdx: number};
    };
    assert.equal(data.page.pageSize, 1);
    assert.equal(data.page.pageIdx, 0);
  });

  it('throws a tool error when no frame/page is selected', async () => {
    const output = captureResponse();
    await assert.rejects(
      () =>
        getCssStyles.handler(
          {params: {selector: '.btn'}} as never,
          output.response as never,
          {getSelectedFrame: () => null} as never,
        ),
      /当前无活跃页面|没有可用的 Frame|No active page/i,
    );
  });
});
