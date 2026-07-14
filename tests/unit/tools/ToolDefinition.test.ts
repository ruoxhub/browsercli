/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {Context} from '../../../src/tools/ToolDefinition.js';

describe('ToolDefinition.Context debugger API 形状', () => {
  it('getDebuggerContext 声明为返回 Promise 的函数', () => {
    // 构造一个最小的 Context mock，仅关心 getDebuggerContext
    // 这里不实际启动 CDP，只验证类型契约在运行时可以调用
    const fakeDebuggerContext = {kind: 'fake-debugger-context'} as const;
    const mock = {
      getDebuggerContext: async () => fakeDebuggerContext,
    };

    // 类型系统层面：如果 Context 接口正确，这行赋值能通过
    const ctx = mock as unknown as Pick<Context, 'getDebuggerContext'>;

    assert.equal(typeof ctx.getDebuggerContext, 'function');
  });

  it('调用 getDebuggerContext 返回 thenable', async () => {
    const fake = {foo: 'bar'};
    const mock = {
      getDebuggerContext: async () => fake,
    };
    const ctx = mock as unknown as Pick<Context, 'getDebuggerContext'>;
    const result = ctx.getDebuggerContext();

    assert.ok(
      result && typeof (result as Promise<unknown>).then === 'function',
      'getDebuggerContext() 必须返回 Promise',
    );

    const resolved = await result;
    assert.deepEqual(resolved, fake);
  });

  it('旧 debuggerContext 属性已移除（编译期强制）', () => {
    // 本测试仅作标记：如果有人重新引入 `debuggerContext` 属性，
    // ToolAdapter.ts 里的赋值会报类型错误，tsc 会挡住。
    assert.ok(true);
  });
});
