/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  ensureToolsMeta,
  getToolMeta,
  type ToolMeta,
} from '../../../src/cli/tools-meta.js';
import {ErrorCodes, ToolError} from '../../../src/utils/errors.js';
import {ToolExecutionPipeline} from '../../../src/worker/ToolExecutionPipeline.js';
import type {ToolExecutionRouter} from '../../../src/worker/ToolExecutionRouter.js';
import type {ToolHandlerLoader} from '../../../src/worker/ToolHandlerLoader.js';
import type {ToolResponseOffloader} from '../../../src/worker/ToolResponseOffloader.js';
import type {ToolTelemetry} from '../../../src/worker/ToolTelemetry.js';

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
  const offloader = {
    handle: options.offload ?? (response => response),
  } as unknown as ToolResponseOffloader;
  const telemetryState = options.telemetry ?? {
    successes: [],
    failures: [],
  };
  const telemetry = {
    success: (...args: unknown[]) => telemetryState.successes.push(args),
    failure: (...args: unknown[]) => telemetryState.failures.push(args),
  } as unknown as ToolTelemetry;

  return {
    pipeline: new ToolExecutionPipeline(loader, router, offloader, telemetry),
    telemetryState,
  };
}

describe('ToolExecutionPipeline', () => {
  it('execute returns normalized response for successful function tool', async () => {
    const {pipeline, telemetryState} = createPipeline({
      result: {value: 'ok'},
    });

    const result = await pipeline.execute(meta(), {value: 'ok'});

    assert.deepStrictEqual(result, {
      structuredContent: {value: 'ok'},
    });
    assert.strictEqual(telemetryState.successes.length, 1);
    assert.strictEqual(telemetryState.failures.length, 0);
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
    const offloader = {
      handle: (response: unknown) => response,
    } as unknown as ToolResponseOffloader;
    const failures: unknown[] = [];
    const telemetry = {
      success: () => undefined,
      failure: (...args: unknown[]) => failures.push(args),
    } as unknown as ToolTelemetry;
    const pipeline = new ToolExecutionPipeline(
      loader,
      router,
      offloader,
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
    const {pipeline, telemetryState} = createPipeline({
      thrown: new Error('boom'),
    });

    await assert.rejects(
      pipeline.execute(meta(), {}),
      (error: unknown) =>
        error instanceof ToolError &&
        error.code === ErrorCodes.RUNTIME &&
        error.message === 'boom',
    );
    assert.strictEqual(telemetryState.failures.length, 1);
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
});
