/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {strict as assert} from 'node:assert';
import {describe, it, mock} from 'node:test';

import type {Frame} from '../../../src/third_party/index.js';

import {
  bypassDebugger as toolBypassDebugger,
  antiAntiDebug as toolAntiAntiDebug,
} from '../../../src/tools/anti-debug/index.js';
import type {BypassTarget, AntiAntiDebugFeature} from '../../../src/tools/anti-debug/types.js';

function wrapAntiDebugTool(tool: any, paramNames: string[]) {
  return async (frame: any, ...args: any[]) => {
    const params: Record<string, any> = {};
    paramNames.forEach((name, i) => {
      if (args[i] !== undefined) {
        params[name] = args[i];
      }
    });
    const request = { params };
    let responseText = '';
    const response = {
      appendResponseLine(line: string) {
        responseText += line + '\n';
      }
    };
    const context = {
      getSelectedFrame: () => frame
    };
    await tool.handler(request as any, response as any, context as any);
    const jsonMatch = responseText.match(/```json\s+([\s\S]*?)\s+```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (e) {
        throw new Error('Failed to parse JSON response: ' + jsonMatch[1]);
      }
    }
    throw new Error('No JSON block found in response');
  };
}

const bypassDebugger = wrapAntiDebugTool(toolBypassDebugger, ['targets']);
const antiAntiDebug = wrapAntiDebugTool(toolAntiAntiDebug, ['features']);

function createErrorFrame(errorMsg: string): Frame {
  return {
    evaluate: async () => {
      throw new Error(errorMsg);
    },
  } as unknown as Frame;
}

describe('anti-debug functions', () => {
  describe('bypassDebugger', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await bypassDebugger(frame);

      assert.strictEqual(evaluate.mock.callCount(), 1);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'bypass_debugger');
    });

    it('应该支持自定义 targets 参数', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;
      const targets: BypassTarget[] = ['eval', 'Function'];

      const result = await bypassDebugger(frame, targets);

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('eval'));
      assert.ok(result.message.includes('Function'));
    });

    it('应该在 evaluate 抛出错误时返回失败结果', async () => {
      const frame = createErrorFrame('注入失败');

      const result = await bypassDebugger(frame);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.tooltype, 'bypass_debugger');
      assert.ok(result.message.includes('注入失败'));
    });
  });

  describe('antiAntiDebug', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;
      const features: AntiAntiDebugFeature[] = ['fixedWindowSize', 'preventClose'];

      const result = await antiAntiDebug(frame, features);

      assert.strictEqual(evaluate.mock.callCount(), 1);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'anti_anti_debug');
    });

    it('应该支持所有功能特性', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;
      const features: AntiAntiDebugFeature[] = [
        'fixedWindowSize',
        'fixedTime',
        'preventClose',
        'preventHistoryBack',
        'preventConsoleClear',
        'hideWebdriver',
      ];

      const result = await antiAntiDebug(frame, features);

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('6'));
    });

    it('应该在 evaluate 抛出错误时返回失败结果', async () => {
      const frame = createErrorFrame('Anti-debug 注入失败');

      const result = await antiAntiDebug(frame, ['fixedWindowSize']);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.tooltype, 'anti_anti_debug');
    });
  });
});
