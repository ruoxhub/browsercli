/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {BrowserContext, Frame} from 'patchright';

import {PersistentHookRegistry} from '../../../../src/modules/hook/PersistentHookRegistry.js';
import {
  injectHook,
  listPersistentHooks,
} from '../../../../src/tools/hook/InjectHook.js';
import type {Context} from '../../../../src/tools/ToolDefinition.js';
import {ToolError} from '../../../../src/utils/errors.js';

function responseHarness() {
  let content: any;
  return {
    response: {
      setStructuredContent(value: unknown) {
        content = value;
      },
    } as any,
    get content() {
      return content;
    },
  };
}

function contextHarness(options: {browserContext?: boolean} = {}) {
  const frameScripts: string[] = [];
  const registerRequests: unknown[] = [];
  const frame = {
    evaluate: async (script: string) => frameScripts.push(script),
  } as unknown as Frame;
  const browserContext =
    options.browserContext === false
      ? null
      : ({isClosed: () => false} as unknown as BrowserContext);
  const registry = {
    register: async (request: any) => {
      registerRequests.push(request);
      return {
        entry: {
          hookId: request.hookId,
          scriptHash: 'hash',
          scriptSize: 8,
          scriptPreview: 'preview',
          registeredAt: 1,
          source: request.source,
          requestedWorld: request.requestedWorld,
          effectiveWorld: 'main',
          applyMode: request.applyMode,
        },
        registered: true,
        idempotent: false,
        appliedFrames: 2,
        failedFrames: [{frameUrl: 'x', reason: 'detached'}],
        partial: true,
        warnings: ['warning'],
      };
    },
    list: () => [],
  };
  return {
    context: {
      getSelectedFrame: () => frame,
      getBrowserContext: () => browserContext,
      getPersistentHookRegistry: () => registry,
    } as unknown as Context,
    frameScripts,
    registerRequests,
    registry,
    browserContext,
  };
}

describe('inject_hook persistent mode', () => {
  it('evaluates only the selected frame when persistent is false', async () => {
    const harness = contextHarness();
    const output = responseHarness();
    await injectHook.handler(
      {params: {hookId: 'once', script: 'once();'}},
      output.response,
      harness.context,
    );

    assert.deepEqual(harness.frameScripts, ['once();']);
    assert.deepEqual(harness.registerRequests, []);
    assert.deepEqual(output.content.data, {
      hookId: 'once',
      persisted: false,
      ranOnCurrentFrame: true,
      world: 'main',
      requestedWorld: 'main',
      effectiveWorld: 'main',
      persistentStrategy: 'evaluate-once',
      warnings: [],
    });
  });

  it('delegates persistent registration and preserves old response fields', async () => {
    const harness = contextHarness();
    const output = responseHarness();
    await injectHook.handler(
      {params: {hookId: 'persist', script: 'hook();', persistent: true}},
      output.response,
      harness.context,
    );

    assert.equal(harness.frameScripts.length, 0);
    assert.deepEqual(harness.registerRequests, [
      {
        context: harness.browserContext,
        hookId: 'persist',
        script: 'hook();',
        source: 'inject_hook',
        requestedWorld: 'main',
        applyMode: 'existing-and-future',
      },
    ]);
    assert.equal(output.content.data.persisted, true);
    assert.equal(output.content.data.ranOnCurrentFrame, true);
    assert.equal(output.content.data.world, 'main');
    assert.equal(output.content.data.persistentStrategy, 'addInitScript');
    assert.equal(output.content.data.partial, true);
    assert.deepEqual(output.content.data.failedFrames, [
      {frameUrl: 'x', reason: 'detached'},
    ]);
  });

  it('fails without a BrowserContext and does not fall back to evaluate', async () => {
    const harness = contextHarness({browserContext: false});
    const output = responseHarness();
    await assert.rejects(
      () =>
        injectHook.handler(
          {params: {hookId: 'persist', script: 'hook();', persistent: true}},
          output.response,
          harness.context,
        ),
      (error: unknown) =>
        error instanceof ToolError && error.code === 'BROWSER_REQUIRED',
    );

    assert.equal(harness.frameScripts.length, 0);
    assert.equal(harness.registerRequests.length, 0);
  });

  it('returns registry failures without evaluating once', async () => {
    const harness = contextHarness();
    harness.registry.register = async () => {
      throw new Error('conflict');
    };
    const output = responseHarness();
    await assert.rejects(
      () =>
        injectHook.handler(
          {params: {hookId: 'persist', script: 'hook();', persistent: true}},
          output.response,
          harness.context,
        ),
      (error: unknown) =>
        error instanceof ToolError && /conflict/.test(error.message),
    );

    assert.equal(harness.frameScripts.length, 0);
  });

  it('lists only the current context with compatibility metadata', async () => {
    const registry = new PersistentHookRegistry();
    const browserContext = {
      isClosed: () => false,
      once: () => browserContext,
      addInitScript: async () => ({dispose: async () => undefined}),
      pages: () => [],
    } as unknown as BrowserContext;
    await registry.register({
      context: browserContext,
      hookId: 'listed',
      script: 'listed();',
      source: 'inject_hook',
      requestedWorld: 'main',
      applyMode: 'existing-and-future',
    });
    const output = responseHarness();
    await listPersistentHooks.handler({params: {}}, output.response, {
      getBrowserContext: () => browserContext,
      getPersistentHookRegistry: () => registry,
    } as unknown as Context);

    assert.equal(output.content.data.count, 1);
    assert.equal(output.content.data.hooks[0].hookId, 'listed');
    assert.equal(output.content.data.hooks[0].world, 'main');
    assert.equal(output.content.data.hooks[0].removable, false);
    assert.equal(output.content.data.hooks[0].script, undefined);
    assert.equal(output.content.data.removable, false);
    assert.equal(
      output.content.data.clearBy,
      'close-or-recreate-browser-context',
    );
  });
});
