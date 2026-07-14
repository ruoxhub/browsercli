/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {
  ensureToolsMeta,
  getToolMeta,
  type ToolMeta,
} from '../../../src/tools/tools-meta.js';
import {ErrorCodes, ToolError} from '../../../src/utils/errors.js';
import {
  ToolExecutionPipeline,
  type ToolExecutionRouter,
  type ToolHandlerLoader,
} from '../../../src/worker/ToolExecutionPipeline.js';
import {
  ToolResponseProcessor,
  ToolResultRecorder,
  type ToolTelemetry,
} from '../../../src/worker/ToolResponse.js';

interface TestResultRecorder {
  records: unknown[];
  record(record: unknown): void;
}

function meta(overrides: Partial<ToolMeta> = {}): ToolMeta {
  return {
    name: 'pipeline_fixture',
    description: '',
    schema: {},
    argSpecs: {},
    modulePath: './test-fixtures/toolAdapterFixtures.js',
    handlerName: 'defaultFunctionFixture',
    callMode: 'defineTool',
    ...overrides,
  } as ToolMeta;
}

function createPipeline(
  options: {
    handler?: unknown;
    result?: unknown;
    thrown?: unknown;
    offload?: (response: unknown) => unknown;
    telemetry?: {
      successes: unknown[];
      failures: unknown[];
    };
    recorder?: TestResultRecorder;
  } = {},
) {
  const handler = options.handler ?? (async () => undefined);
  const loader = {
    load: async () => handler,
  } as unknown as ToolHandlerLoader;
  const router = {
    execute: async () => {
      if (options.thrown) throw options.thrown;
      return options.result ?? {ok: true};
    },
  } as unknown as ToolExecutionRouter;
  const processor = {
    normalize: (result: unknown) => new ToolResponseProcessor().normalize(result),
    process: options.offload ?? (response => response),
  } as unknown as ToolResponseProcessor;
  const telemetryState = options.telemetry ?? {
    successes: [],
    failures: [],
  };
  const telemetry = {
    success: (...args: unknown[]) => telemetryState.successes.push(args),
    failure: (...args: unknown[]) => telemetryState.failures.push(args),
  } as unknown as ToolTelemetry;

  return {
    pipeline: new ToolExecutionPipeline(
      loader,
      router,
      processor,
      telemetry,
      undefined,
      undefined,
      options.recorder as never,
    ),
    telemetryState,
  };
}

