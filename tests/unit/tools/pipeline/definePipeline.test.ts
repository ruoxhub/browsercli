/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {zod} from '../../../../src/third_party/index.js';
import {ToolCategory} from '../../../../src/tools/categories.js';
import {
  definePipeline,
  parallel,
  when,
} from '../../../../src/tools/pipeline/definePipeline.js';
import type {PipelineContext} from '../../../../src/tools/pipeline/types.js';

// ── Helpers ──────────────────────────────────────────────────

function okData<T>(data: T) {
  return {data};
}

function accumulatorStep(name: string, acc: unknown[] = []) {
  return {
    name,
    fn: async (ctx: PipelineContext) => {
      acc.push({name, input: ctx.input, prev: ctx.prev});
      return {data: `${name}-done`};
    },
    _acc: acc,
  };
}

function makeMockResponse() {
  const result: {content: unknown} = {content: undefined};
  return {
    result,
    setStructuredContent(content: unknown) {
      result.content = content;
    },
    appendResponseLine() {},
    setIncludePages() {},
    setIncludeNetworkRequests() {},
    setIncludeConsoleData() {},
    attachImage() {},
    attachNetworkRequest() {},
    attachConsoleMessage() {},
    setIncludeWebSocketConnections() {},
    attachWebSocket() {},
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('definePipeline', () => {
  describe('基础执行', () => {
    it('按顺序执行所有步骤', async () => {
      const received: string[] = [];
      const pipeline = definePipeline({
        name: 'seq_test',
        description: '顺序执行测试',
        annotations: {
          category: ToolCategory.REVERSE_ENGINEERING,
          readOnlyHint: true,
        },
        schema: {x: zod.number()},
        steps: [
          {
            name: 's1',
            fn: async () => {
              received.push('s1');
              return {data: 1};
            },
          },
          {
            name: 's2',
            fn: async () => {
              received.push('s2');
              return {data: 2};
            },
          },
          {
            name: 's3',
            fn: async () => {
              received.push('s3');
              return {data: 3};
            },
          },
        ],
      });

      const res = makeMockResponse();
      await pipeline.handler({params: {x: 42}}, res as any, {} as any);

      assert.deepEqual(received, ['s1', 's2', 's3']);
      const output = res.result.content as Record<string, unknown>;
      assert.equal(output.success, true);
    });

    it('步骤间共享上下文', async () => {
      const pipeline = definePipeline({
        name: 'context_test',
        description: '上下文传递测试',
        annotations: {
          category: ToolCategory.REVERSE_ENGINEERING,
          readOnlyHint: true,
        },
        schema: {url: zod.string()},
        steps: [
          {
            name: 'parse',
            fn: async ctx => ({data: String(ctx.input.url).toUpperCase()}),
          },
          {
            name: 'validate',
            fn: async ctx => {
              const parsed = ctx.prev?.data;
              return {data: typeof parsed === 'string' && parsed.length > 0};
            },
          },
        ],
      });

      const res = makeMockResponse();
      await pipeline.handler(
        {params: {url: 'https://example.com'}},
        res as any,
        {} as any,
      );

      const output = res.result.content as Record<string, unknown>;
      assert.equal(output.success, true);

      const steps = output.steps as Array<Record<string, unknown>>;
      // validate step received data from parse step
      const validateStep = steps.find(s => s.step === 'validate');
      assert.ok(validateStep);
      assert.equal(validateStep.status, 'ok');
    });

    it('返回结构化的输出', async () => {
      const pipeline = definePipeline({
        name: 'output_test',
        description: '输出测试',
        annotations: {
          category: ToolCategory.REVERSE_ENGINEERING,
          readOnlyHint: true,
        },
        schema: {},
        steps: [
          {name: 'a', fn: async () => ({data: 'hello'})},
          {name: 'b', fn: async () => ({data: 42})},
        ],
      });

      const res = makeMockResponse();
      await pipeline.handler({params: {}}, res as any, {} as any);

      const output = res.result.content as Record<string, unknown>;
      assert.equal(output.success, true);

      const summary = output.summary as Record<string, unknown>;
      assert.equal(summary.total, 2);
      assert.equal(summary.ok, 2);
      assert.equal(summary.failed, 0);
      assert.equal(summary.skipped, 0);
      assert.ok(typeof summary.totalDurationMs === 'number');

      const steps = output.steps as Array<Record<string, unknown>>;
      assert.equal(steps.length, 2);
      assert.equal(steps[0].step, 'a');
      assert.equal(steps[0].status, 'ok');
      assert.ok(typeof steps[0].durationMs === 'number');
    });

    it('步骤 fn 返回的额外字段合并到上下文', async () => {
      const pipeline = definePipeline({
        name: 'merge_test',
        description: '上下文合并测试',
        annotations: {
          category: ToolCategory.REVERSE_ENGINEERING,
          readOnlyHint: true,
        },
        schema: {},
        steps: [
          {
            name: 's1',
            fn: async () => ({data: 'v1', extraKey: 'merged'}),
          },
          {
            name: 's2',
            fn: async ctx => {
              return {
                data: (ctx as unknown as Record<string, unknown>).extraKey,
              };
            },
          },
        ],
      });

      const res = makeMockResponse();
      await pipeline.handler({params: {}}, res as any, {} as any);

      const output = res.result.content as Record<string, unknown>;
      assert.equal(output.success, true);
    });
  });

  describe('错误处理', () => {
    it('onError=fail 步骤抛出时立即终止', async () => {
      const received: string[] = [];
      const pipeline = definePipeline({
        name: 'fail_test',
        description: '失败测试',
        annotations: {
          category: ToolCategory.REVERSE_ENGINEERING,
          readOnlyHint: true,
        },
        schema: {},
        steps: [
          {
            name: 'good',
            fn: async () => {
              received.push('good');
              return {data: 'ok'};
            },
          },
          {
            name: 'bad',
            onError: 'fail',
            fn: async () => {
              throw new Error('step failed');
            },
          },
          {
            name: 'never_reached',
            fn: async () => {
              received.push('never');
              return {data: 'never'};
            },
          },
        ],
      });

      const res = makeMockResponse();
      await pipeline.handler({params: {}}, res as any, {} as any);

      assert.deepEqual(received, ['good']);
      const output = res.result.content as Record<string, unknown>;
      assert.equal(output.success, false);

      const steps = output.steps as Array<Record<string, unknown>>;
      const badStep = steps.find(s => s.step === 'bad');
      assert.ok(badStep);
      assert.equal(badStep.status, 'error');
      assert.ok((badStep.error as string)?.includes('step failed'));
    });

    it('onError=skip 步骤失败后继续执行', async () => {
      const received: string[] = [];
      const pipeline = definePipeline({
        name: 'skip_test',
        description: '跳过测试',
        annotations: {
          category: ToolCategory.REVERSE_ENGINEERING,
          readOnlyHint: true,
        },
        schema: {},
        steps: [
          {
            name: 'first',
            fn: async () => {
              received.push('first');
              return {data: 'ok'};
            },
          },
          {
            name: 'skipped',
            onError: 'skip',
            fn: async () => {
              throw new Error('optional failed');
            },
          },
          {
            name: 'after_skip',
            fn: async () => {
              received.push('after_skip');
              return {data: 'final'};
            },
          },
        ],
      });

      const res = makeMockResponse();
      await pipeline.handler({params: {}}, res as any, {} as any);

      assert.deepEqual(received, ['first', 'after_skip']);
      const output = res.result.content as Record<string, unknown>;
      assert.equal(output.success, false);

      const steps = output.steps as Array<Record<string, unknown>>;
      assert.equal(steps[1].step, 'skipped');
      assert.equal(steps[1].status, 'error');
      assert.equal(steps[2].step, 'after_skip');
      assert.equal(steps[2].status, 'ok');
    });

    it('onError=continue 步骤失败后继续且不标记错误', async () => {
      const received: string[] = [];
      const pipeline = definePipeline({
        name: 'continue_test',
        description: '忽略错误测试',
        annotations: {
          category: ToolCategory.REVERSE_ENGINEERING,
          readOnlyHint: true,
        },
        schema: {},
        steps: [
          {
            name: 'flaky',
            onError: 'continue',
            fn: async () => {
              throw new Error('non-fatal');
            },
          },
          {
            name: 'next',
            fn: async () => {
              received.push('next');
              return {data: 'done'};
            },
          },
        ],
      });

      const res = makeMockResponse();
      await pipeline.handler({params: {}}, res as any, {} as any);

      assert.deepEqual(received, ['next']);
    });
  });

  describe('重试机制', () => {
    it('step 失败时按 retry 次数重试', async () => {
      let attempts = 0;
      const pipeline = definePipeline({
        name: 'retry_test',
        description: '重试测试',
        annotations: {
          category: ToolCategory.REVERSE_ENGINEERING,
          readOnlyHint: true,
        },
        schema: {},
        steps: [
          {
            name: 'retry_me',
            retry: 2,
            fn: async () => {
              attempts++;
              if (attempts < 3) throw new Error(`attempt ${attempts}`);
              return {data: 'success'};
            },
          },
        ],
      });

      const res = makeMockResponse();
      await pipeline.handler({params: {}}, res as any, {} as any);

      assert.equal(attempts, 3);
      const output = res.result.content as Record<string, unknown>;
      assert.equal(output.success, true);

      const steps = output.steps as Array<Record<string, unknown>>;
      assert.equal(steps[0].status, 'ok');
      assert.equal(steps[0].retries, 2);
    });

    it('retry 耗尽后按 onError 策略处理', async () => {
      const pipeline = definePipeline({
        name: 'retry_exhausted_test',
        description: '重试耗尽测试',
        annotations: {
          category: ToolCategory.REVERSE_ENGINEERING,
          readOnlyHint: true,
        },
        schema: {},
        steps: [
          {
            name: 'never_succeeds',
            retry: 1,
            onError: 'skip',
            fn: async () => {
              throw new Error('always fail');
            },
          },
          {
            name: 'continues',
            fn: async () => ({data: 'ok'}),
          },
        ],
      });

      const res = makeMockResponse();
      await pipeline.handler({params: {}}, res as any, {} as any);

      const output = res.result.content as Record<string, unknown>;
      const steps = output.steps as Array<Record<string, unknown>>;
      assert.equal(steps[0].retries, 1);
      assert.equal(steps[0].status, 'error');
      assert.equal(steps[1].status, 'ok');
    });
  });

  describe('超时处理', () => {
    it('pipeline 超时后终止并报告', async () => {
      const pipeline = definePipeline({
        name: 'timeout_test',
        description: '超时测试',
        annotations: {
          category: ToolCategory.REVERSE_ENGINEERING,
          readOnlyHint: true,
        },
        schema: {},
        timeoutMs: 50,
        steps: [
          {
            name: 'slow',
            fn: async () => {
              await new Promise(r => setTimeout(r, 200));
              return {data: 'slow'};
            },
          },
        ],
      });

      const res = makeMockResponse();
      await pipeline.handler({params: {}}, res as any, {} as any);

      const output = res.result.content as Record<string, unknown>;
      assert.equal(output.success, false);
      assert.ok(
        ((output.fatalError as string) ?? '').includes('超时'),
        `Expected timeout message, got: ${String(output.fatalError)}`,
      );
    });
  });

  describe('when 条件步骤', () => {
    it('predicate 为 true 时执行步骤', async () => {
      let executed = false;
      const step = when(
        'conditional',
        ctx => String(ctx.input.runMe) === 'yes',
        {
          fn: async () => {
            executed = true;
            return {data: 'ran'};
          },
        },
      );

      const pipeline = definePipeline({
        name: 'when_test',
        description: '条件步骤测试',
        annotations: {
          category: ToolCategory.REVERSE_ENGINEERING,
          readOnlyHint: true,
        },
        schema: {runMe: zod.string()},
        steps: [step],
      });

      const res = makeMockResponse();
      await pipeline.handler({params: {runMe: 'yes'}}, res as any, {} as any);
      assert.ok(executed);

      const res2 = makeMockResponse();
      await pipeline.handler({params: {runMe: 'no'}}, res2 as any, {} as any);
      // data should be null (step skipped)
      const out2 = res2.result.content as Record<string, unknown>;
      const steps = out2.steps as Array<Record<string, unknown>>;
      assert.equal(steps[0].status, 'ok');
    });
  });

  describe('parallel 并行步骤', () => {
    it('并行执行多个子步骤', async () => {
      const order: string[] = [];
      const step = parallel('parallel_group', [
        {
          fn: async () => {
            await new Promise(r => setTimeout(r, 30));
            order.push('a');
            return {data: 'a'};
          },
        },
        {
          fn: async () => {
            order.push('b');
            return {data: 'b'};
          },
        },
      ]);

      const pipeline = definePipeline({
        name: 'parallel_test',
        description: '并行测试',
        annotations: {
          category: ToolCategory.REVERSE_ENGINEERING,
          readOnlyHint: true,
        },
        schema: {},
        steps: [step],
      });

      const res = makeMockResponse();
      await pipeline.handler({params: {}}, res as any, {} as any);

      // b should finish before a (no delay)
      assert.equal(order[0], 'b');
      assert.equal(order[1], 'a');

      const output = res.result.content as Record<string, unknown>;
      assert.equal(output.success, true);
    });

    it('并行步骤中某个子步骤失败的处理', async () => {
      const step = parallel(
        'mixed',
        [
          {
            fn: async () => ({data: 'ok'}),
          },
          {
            fn: async () => {
              throw new Error('sub-fail');
            },
          },
        ],
        {onError: 'skip'},
      );

      const pipeline = definePipeline({
        name: 'parallel_skip_test',
        description: '并行失败skip测试',
        annotations: {
          category: ToolCategory.REVERSE_ENGINEERING,
          readOnlyHint: true,
        },
        schema: {},
        steps: [step, {name: 'after', fn: async () => ({data: 'continues'})}],
      });

      const res = makeMockResponse();
      await pipeline.handler({params: {}}, res as any, {} as any);

      const output = res.result.content as Record<string, unknown>;
      const steps = output.steps as Array<Record<string, unknown>>;
      assert.equal(steps[1].status, 'ok');
    });
  });

  describe('与 ToolDefinition 兼容性', () => {
    it('definePipeline 返回有效的 ToolDefinition', () => {
      const pipeline = definePipeline({
        name: 'compat_test',
        aliases: ['ct'],
        description: '兼容性测试',
        annotations: {
          category: ToolCategory.REVERSE_ENGINEERING,
          readOnlyHint: false,
        },
        schema: {input: zod.string()},
        steps: [{name: 's1', fn: async () => ({data: 'ok'})}],
      });

      assert.equal(typeof pipeline.name, 'string');
      assert.equal(typeof pipeline.description, 'string');
      assert.ok(Array.isArray(pipeline.aliases));
      assert.equal(typeof pipeline.handler, 'function');
    });
  });

  describe('空步骤列表', () => {
    it('空 pipeline 正常完成', async () => {
      const pipeline = definePipeline({
        name: 'empty_test',
        description: '空 pipeline',
        annotations: {
          category: ToolCategory.REVERSE_ENGINEERING,
          readOnlyHint: true,
        },
        schema: {},
        steps: [],
      });

      const res = makeMockResponse();
      await pipeline.handler({params: {}}, res as any, {} as any);

      const output = res.result.content as Record<string, unknown>;
      assert.equal(output.success, true);

      const summary = output.summary as Record<string, unknown>;
      assert.equal(summary.total, 0);
    });
  });
});
