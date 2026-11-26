/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  ensureToolsMeta,
  getToolMeta,
  getToolMetaAsync,
  type ToolMeta,
} from '../../../src/tools/tools-meta.js';
import {ErrorCodes, ToolError} from '../../../src/utils/errors.js';
import {PageHealthTracker} from '../../../src/worker/context/PageHealthTracker.js';
import {ToolExecutionPipeline} from '../../../src/worker/ToolExecutionPipeline.js';
import {
  ToolResponseAccumulator,
  ToolResponseProcessor,
  ToolResultRecorder,
  ToolTelemetry,
} from '../../../src/worker/ToolResponse.js';
import {WorkerActivityCoordinator} from '../../../src/worker/WorkerActivityCoordinator.js';

function makeMeta(overrides: Partial<ToolMeta> = {}): ToolMeta {
  return {
    name: 'pipeline_test_tool',
    description: '',
    schema: {},
    argSpecs: {},
    modulePath: './test-fixtures/toolAdapterFixtures.js',
    handlerName: 'defaultFunctionFixture',
    callMode: 'defineTool',
    ...overrides,
  } as ToolMeta;
}

function buildTestPipeline(options: {
  loadHandler: (name: string) => Promise<{
    blockedByDialog?: boolean;
    concurrency?: 'exclusive' | 'page' | 'none';
    handler: (
      req: {params: Record<string, unknown>},
      resp: ToolResponseAccumulator,
    ) => Promise<void>;
  }>;
  getDialog?: () => unknown;
  getSelectedPage?: () => unknown;
}) {
  const loader = {
    load: async (m: ToolMeta) => await options.loadHandler(m.name),
  };
  const router = {
    execute: async (
      _meta: ToolMeta,
      loaded: {
        handler: (
          req: {params: Record<string, unknown>},
          resp: ToolResponseAccumulator,
          ctx: unknown,
        ) => Promise<void>;
      },
      params: Record<string, unknown>,
    ) => {
      const acc = new ToolResponseAccumulator();
      await loaded.handler({params}, acc, {});
      return acc.toJSON();
    },
  };
  const contextProvider = {
    getDialog: options.getDialog ?? (() => undefined),
    getSelectedPage: options.getSelectedPage ?? (() => ({})),
    getPageId: () => 'page-0',
    recordToolSuccess: () => undefined,
    recordToolFailure: () => undefined,
    eventBus: {emit: () => undefined},
  };
  const processor = new ToolResponseProcessor();
  const telemetry = new ToolTelemetry(contextProvider as never);

  return new ToolExecutionPipeline(
    loader as never,
    router as never,
    processor,
    telemetry,
    undefined,
    undefined,
    new ToolResultRecorder(),
    new WorkerActivityCoordinator(),
    new PageHealthTracker(),
    contextProvider as never,
  );
}

describe('ToolExecutionPipeline concurrency, dialog blocking & tool aliases', () => {
  it('blocks tools marked blockedByDialog=true when an open dialog exists, unless blockedByDialog=false', async () => {
    const events: string[] = [];
    const pipeline = buildTestPipeline({
      loadHandler: async (name: string) => ({
        blockedByDialog: name !== 'handle_dialog',
        concurrency: 'page',
        handler: async (_req, resp) => {
          events.push(name);
          resp.setStructuredContent({ok: true});
        },
      }),
      getDialog: () => ({type: () => 'alert', message: () => 'hi'}),
    });

    await assert.rejects(
      pipeline.execute(makeMeta({name: 'click'}), {}),
      (err: unknown) =>
        err instanceof ToolError && err.code === ErrorCodes.PREREQUISITE,
    );

    await pipeline.execute(makeMeta({name: 'handle_dialog'}), {});
    assert.deepEqual(events, ['handle_dialog']);
  });

  it('serializes page/exclusive concurrency while letting concurrency=none run immediately', async () => {
    const timeline: string[] = [];
    let releasePageTask!: () => void;
    const pageTaskGate = new Promise<void>(resolve => {
      releasePageTask = resolve;
    });

    const selectedPage = {};
    const pipeline = buildTestPipeline({
      loadHandler: async (name: string) => {
        if (name === 'slow_page_tool') {
          return {
            concurrency: 'page',
            blockedByDialog: false,
            handler: async (_req, resp) => {
              timeline.push('slow:start');
              await pageTaskGate;
              timeline.push('slow:end');
              resp.setStructuredContent({ok: true});
            },
          };
        }
        if (name === 'exclusive_tool') {
          return {
            concurrency: 'exclusive',
            blockedByDialog: false,
            handler: async (_req, resp) => {
              timeline.push('exclusive:run');
              resp.setStructuredContent({ok: true});
            },
          };
        }
        return {
          concurrency: 'none',
          blockedByDialog: false,
          handler: async (_req, resp) => {
            timeline.push('none:run');
            resp.setStructuredContent({ok: true});
          },
        };
      },
      getSelectedPage: () => selectedPage,
    });

    const slowPromise = pipeline.execute(
      makeMeta({name: 'slow_page_tool'}),
      {},
    );
    await new Promise(r => setTimeout(r, 15));

    // concurrency='none' must run even while slow_page_tool holds the page lock
    await pipeline.execute(makeMeta({name: 'none_tool'}), {});
    assert.deepEqual(timeline, ['slow:start', 'none:run']);

    // concurrency='exclusive' waits for slow_page_tool
    const exclPromise = pipeline.execute(
      makeMeta({name: 'exclusive_tool'}),
      {},
    );
    await new Promise(r => setTimeout(r, 15));
    assert.deepEqual(timeline, ['slow:start', 'none:run']);

    releasePageTask();
    await Promise.all([slowPromise, exclPromise]);
    assert.deepEqual(timeline, [
      'slow:start',
      'none:run',
      'slow:end',
      'exclusive:run',
    ]);
  });

  it('indexes chrome-devtools-mcp compatible debugger aliases in tools-meta', async () => {
    await ensureToolsMeta();
    assert.equal(getToolMeta('debugger_pause')?.name, 'pause');
    assert.equal(getToolMeta('debugger_resume')?.name, 'resume');
    assert.equal(
      getToolMeta('debugger_evaluate')?.name,
      'evaluate_on_callframe',
    );
    assert.equal(
      getToolMeta('debugger_get_paused_state')?.name,
      'get_paused_info',
    );
    assert.equal(
      getToolMeta('debugger_get_object_properties')?.name,
      'inspect_object',
    );
    assert.equal(
      (await getToolMetaAsync('debugger_set_breakpoint'))?.name,
      'set_breakpoint',
    );
  });
});