describe('ToolExecutionPipeline', () => {
  it('execute returns normalized response for successful function tool', async () => {
    const recorder: TestResultRecorder = {
      records: [],
      record(record: unknown) {
        this.records.push(record);
      },
    };
    const {pipeline, telemetryState} = createPipeline({
      result: {value: 'ok'},
      recorder,
    });

    const result = await pipeline.execute(meta(), {value: 'ok'});

    assert.deepStrictEqual(result, {
      structuredContent: {value: 'ok'},
    });
    assert.strictEqual(telemetryState.successes.length, 1);
    assert.strictEqual(telemetryState.failures.length, 0);
    assert.strictEqual(recorder.records.length, 1);
    assert.deepStrictEqual(
      (recorder.records[0] as Record<string, unknown>).response,
      {
        structuredContent: {value: 'ok'},
      },
    );
  });

  it('execute throws VALIDATION when args are invalid', async () => {
    await ensureToolsMeta();
    const validationMeta = getToolMeta('create_site_experience');
    assert.ok(validationMeta, 'missing meta for create_site_experience');
    const {pipeline, telemetryState} = createPipeline();

    await assert.rejects(
      pipeline.execute(validationMeta, {domain: 42, name: 'fixture'}),
      (error: unknown) =>
        error instanceof ToolError && error.code === ErrorCodes.VALIDATION,
    );
    assert.strictEqual(telemetryState.successes.length, 0);
    assert.strictEqual(telemetryState.failures.length, 1);
  });

  it('execute throws NOT_FOUND when loader returns null', async () => {
    const loader = {
      load: async () => null,
    } as unknown as ToolHandlerLoader;
    const router = {
      execute: async () => ({ok: true}),
    } as unknown as ToolExecutionRouter;
    const processor = {
      normalize: (result: unknown) => new ToolResponseProcessor().normalize(result),
      process: (response: unknown) => response,
    } as unknown as ToolResponseProcessor;
    const failures: unknown[] = [];
    const telemetry = {
      success: () => undefined,
      failure: (...args: unknown[]) => failures.push(args),
    } as unknown as ToolTelemetry;
    const pipeline = new ToolExecutionPipeline(
      loader,
      router,
      processor,
      telemetry,
    );

    await assert.rejects(
      pipeline.execute(meta(), {}),
      (error: unknown) =>
        error instanceof ToolError && error.code === ErrorCodes.NOT_FOUND,
    );
    assert.strictEqual(failures.length, 1);
  });

  it('execute normalizes unknown thrown errors into RUNTIME ToolError', async () => {
    const recorder: TestResultRecorder = {
      records: [],
      record(record: unknown) {
        this.records.push(record);
      },
    };
    const {pipeline, telemetryState} = createPipeline({
      thrown: new Error('boom'),
      recorder,
    });

    await assert.rejects(
      pipeline.execute(meta(), {value: 'ok'}),
      (error: unknown) =>
        error instanceof ToolError &&
        error.code === ErrorCodes.RUNTIME &&
        error.message === 'boom',
    );
    assert.strictEqual(telemetryState.failures.length, 1);
    assert.deepStrictEqual(
      (recorder.records[0] as Record<string, unknown>).request,
      {value: 'ok'},
    );
    assert.deepStrictEqual(
      (recorder.records[0] as Record<string, unknown>).error,
      {
        code: ErrorCodes.RUNTIME,
        message: 'boom',
      },
    );
  });

  it('execute passes large normalized responses through ToolResponseOffloader', async () => {
    const {pipeline} = createPipeline({
      result: 'large text',
      offload: response => ({offloaded: response}),
    });

    const result = await pipeline.execute(meta(), {});

    assert.deepStrictEqual(result, {
      offloaded: {text: 'large text'},
    });
  });

  it('checks prerequisites before loading handlers', async () => {
    let loaded = false;
    const loader = {
      load: async () => {
        loaded = true;
        return async () => ({ok: true});
      },
    } as unknown as ToolHandlerLoader;
    const router = {
      execute: async () => ({ok: true}),
    } as unknown as ToolExecutionRouter;
    const processor = {
      normalize: (result: unknown) => new ToolResponseProcessor().normalize(result),
      process: (response: unknown) => response,
    } as unknown as ToolResponseProcessor;
    const failures: unknown[] = [];
    const telemetry = {
      success: () => undefined,
      failure: (...args: unknown[]) => failures.push(args),
    } as unknown as ToolTelemetry;
    const pipeline = new ToolExecutionPipeline(
      loader,
      router,
      processor,
      telemetry,
      undefined,
      {
        check: () => {
          throw new ToolError(ErrorCodes.PREREQUISITE, 'missing page');
        },
      } as never,
    );

    await assert.rejects(
      pipeline.execute(
        meta({
          prerequisites: [
            {
              condition: 'requiresPage',
              fix: 'Start or attach a browser page first.',
            },
          ],
        }),
        {},
      ),
      (error: unknown) =>
        error instanceof ToolError && error.code === ErrorCodes.PREREQUISITE,
    );
    assert.strictEqual(loaded, false);
    assert.strictEqual(failures.length, 1);
  });

  it('enriches normalized responses before offloading', async () => {
    const {pipeline} = createPipeline({
      result: {ok: true},
      offload: response => response,
    });
    const contextGuard = {
      recordCall: () => 1,
      enrichResponse: (_toolName: string, response: unknown) => ({
        ...(response as Record<string, unknown>),
        guarded: true,
      }),
    };
    const patched = pipeline as unknown as {
      contextGuard: typeof contextGuard;
    };
    patched.contextGuard = contextGuard;

    const result = await pipeline.execute(meta(), {});

    assert.deepStrictEqual(result, {
      structuredContent: {ok: true},
      guarded: true,
    });
  });

  it('records tool results to JSONL when enabled', async () => {
    const outputDir = mkdtempSync(path.join(os.tmpdir(), 'tool-results-'));
    try {
      const recorder = new ToolResultRecorder(
        () => ({
          enabled: true,
          outputDir,
        }),
        () => new Date('2026-05-21T00:00:00.000Z'),
      );

      recorder.record({
        toolName: 'pipeline_fixture',
        traceId: 'tr_pipeline_recorder_001',
        success: true,
        startedAt: '2026-05-21T00:00:00.000Z',
        durationMs: 5,
        request: {value: 'ok'},
        response: {structuredContent: {value: 'ok'}},
      });

      const content = readFileSync(
        path.join(outputDir, '2026-05-21.jsonl'),
        'utf-8',
      )
        .trim()
        .split('\n');
      assert.strictEqual(content.length, 1);
      assert.deepStrictEqual(JSON.parse(content[0]!), {
        toolName: 'pipeline_fixture',
        traceId: 'tr_pipeline_recorder_001',
        success: true,
        startedAt: '2026-05-21T00:00:00.000Z',
        durationMs: 5,
        input: {value: 'ok'},
        request: {value: 'ok'},
        response: {structuredContent: {value: 'ok'}},
      });
    } finally {
      rmSync(outputDir, {force: true, recursive: true});
    }
  });

  it('records tool call input in pipeline records', async () => {
    const recorder: TestResultRecorder = {
      records: [],
      record(record: unknown) {
        this.records.push(record);
      },
    };
    const {pipeline} = createPipeline({
      result: {value: 'ok'},
      recorder,
    });

    await pipeline.execute(meta(), {value: 'ok'});

    assert.deepStrictEqual(
      (recorder.records[0] as Record<string, unknown>).input,
      {value: 'ok'},
    );
  });
});
