/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {getRuntime} from '../../../src/runtime.js';
import {zod} from '../../../src/third_party/index.js';
import {traceSignatureGeneration as traceSignatureGenerationTool} from '../../../src/tools/workflow/traceSignatureGeneration.js';

const traceSignatureGeneration = Object.assign(
  async (runtime: any, params: any): Promise<any> => {
    const originalProvider = getRuntime().contextProvider;
    getRuntime().contextProvider = runtime;
    let result: any = null;
    const response = {
      appendResponseLine: (line: string) => {
        if (line.startsWith('```json')) return;
        if (line.startsWith('```')) return;
        try {
          result = JSON.parse(line);
        } catch {
          /* intentionally empty */
        }
      },
      setStructuredContent: (content: unknown) => {
        result = content;
      },
    } as any;
    try {
      await traceSignatureGenerationTool.handler(
        {params} as any,
        response,
        runtime,
      );
    } finally {
      getRuntime().contextProvider = originalProvider;
    }
    return result;
  },
  {
    schema: traceSignatureGenerationTool.schema,
  },
);

function createRuntime() {
  const signedRequest = {
    url: () => 'https://example.test/api/order',
    method: () => 'POST',
    postData: () => '{"sku":"1"}',
    resourceType: () => 'xhr',
    headers: () => ({
      'x-sign': 'secret-signature',
      'x-nonce': 'nonce-1',
      accept: 'application/json',
    }),
  };

  const mockPage = {id: 0, isClosed: () => false};

  return {
    getPages: () => [mockPage] as never[],
    getSelectedPage: () => mockPage as never,
    getSelectedPageIndex: () => 0,
    getNetworkRequests: () => [signedRequest] as never[],
    getNetworkRequestById: () => signedRequest as never,
    getNetworkRequestStableId: () => 701,
    getRequestInitiator: () => ({
      type: 'script',
      url: 'https://example.test/app.js',
      lineNumber: 22,
      columnNumber: 4,
    }),
    getDevToolsData: async () => undefined,
    resolveCdpRequestId: () => undefined,
    getDebuggerContext: async () => ({
      getPausedState: () => ({
        isPaused: true,
        reason: 'XHR',
        callFrames: [
          {
            callFrameId: 'cf-1',
            functionName: 'makeSign',
            url: 'https://example.test/app.js',
            location: {scriptId: '1', lineNumber: 22, columnNumber: 4},
          },
        ],
      }),
    }),
  };
}

describe('traceSignatureGeneration', () => {
  it('validates trace_signature_generation schema', () => {
    const schema = zod.object(traceSignatureGeneration.schema);
    const parsed = schema.parse({
      requestUrlPattern: '/api/order',
      headerKeyword: 'sign',
      includeSensitiveValues: false,
      maxResults: 3,
      taskId: 'task-1',
    });

    assert.strictEqual(parsed.headerKeyword, 'sign');
    assert.strictEqual(parsed.includeSensitiveValues, false);
  });

  it('builds a bounded evidence-first workflow from signature headers', async () => {
    const result = await traceSignatureGeneration(createRuntime() as never, {
      headerKeyword: 'sign',
      requestUrlPattern: '/api/order',
      includeSensitiveValues: false,
    });

    assert.equal(result.success, true);
    assert.equal(result.tooltype, 'trace_signature_generation');
    assert.deepEqual(result.data.requestFingerprints, [
      {
        reqid: 701,
        method: 'POST',
        url: 'https://example.test/api/order',
        signatureIndicators: ['x-sign', 'x-nonce'],
      },
    ]);
    assert.deepEqual(result.data.pausedFrames, [
      {
        callFrameId: 'cf-1',
        functionName: 'makeSign',
        url: 'https://example.test/app.js',
        lineNumber: 22,
        columnNumber: 4,
      },
    ]);
    assert.ok(
      result.data.nextActions.some(action =>
        action.includes('xhr_to_js_breakpoint'),
      ),
    );
    assert.ok(
      result.data.nextActions.some(action =>
        action.includes('evaluate_on_callframe'),
      ),
    );
    assert.equal(
      result.data.evidence.requestHeaders[0]['x-sign'],
      '[redacted]',
    );
  });
});
