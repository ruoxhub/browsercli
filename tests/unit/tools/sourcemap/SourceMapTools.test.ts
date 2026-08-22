/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';

import {SourceMapError} from '../../../../src/modules/sourcemap/types.js';
import {setRuntime} from '../../../../src/runtime.js';
import {
  sourcemapDiff,
  sourcemapDiscover,
  sourcemapLookup,
  sourcemapParse,
  sourcemapReconstructTree,
} from '../../../../src/tools/sourcemap/index.js';
import {manifest} from '../../../../src/tools/sourcemap/manifest.js';
import {ToolError} from '../../../../src/utils/errors.js';
import {DefineToolContextFactory} from '../../../../src/worker/DefineToolContextFactory.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

afterEach(() => setRuntime(undefined));

describe('SourceMap tools', () => {
  it('exports exactly five full-profile tools', () => {
    assert.equal(manifest.profile, 'full');
    assert.deepEqual(
      manifest.tools.map(item => item.handlerName),
      [
        'sourcemapDiscover',
        'sourcemapParse',
        'sourcemapLookup',
        'sourcemapReconstructTree',
        'sourcemapDiff',
      ],
    );
  });

  it('marks only reconstruction as mutating', () => {
    assert.equal(sourcemapDiscover.annotations.readOnlyHint, true);
    assert.equal(sourcemapParse.annotations.readOnlyHint, true);
    assert.equal(sourcemapLookup.annotations.readOnlyHint, true);
    assert.equal(sourcemapDiff.annotations.readOnlyHint, true);
    assert.equal(sourcemapReconstructTree.annotations.readOnlyHint, false);
  });

  it('returns the common envelope and a stable domain error code', async () => {
    setRuntime({
      sourceMapService: {
        lookup: () => {
          throw new SourceMapError('MAP_NOT_FOUND', 'Map is unavailable');
        },
      },
    } as never);
    const response = new ToolResponseAccumulator();
    await assert.rejects(
      () =>
        sourcemapLookup.handler(
          {
            params: {
              mapId: `sm_${'0'.repeat(32)}`,
              direction: 'generated_to_original',
              line: 1,
              column: 0,
            },
          },
          response,
          {} as never,
        ),
      (error: unknown) =>
        error instanceof ToolError &&
        (error.code as string) === 'MAP_NOT_FOUND' &&
        error.message === 'Map is unavailable',
    );
  });

  it('rejects ambiguous parse selectors at the handler boundary', async () => {
    let serviceCalls = 0;
    setRuntime({
      sourceMapService: {
        parse: async () => {
          serviceCalls += 1;
          return {};
        },
      },
    } as never);
    const response = new ToolResponseAccumulator();
    await assert.rejects(
      () =>
        sourcemapParse.handler(
          {
            params: {
              mapUrl: 'https://example.com/app.js.map',
              mapContent: '{}',
              allowCrossOrigin: false,
            },
          },
          response,
          {} as never,
        ),
      (error: unknown) =>
        error instanceof ToolError &&
        (error.code as string) === 'INVALID_SOURCE_INPUT' &&
        error.message === 'Exactly one SourceMap source must be provided',
    );
    assert.equal(serviceCalls, 0);
  });

  it('peeks existing debugger metadata without activating CDP', async () => {
    let debuggerActivations = 0;
    setRuntime({
      sourceMapService: {
        discover: (_input: unknown, access: {listScripts(): unknown[]}) => ({
          candidates: access.listScripts(),
          warnings: [],
        }),
      },
    } as never);
    const response = new ToolResponseAccumulator();
    await sourcemapDiscover.handler({params: {limit: 100}}, response, {
      getExistingDebuggerContext: () => undefined,
      getDebuggerContext: async () => {
        debuggerActivations += 1;
        throw new Error('must not activate debugger');
      },
    } as never);
    assert.equal(debuggerActivations, 0);
    assert.deepEqual(
      (
        response.toJSON().structuredContent as {
          data: {candidates: unknown[]};
        }
      ).data.candidates,
      [],
    );
  });

  it('peeks debugger metadata through the worker tool context', async () => {
    setRuntime({
      sourceMapService: {
        discover: (_input: unknown, access: {listScripts(): unknown[]}) => ({
          candidates: access.listScripts(),
          warnings: [],
        }),
      },
    } as never);
    const context = new DefineToolContextFactory({
      getExistingDebuggerContext: () => ({
        getScripts: () => [
          {
            scriptId: '19',
            url: 'https://example.com/app.js',
            sourceMapURL: 'app.js.map',
          },
        ],
      }),
    } as never).create();
    const response = new ToolResponseAccumulator();

    await sourcemapDiscover.handler({params: {limit: 100}}, response, context);

    assert.deepEqual(
      (
        response.toJSON().structuredContent as {
          data: {candidates: unknown[]};
        }
      ).data.candidates,
      [
        {
          scriptId: '19',
          generatedUrl: 'https://example.com/app.js',
          sourceMapURL: 'app.js.map',
        },
      ],
    );
  });

  it('rejects a declared captured body over maxBytes before reading it', async () => {
    let bodyReads = 0;
    setRuntime({
      sourceMapService: {
        parse: async (
          _input: unknown,
          access: {
            findCapturedBody(url: string, maxBytes?: number): Promise<unknown>;
          },
        ) => access.findCapturedBody('https://example.com/app.js.map', 4),
      },
      reverseTaskStore: {},
    } as never);
    const response = new ToolResponseAccumulator();
    await sourcemapParse.handler(
      {params: {mapContent: '{}', allowCrossOrigin: false}},
      response,
      {
        getNetworkRequests: () => [
          {
            url: () => 'https://example.com/app.js.map',
            response: async () => ({
              headers: () => ({'content-length': '5'}),
              body: async () => {
                bodyReads += 1;
                return Buffer.from('12345');
              },
            }),
          },
        ],
        getSelectedPage: () => null,
      } as never,
    );
    assert.equal(bodyReads, 0);
    assert.equal(
      (
        response.toJSON().structuredContent as {
          data: unknown;
        }
      ).data,
      undefined,
    );
  });
});
