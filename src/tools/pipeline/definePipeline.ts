/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type ToolDefinition} from '../ToolDefinition.js';
import type {zod} from '../../third_party/index.js';
import type {PipelineContext, PipelineDef, PipelineStep, StepResult} from './types.js';

/**
 * 创建初始 Pipeline 上下文
 */
function createInitialContext(
  params: Record<string, unknown>,
): PipelineContext {
  return {
    input: params,
    steps: Object.freeze({}),
    prev: null,
  };
}

/**
 * 将增量更新合并到上下文（immutable）
 */
function mergeContext(
  ctx: PipelineContext,
  stepResult: StepResult,
  extra: Record<string, unknown>,
): PipelineContext {
  const newSteps = {[stepResult.step]: stepResult};

  return {
    ...ctx,
    ...extra,
    input: ctx.input,
    steps: Object.freeze({...ctx.steps, ...newSteps}),
    prev: stepResult,
  };
}

/**
 * 执行单个步骤，包含错误处理和重试
 */
async function executeStep(
  step: PipelineStep,
  ctx: PipelineContext,
): Promise<{ctx: PipelineContext; stepResult: StepResult}> {
  const maxRetries = step.retry ?? 0;
  let lastError: Error | undefined;
  let retries = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const start = Date.now();
    try {
      const fnResult = await step.fn(ctx);
      const durationMs = Date.now() - start;

      const stepResult: StepResult = {
        step: step.name,
        status: 'ok',
        data: fnResult?.data ?? fnResult,
        durationMs,
        retries,
      };

      const newCtx = mergeContext(ctx, stepResult, fnResult ?? {});
      return {ctx: newCtx, stepResult};
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries) {
        retries++;
        await new Promise(r => setTimeout(r, Math.min(100 * 2 ** attempt, 2000)));
      }
    }
  }

  // 所有重试耗尽
  const stepResult: StepResult = {
    step: step.name,
    status: 'error',
    data: null,
    error: lastError!.message,
    durationMs: 0,
    retries,
  };

  const onError = step.onError ?? 'fail';

  if (onError === 'fail') {
    throw lastError!;
  }

  // skip 或 continue 模式：将 error 状态写入上下文
  const newCtx = mergeContext(ctx, stepResult, {});
  return {ctx: newCtx, stepResult};
}

/**
 * 格式化 Pipeline 执行结果为结构化输出
 */
function buildPipelineOutput(
  stepResults: StepResult[],
  totalDurationMs: number,
): Record<string, unknown> {
  const failed = stepResults.filter(s => s.status === 'error');
  const skipped = stepResults.filter(s => s.status === 'skipped');
  const ok = stepResults.filter(s => s.status === 'ok');

  return {
    success: failed.length === 0,
    steps: stepResults.map(s => ({
      step: s.step,
      status: s.status,
      durationMs: s.durationMs,
      ...(s.error ? {error: s.error} : {}),
      ...(s.retries > 0 ? {retries: s.retries} : {}),
    })),
    summary: {
      total: stepResults.length,
      ok: ok.length,
      failed: failed.length,
      skipped: skipped.length,
      totalDurationMs,
    },
  };
}

/**
 * 创建 Pipeline 为 ToolDefinition。
 *
 * 将声明式步骤定义编译为标准的 defineTool 处理器，
 * Pipeline 自动处理上下文传播、错误隔离、重试和计时。
 *
 * @example
 * ```ts
 * const myPipeline = definePipeline({
 *   name: 'my_pipeline',
 *   description: '示例 Pipeline',
 *   annotations: { category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true },
 *   schema: { url: zod.string() },
 *   steps: [
 *     { name: 'collect', fn: async (ctx) => ({ data: await collect(ctx.input.url) }) },
 *     { name: 'analyze', fn: async (ctx) => ({ data: analyze(ctx.prev!.data) }) },
 *   ],
 * });
 * ```
 */
export function definePipeline<Schema extends zod.ZodRawShape>(
  def: PipelineDef<Schema>,
): ToolDefinition<Schema> {
  const {steps, timeoutMs = 300_000} = def;

  return defineTool({
    name: def.name,
    aliases: def.aliases,
    description: def.description,
    annotations: def.annotations,
    schema: def.schema,
    handler: async (request, response, _context) => {
      const pipelineStart = Date.now();
      const ctx = createInitialContext(request.params as Record<string, unknown>);
      const stepResults: StepResult[] = [];

      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

      try {
        let currentCtx = ctx;

        for (const step of steps) {
          const signal = timeoutController.signal;

          const stepPromise = executeStep(step, currentCtx);
          const abortPromise = new Promise<never>((_, reject) => {
            signal.addEventListener('abort', () =>
              reject(new Error(`Pipeline 超时 (${timeoutMs}ms)，当前步骤: ${step.name}`)),
            );
          });

          const {ctx: newCtx, stepResult} = await Promise.race([stepPromise, abortPromise]);
          currentCtx = newCtx;
          stepResults.push(stepResult);
        }

        clearTimeout(timeoutId);
        const totalDurationMs = Date.now() - pipelineStart;
        const output = buildPipelineOutput(stepResults, totalDurationMs);
        response.setStructuredContent(output);
      } catch (err) {
        clearTimeout(timeoutId);
        const totalDurationMs = Date.now() - pipelineStart;
        const errMsg = err instanceof Error ? err.message : String(err);

        // 未记录的失败步骤也加入结果
        const lastStep = steps[stepResults.length];
        if (lastStep && !stepResults.some(s => s.step === lastStep.name)) {
          stepResults.push({
            step: lastStep.name,
            status: 'error',
            data: null,
            error: errMsg,
            durationMs: 0,
            retries: 0,
          });
        }

        const output = buildPipelineOutput(stepResults, totalDurationMs);
        Object.assign(output, {fatalError: errMsg});
        response.setStructuredContent(output);
      }
    },
  });
}

/**
 * 创建条件步骤：仅当 predicate 返回 true 时才执行 fn
 */
export function when(
  name: string,
  predicate: (ctx: PipelineContext) => boolean,
  step: Omit<PipelineStep, 'name'>,
): PipelineStep {
  return {
    name,
    fn: async ctx => {
      if (!predicate(ctx)) {
        return {data: null};
      }
      return step.fn(ctx);
    },
    onError: step.onError,
    retry: step.retry,
  };
}

/**
 * 创建并行步骤：并行执行多个子步骤，等待全部完成
 */
export function parallel(
  name: string,
  steps: Omit<PipelineStep, 'name'>[],
  options?: {onError?: 'fail' | 'skip' | 'continue'},
): PipelineStep {
  return {
    name,
    fn: async ctx => {
      const results = await Promise.allSettled(
        steps.map(s => s.fn(ctx)),
      );

      const data: Record<string, unknown> = {};
      const errors: string[] = [];

      results.forEach((r, i) => {
        const subName = steps[i].onError ? `parallel_${i}` : `${name}[${i}]`;
        if (r.status === 'fulfilled') {
          Object.assign(data, {[subName]: r.value});
        } else {
          errors.push(`${subName}: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
        }
      });

      if (errors.length > 0) {
        const onError = options?.onError ?? 'fail';
        if (onError === 'fail') {
          throw new Error(`并行步骤失败: ${errors.join('; ')}`);
        }
        data._parallelErrors = errors;
      }

      return {data};
    },
    onError: options?.onError,
  };
}
