/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {strict as assert} from 'node:assert';
import {describe, it, mock} from 'node:test';

import type {Frame} from '../../../src/third_party/index.js';

import {
  hookXhrOpen,
  hookXhrSetRequestHeader,
  hookFetch,
  hookCookie,
  hookWebSocket,
  hookJsonParse,
  hookJsonStringify,
  hookLocalStorage,
  hookSessionStorage,
  hookDateNow,
  hookPerformanceNow,
  hookRandom,
  hookPromise,
  hookHistory,
  hookHistoryGo,
  hookLocationHref,
  hookClose,
  hookConsoleLog,
  hookConsoleClear,
  hookConsoleProtect,
  hookConsoleTable,
  fixedWindowSize,
  antiAntiHook,
} from '../../../src/tools/hook/index.js';
import type {
  StorageAction,
  ConsoleProtectMode,
} from '../../../src/tools/hook/types.js';

function createErrorFrame(errorMsg: string): Frame {
  return {
    evaluate: async () => {
      throw new Error(errorMsg);
    },
  } as unknown as Frame;
}

describe('hook functions', () => {
  describe('hookXhrOpen', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookXhrOpen(frame);

      assert.strictEqual(evaluate.mock.callCount(), 1);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_xhr_open');
    });

    it('应该支持 filterUrls 参数', async () => {
      let injectedScript = '';
      const evaluate = mock.fn(async (script: unknown) => {
        injectedScript = String(script);
      });
      const frame = {evaluate} as unknown as Frame;

      const result = await hookXhrOpen(frame, ['api.example.com']);

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('api.example.com'));
      assert.match(injectedScript, /__hookStore/);
      assert.match(injectedScript, /hook_xhr_open/);
    });

    it('应该在 evaluate 抛出错误时返回失败结果', async () => {
      const frame = createErrorFrame('注入失败');

      const result = await hookXhrOpen(frame);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.tooltype, 'hook_xhr_open');
      assert.ok(result.message.includes('注入失败'));
    });
  });

  describe('hookFetch', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      let injectedScript = '';
      const evaluate = mock.fn(async (script: unknown) => {
        injectedScript = String(script);
      });
      const frame = {evaluate} as unknown as Frame;

      const result = await hookFetch(frame);

      assert.strictEqual(evaluate.mock.callCount(), 1);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_fetch');
      assert.match(injectedScript, /__hookStore/);
      assert.match(injectedScript, /__pushHookRecord/);
    });

    it('应该在 evaluate 抛出错误时返回失败结果', async () => {
      const frame = createErrorFrame('Fetch 注入失败');

      const result = await hookFetch(frame);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.tooltype, 'hook_fetch');
    });
  });

  describe('hookCookie', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      let injectedScript = '';
      const evaluate = mock.fn(async (script: unknown) => {
        injectedScript = String(script);
      });
      const frame = {evaluate} as unknown as Frame;

      const result = await hookCookie(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_cookie');
    });

    it('应该支持 filterKeys 参数', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookCookie(frame, ['token']);

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('token'));
    });
  });

  describe('hookWebSocket', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookWebSocket(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_websocket');
    });
  });

  describe('hookJsonParse', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookJsonParse(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_json_parse');
    });
  });

  describe('hookJsonStringify', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookJsonStringify(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_json_stringify');
    });
  });

  describe('hookLocalStorage', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookLocalStorage(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_local_storage');
    });

    it('应该支持自定义 actions 参数', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;
      const actions: StorageAction[] = ['setItem', 'getItem'];

      const result = await hookLocalStorage(frame, actions);

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('setItem'));
    });
  });

  describe('hookSessionStorage', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookSessionStorage(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_session_storage');
    });
  });

  describe('hookDateNow', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookDateNow(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_date_now');
    });

    it('应该支持自定义 fixedValue 参数', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookDateNow(frame, 1234567890);

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('1234567890'));
    });
  });

  describe('hookPerformanceNow', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookPerformanceNow(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_performance_now');
    });
  });

  describe('hookRandom', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookRandom(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_random');
    });
  });

  describe('hookPromise', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookPromise(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_promise');
    });
  });

  describe('hookHistory', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookHistory(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_history');
    });
  });

  describe('hookHistoryGo', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      let injectedScript = '';
      const evaluate = mock.fn(async (script: unknown) => {
        injectedScript = String(script);
      });
      const frame = {evaluate} as unknown as Frame;

      const result = await hookHistoryGo(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_history_go');
      assert.match(injectedScript, /go_blocked/);
      assert.match(injectedScript, /__hookStore/);
    });
  });

  describe('hookLocationHref', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      let injectedScript = '';
      const evaluate = mock.fn(async (script: unknown) => {
        injectedScript = String(script);
      });
      const frame = {evaluate} as unknown as Frame;

      const result = await hookLocationHref(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_location_href');
    });
  });

  describe('hookClose', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookClose(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_close');
    });
  });

  describe('hookConsoleLog', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookConsoleLog(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_console_log');
    });

    it('应该支持不同模式', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const modes: ConsoleProtectMode[] = ['proxy', 'toString', 'freeze'];
      for (const mode of modes) {
        const result = await hookConsoleLog(frame, mode);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.tooltype, 'hook_console_log');
      }
    });
  });

  describe('hookConsoleClear', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookConsoleClear(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_console_clear');
    });
  });

  describe('hookConsoleProtect', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      let injectedScript = '';
      const evaluate = mock.fn(async (script: unknown) => {
        injectedScript = String(script);
      });
      const frame = {evaluate} as unknown as Frame;

      const result = await hookConsoleProtect(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_console_protect');
      assert.match(injectedScript, /overwrite_blocked/);
    });
  });

  describe('hookConsoleTable', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      let injectedScript = '';
      const evaluate = mock.fn(async (script: unknown) => {
        injectedScript = String(script);
      });
      const frame = {evaluate} as unknown as Frame;

      const result = await hookConsoleTable(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'hook_console_table');
    });

    it('应该支持 enabled=false', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await hookConsoleTable(frame, false);

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('禁用'));
    });
  });

  describe('fixedWindowSize', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      let injectedScript = '';
      const evaluate = mock.fn(async (script: unknown) => {
        injectedScript = String(script);
      });
      const frame = {evaluate} as unknown as Frame;

      const result = await fixedWindowSize(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'fixed_window_size');
      assert.match(injectedScript, /__hookStore/);
      assert.match(injectedScript, /innerHeight/);
    });

    it('应该支持自定义尺寸参数', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await fixedWindowSize(frame, 800, 1920, 900, 1960);

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('800'));
      assert.ok(result.message.includes('1920'));
    });
  });

  describe('antiAntiHook', () => {
    it('应该调用 frame.evaluate 并返回成功结果', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await antiAntiHook(frame);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'anti_anti_hook');
    });

    it('应该支持 hookedMethods 参数', async () => {
      const evaluate = mock.fn(async () => undefined);
      const frame = {evaluate} as unknown as Frame;

      const result = await antiAntiHook(frame, ['console.table']);

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('1'));
    });
  });
});
