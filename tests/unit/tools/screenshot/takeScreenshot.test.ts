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

describe('screenshot domain manifest', () => {
  it('contains exactly one tool: take_screenshot', () => {
    assert.equal(screenshotManifest.tools.length, 1);
    assert.equal(screenshotManifest.tools[0].handlerName, 'takeScreenshot');
    assert.equal(
      screenshotManifest.tools[0].modulePath,
      './screenshot/takeScreenshot.js',
    );
  });

  it('does not expose video tools in full or workflow profile', async () => {
    const registry = new ToolRegistry(GENERATED_DOMAIN_MANIFESTS);
    const videoNames = ['capture_video_frame', 'get_video_info', 'seek_video'];

    for (const profile of ['workflow', 'full'] as const) {
      const tools = registry.listTools(profile);
      const names: string[] = [];
      for (const tool of tools) {
        const meta = await loadToolMeta(tool);
        if (meta) {
          names.push(meta.name);
        }
      }
      for (const videoName of videoNames) {
        assert.ok(
          !names.includes(videoName),
          `Tool ${videoName} should not exist in profile ${profile}`,
        );
      }
      assert.ok(
        names.includes('take_screenshot'),
        `Tool take_screenshot must exist in profile ${profile}`,
      );
    }
  });
});
