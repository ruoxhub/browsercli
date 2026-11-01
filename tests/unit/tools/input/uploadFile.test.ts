/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {uploadFile} from '../../../../src/tools/input/uploadFile.js';
import {NO_ACTIVE_PAGE_MESSAGE} from '../../../../src/tools/shared/activePageResolver.js';
import {ErrorCodes, ToolError} from '../../../../src/utils/errors.js';

interface HarnessOptions {
  nativeError?: Error;
  fileChooserError?: Error;
  cdpQueryNodeId?: number;
  cdpError?: Error;
  evaluateError?: Error;
}

function makeHarness(options: HarnessOptions = {}) {
  const cdpCalls: Array<{method: string; params?: unknown}> = [];
  const probeAttrs: Record<string, string> = {};
  let nativeCalled = false;
  let fileChooserCalled = false;
  let fileChooserFiles: string | string[] | undefined;
  let clickCalled = false;

  const mockCdpClient = {
    send: async (method: string, params?: unknown) => {
      cdpCalls.push({method, params});
      if (options.cdpError) throw options.cdpError;
      switch (method) {
        case 'DOM.enable':
          return {};
        case 'DOM.getDocument':
          return {root: {nodeId: 1}};
        case 'DOM.querySelector':
          return {nodeId: options.cdpQueryNodeId ?? 42};
        case 'DOM.setFileInputFiles':
          return {};
        default:
          throw new Error(`Unexpected CDP method: ${method}`);
      }
    },
    detach: async () => undefined,
  };

  const mockFileChooser = {
    setFiles: async (files: string | string[]) => {
      fileChooserFiles = files;
    },
  };

  const mockElement = {
    evaluate: async (_fn: unknown, args: unknown) => {
      if (options.evaluateError) throw options.evaluateError;
      if (Array.isArray(args)) {
        const [attr, val] = args as [string, string];
        probeAttrs[attr] = val;
      } else if (typeof args === 'string') {
        delete probeAttrs[args];
      }
    },
  };

  const mockLocator = {
    setInputFiles: async (_filePath: string) => {
      nativeCalled = true;
      if (options.nativeError) throw options.nativeError;
    },
    click: async () => {
      clickCalled = true;
    },
    first: () => mockElement,
    evaluate: mockElement.evaluate,
  };

  const mockPage = {
    context: () => ({
      newCDPSession: async () => mockCdpClient,
    }),
    locator: () => mockLocator,
    waitForEvent: async (event: string) => {
      if (event === 'filechooser') {
        fileChooserCalled = true;
        if (options.fileChooserError) throw options.fileChooserError;
        return mockFileChooser;
      }
      throw new Error(`Unexpected event: ${event}`);
    },
  };

  const mockFrame = {
    locator: () => mockLocator,
    page: () => mockPage,
  };

  let content: Record<string, unknown> | undefined;
  const response = {
    setStructuredContent: (val: Record<string, unknown>) => {
      content = val;
    },
  };

  return {
    context: {
      getSelectedFrame: () => mockFrame,
    },
    response,
    getContent: () => content,
    cdpCalls,
    probeAttrs,
    get nativeCalled() {
      return nativeCalled;
    },
    get fileChooserCalled() {
      return fileChooserCalled;
    },
    get fileChooserFiles() {
      return fileChooserFiles;
    },
    get clickCalled() {
      return clickCalled;
    },
  };
}

