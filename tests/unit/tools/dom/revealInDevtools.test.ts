/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {revealInDevtools} from '../../../../src/tools/dom/revealInDevtools.js';
import {GENERATED_DOMAIN_MANIFESTS} from '../../../../src/tools/generated-tools-index.js';
import {ToolRegistry} from '../../../../src/tools/registry/ToolRegistry.js';
import {loadToolMeta} from '../../../../src/tools/tools-meta.js';

function capture() {
  const lines: string[] = [];
  let content: Record<string, unknown> | undefined;
  return {
    lines,
    get content() {
      return content;
    },
    response: {
      appendResponseLine: (v: string) => lines.push(v),
      setStructuredContent: (v: Record<string, unknown>) => {
        content = v;
      },
    },
  };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    getSelectedFrame: () => null,
    getSelectedPage: () => null,
    ...overrides,
  };
}

describe('devtools dissolution & reveal_in_devtools in dom', () => {
  const registry = new ToolRegistry(GENERATED_DOMAIN_MANIFESTS);

  it('dissolves the devtools domain completely', () => {
    const domainNames = GENERATED_DOMAIN_MANIFESTS.map(m => m.name);
    assert.ok(!domainNames.includes('devtools'), 'devtools domain must not exist');
  });

  it('reveal_in_devtools is registered under dom domain in full profile only', async () => {
    const workflowTools = registry.listTools('workflow');
    const fullTools = registry.listTools('full');

    const inWorkflow = workflowTools.find(t => t.handlerName === 'revealInDevtools');
    assert.equal(inWorkflow, undefined, 'revealInDevtools must not be in workflow profile');

    const inFull = fullTools.find(t => t.handlerName === 'revealInDevtools');
    assert.ok(inFull, 'revealInDevtools must exist in full profile');
    assert.equal(inFull.domain, 'dom');

    const meta = await loadToolMeta(inFull);
    assert.equal(meta.name, 'reveal_in_devtools');
    assert.ok('selector' in meta.argSpecs);
    assert.ok('durationMs' in meta.argSpecs);
  });
});

describe('reveal_in_devtools', () => {
  it('rejects when no page is selected', async () => {
    const out = capture();
    await assert.rejects(
      () =>
        revealInDevtools.handler(
          {params: {selector: '.btn'}} as never,
          out.response as never,
          makeContext() as never,
        ),
      /当前无活跃页面|没有可用的 Frame|No active page/i,
    );
  });

  it('highlights the resolved node via Overlay CDP calls', async () => {
    const calls: Array<{method: string; params?: unknown}> = [];
    const cdp = {
      send: async (method: string, params?: unknown) => {
        calls.push({method, params});
        switch (method) {
          case 'DOM.enable':
          case 'Overlay.enable':
            return {};
          case 'DOM.getDocument':
            return {root: {nodeId: 1}};
          case 'DOM.querySelector':
            return {nodeId: 9};
          case 'Overlay.highlightNode':
          case 'Overlay.hideHighlight':
            return {};
          default:
            throw new Error(`unexpected CDP method ${method}`);
        }
      },
      on: () => undefined,
      off: () => undefined,
      detach: async () => undefined,
    };
    const locator = (_selector: string) => ({
      first: () => ({
        evaluate: async () => undefined,
      }),
    });
    const page = {
      context: () => ({newCDPSession: async () => cdp}),
      mainFrame: () => ({locator}),
      url: () => 'about:blank',
    };
    // Real Frame exposes locator() + page(); the mock page supplies the locator
    // bridge, so the selected-frame shape composes both.
    const frame = {locator, page: () => page};
    const out = capture();

    await revealInDevtools.handler(
      {params: {selector: '.btn', durationMs: 10}} as never,
      out.response as never,
      {
        getSelectedFrame: () => frame,
        getSelectedPage: () => page,
      } as never,
    );

    const methods = calls.map(c => c.method);
    assert.ok(methods.includes('Overlay.enable'));
    assert.ok(methods.includes('Overlay.highlightNode'));
    const highlight = calls.find(c => c.method === 'Overlay.highlightNode')!;
    assert.equal((highlight.params as {nodeId: number}).nodeId, 9);
    assert.ok(methods.includes('Overlay.hideHighlight'));
    assert.equal(out.content?.success, true);
  });
});
