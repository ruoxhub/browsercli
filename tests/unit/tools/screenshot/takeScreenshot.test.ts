/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {GENERATED_DOMAIN_MANIFESTS} from '../../../../src/tools/generated-tools-index.js';
import {ToolRegistry} from '../../../../src/tools/registry/ToolRegistry.js';
import {manifest as screenshotManifest} from '../../../../src/tools/screenshot/manifest.js';
import {takeScreenshot} from '../../../../src/tools/screenshot/takeScreenshot.js';
import {loadToolMeta} from '../../../../src/tools/tools-meta.js';
import {ToolError} from '../../../../src/utils/errors.js';

function captureResponse() {
  let content: Record<string, unknown> | undefined;
  return {
    response: {
      setStructuredContent(value: Record<string, unknown>) {
        content = value;
      },
      attachImage(value: unknown) {
        void value;
      },
    },
    get content() {
      return content;
    },
  };
}

describe('take_screenshot', () => {
  it('forwards a configurable deadline to the page screenshot', async () => {
    const calls: unknown[] = [];
    const page = {
      screenshot: async (options: unknown) => {
        calls.push(options);
        return Buffer.from('image');
      },
    };
    const output = captureResponse();

    await takeScreenshot.handler(
      {params: {format: 'png', timeoutMs: 37}} as never,
      output.response as never,
      {getSelectedPage: () => page} as never,
    );

    assert.equal((calls[0] as {timeout?: number}).timeout, 37);
    assert.equal(output.content?.success, true);
  });

  it('invokes preparePageForLongScreenshot when fullPage is true', async () => {
    let prepared = false;
    let restored = false;
    const page = {
      evaluateHandle: async () => {
        prepared = true;
        return {
          restore: () => {
            restored = true;
          },
        };
      },
      evaluate: async (fn: any, handle: any) => {
        fn(handle);
      },
      screenshot: async (options: unknown) => {
        assert.equal(prepared, true, 'page should be prepared before screenshot');
        return Buffer.from('image');
      },
    };
    const output = captureResponse();

    await takeScreenshot.handler(
      {params: {format: 'png', fullPage: true}} as never,
      output.response as never,
      {getSelectedPage: () => page} as never,
    );

    assert.equal(output.content?.success, true);
    assert.equal(prepared, true);
    assert.equal(restored, true);
  });

  it('returns a structured timeout when rendering stays blocked', async () => {
    const page = {
      screenshot: async () => await new Promise<never>(() => undefined),
    };
    const output = captureResponse();

    await assert.rejects(
      () =>
        takeScreenshot.handler(
          {params: {format: 'png', timeoutMs: 10}} as never,
          output.response as never,
          {getSelectedPage: () => page} as never,
        ),
      (error: unknown) =>
        error instanceof ToolError && /超时 \(10ms\)/.test(error.message),
    );
  });
});

describe('screenshot domain', () => {
  it('manifest contains exactly one tool: take_screenshot', () => {
    assert.equal(screenshotManifest.tools.length, 1);
    assert.equal(screenshotManifest.tools[0].handlerName, 'takeScreenshot');
    assert.equal(
      screenshotManifest.tools[0].modulePath,
      './screenshot/takeScreenshot.js',
    );
  });

  it('registry exposes only take_screenshot for the screenshot domain', async () => {
    const registry = new ToolRegistry(GENERATED_DOMAIN_MANIFESTS);
    for (const profile of ['workflow', 'full'] as const) {
      const screenshotTools = registry
        .listTools(profile)
        .filter(tool => tool.domain === 'screenshot');
      assert.equal(
        screenshotTools.length,
        1,
        `screenshot domain must expose exactly 1 tool in ${profile} profile`,
      );
      const meta = await loadToolMeta(screenshotTools[0]);
      assert.equal(meta?.name, 'take_screenshot');
    }
  });
});