describe('upload_file', () => {
  it('throws FRAME_REQUIRED when no frame is selected', async () => {
    const harness = makeHarness();
    const contextWithoutFrame = {
      getSelectedFrame: () => null,
    };

    await assert.rejects(
      () =>
        uploadFile.handler(
          {
            params: {selector: '#file-input', filePath: '/path/to/test.txt'},
          } as never,
          harness.response as never,
          contextWithoutFrame as never,
        ),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, ErrorCodes.FRAME_REQUIRED);
        assert.equal(error.message, NO_ACTIVE_PAGE_MESSAGE);
        return true;
      },
    );
  });

  it('succeeds via native Playwright setInputFiles (strategy: native)', async () => {
    const harness = makeHarness();

    await uploadFile.handler(
      {
        params: {selector: '#file-input', filePath: '/path/to/test.txt'},
      } as never,
      harness.response as never,
      harness.context as never,
    );

    const content = harness.getContent();
    assert.equal(harness.nativeCalled, true);
    assert.equal(harness.fileChooserCalled, false);
    assert.equal(harness.cdpCalls.length, 0);
    assert.equal(content?.success, true);
    assert.equal(content?.strategy, undefined);
    assert.equal(
      (content?.data as Record<string, unknown>)?.strategy,
      'native',
    );
  });

  it('falls back to filechooser event when native fails (strategy: filechooser)', async () => {
    const harness = makeHarness({
      nativeError: new Error('Node is not an HTMLInputElement'),
    });

    await uploadFile.handler(
      {
        params: {selector: '#file-input', filePath: '/path/to/test.txt'},
      } as never,
      harness.response as never,
      harness.context as never,
    );

    const content = harness.getContent();
    assert.equal(harness.nativeCalled, true);
    assert.equal(harness.fileChooserCalled, true);
    assert.equal(harness.clickCalled, true);
    assert.equal(harness.fileChooserFiles, '/path/to/test.txt');
    assert.equal(harness.cdpCalls.length, 0);
    assert.equal(content?.success, true);
    assert.equal(content?.strategy, undefined);
    assert.equal(
      (content?.data as Record<string, unknown>)?.strategy,
      'filechooser',
    );
  });

  it('falls back to CDP DOM.setFileInputFiles when native and filechooser fail (strategy: cdp)', async () => {
    const harness = makeHarness({
      nativeError: new Error('Node is not an HTMLInputElement'),
      fileChooserError: new Error(
        'Timeout 3000ms exceeded waiting for event filechooser',
      ),
    });

    await uploadFile.handler(
      {
        params: {selector: '#file-input', filePath: '/path/to/test.txt'},
      } as never,
      harness.response as never,
      harness.context as never,
    );

    const content = harness.getContent();
    assert.equal(harness.nativeCalled, true);
    assert.equal(harness.fileChooserCalled, true);
    assert.equal(content?.success, true);
    assert.equal(content?.strategy, undefined);
    assert.equal((content?.data as Record<string, unknown>)?.strategy, 'cdp');

    const setFilesCall = harness.cdpCalls.find(
      c => c.method === 'DOM.setFileInputFiles',
    );
    assert.deepEqual(setFilesCall?.params, {
      nodeId: 42,
      files: ['/path/to/test.txt'],
    });
  });

  it('throws immediately without fallback when locator is ambiguous', async () => {
    const harness = makeHarness({
      nativeError: new Error(
        'strict mode violation: locator("#file-input") resolved to 2 elements:',
      ),
    });

    await assert.rejects(
      () =>
        uploadFile.handler(
          {
            params: {selector: '#file-input', filePath: '/path/to/test.txt'},
          } as never,
          harness.response as never,
          harness.context as never,
        ),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, ErrorCodes.ELEMENT_LOCATOR_AMBIGUOUS);
        return true;
      },
    );

    assert.equal(harness.nativeCalled, true);
    assert.equal(harness.fileChooserCalled, false);
    assert.equal(harness.cdpCalls.length, 0);
  });

  it('throws structured ToolError when all three levels fail', async () => {
    const harness = makeHarness({
      nativeError: new Error('native failed'),
      fileChooserError: new Error('filechooser timed out'),
      cdpError: new Error('CDP DOM.setFileInputFiles failed'),
    });

    await assert.rejects(
      () =>
        uploadFile.handler(
          {
            params: {selector: '#file-input', filePath: '/path/to/test.txt'},
          } as never,
          harness.response as never,
          harness.context as never,
        ),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, ErrorCodes.RUNTIME);
        assert.deepEqual(error.details, {
          native: 'native failed',
          filechooser: 'filechooser timed out',
          cdp: 'CDP DOM.setFileInputFiles failed',
        });
        return true;
      },
    );

    // Ensure it never returns success: false
    assert.equal(harness.getContent(), undefined);
  });
});
