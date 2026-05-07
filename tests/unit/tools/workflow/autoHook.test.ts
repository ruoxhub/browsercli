/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 自动 Hook 工具单元测试
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  autoHook,
  type AutoHookToolData,
} from '../../../../src/tools/workflow/autoHook.js';

// 辅助函数：调用 autoHook 工具
async function callAutoHook(runtime: any, params: any): Promise<any> {
  let result: any = null;
  const response = {
    appendResponseLine: (line: string) => {},
    setStructuredContent: (content: unknown) => {
      result = content;
    },
  } as any;
  await autoHook.handler({params} as any, response, runtime);
  return result;
}

describe('autoHook tool', () => {
  describe('工具导出', () => {
    it('应该导出 autoHook 工具定义对象', () => {
      assert.strictEqual(typeof autoHook, 'object');
      assert.strictEqual(typeof autoHook.handler, 'function');
    });
  });

  describe('执行结果', () => {
    it('应该返回成功的执行结果', async () => {
      const result = await callAutoHook(null, {
        url: 'https://example.com',
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.message);
    });

    it('应该返回 Hook 注入记录', async () => {
      const result = await callAutoHook(null, {
        url: 'https://example.com',
        preset: 'api-signature',
        hookCrypto: true,
      });

      assert.ok(result.data);
      const data = result.data as AutoHookToolData;
      assert.strictEqual(data.url, 'https://example.com');
      assert.ok(Array.isArray(data.hooksInjected));
      assert.ok(Array.isArray(data.cryptoDetected));
    });

    it('应该处理错误情况', async () => {
      // 模拟错误场景
      const result = await callAutoHook(null, {
        url: 'https://example.com',
        preset: 'invalid-preset' as unknown as 'api-signature',
      });

      // 应该优雅地处理无效预设
      assert.ok(result.success || result.error);
    });

    it('autoInject=false 时应仅生成计划而不执行页面注入', async () => {
      let evaluateCalls = 0;
      const runtime = {
        getSelectedFrame: () => ({
          evaluate: async () => {
            evaluateCalls += 1;
          },
        }),
        getSelectedPage: () => ({
          url: () => 'https://example.com/runtime',
        }),
      };

      const result = await callAutoHook(runtime, {
        hookFetch: true,
        autoInject: false,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(evaluateCalls, 0);
      assert.ok(result.message?.includes('未注入页面'));
      assert.strictEqual(result.data?.hooksInjected[0]?.injected, false);
    });

    it('autoInject=true 时应对选中 frame 执行真实注入', async () => {
      const injectedScripts: string[] = [];
      const runtime = {
        getSelectedFrame: () => ({
          evaluate: async (script: string) => {
            injectedScripts.push(script);
          },
        }),
        getSelectedPage: () => ({
          url: () => 'https://example.com/runtime',
        }),
      };

      const result = await callAutoHook(runtime, {
        hookFetch: true,
        hookCookie: true,
        autoInject: true,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(injectedScripts.length, 2);
      assert.ok(
        injectedScripts.some(script => script.includes('hook_fetch_auto')),
      );
      assert.ok(
        injectedScripts.some(script => script.includes('hook_cookie_auto')),
      );
      assert.ok(
        injectedScripts.some(
          script =>
            script.includes('window.__hookStore') &&
            script.includes("event: 'installed'"),
        ),
      );
      assert.ok(
        injectedScripts.some(
          script =>
            script.includes("type: 'fetch'") &&
            script.includes("target: 'window.fetch'"),
        ),
      );
      assert.ok(
        injectedScripts.some(
          script =>
            script.includes('hook_cookie_auto') &&
            script.includes("event: 'missing'") &&
            script.includes("target: 'Document.cookie'"),
        ),
      );
      assert.ok(result.message?.includes('实际注入 2 个 Hook'));
      assert.strictEqual(
        result.data?.hooksInjected.every((item: any) => item.injected === true),
        true,
      );
    });

    it('timer/eval 自动注入脚本也应写入 __hookStore', async () => {
      const injectedScripts: string[] = [];
      const runtime = {
        getSelectedFrame: () => ({
          evaluate: async (script: string) => {
            injectedScripts.push(script);
          },
        }),
        getSelectedPage: () => ({
          url: () => 'https://example.com/runtime',
        }),
      };

      const result = await callAutoHook(runtime, {
        hookTimers: true,
        hookEval: true,
        autoInject: true,
      });

      assert.strictEqual(result.success, true);
      assert.ok(
        injectedScripts.some(
          script =>
            script.includes('hook_timers_auto') &&
            script.includes('window.__hookStore') &&
            script.includes("type: 'timer'"),
        ),
      );
      assert.ok(
        injectedScripts.some(
          script =>
            script.includes('hook_eval_auto') &&
            script.includes('window.__hookStore') &&
            script.includes("target: 'window.eval'"),
        ),
      );
    });

    it('crypto/rsa/smcrypto 自动注入脚本也应写入 __hookStore', async () => {
      const injectedScripts: string[] = [];
      const runtime = {
        getSelectedFrame: () => ({
          evaluate: async (script: string) => {
            injectedScripts.push(script);
          },
        }),
        getSelectedPage: () => ({
          url: () => 'https://example.com/runtime',
        }),
      };

      const result = await callAutoHook(runtime, {
        hookCrypto: true,
        hookRsa: true,
        hookSmCrypto: true,
        autoInject: true,
      });

      assert.strictEqual(result.success, true);
      assert.ok(
        injectedScripts.some(
          script =>
            script.includes('hook_cryptojs_auto') &&
            script.includes('window.__hookStore') &&
            script.includes("type: 'cryptojs'") &&
            script.includes("target: 'window.CryptoJS'"),
        ),
      );
      assert.ok(
        injectedScripts.some(
          script =>
            script.includes('hook_jsencrypt_auto') &&
            script.includes('window.__hookStore') &&
            script.includes("type: 'jsencrypt'") &&
            script.includes("target: 'window.JSEncrypt'"),
        ),
      );
      assert.ok(
        injectedScripts.some(
          script =>
            script.includes('hook_smcrypto_auto') &&
            script.includes('window.__hookStore') &&
            script.includes("type: 'smcrypto'") &&
            script.includes("target: 'window.sm*'"),
        ),
      );
    });
  });

  describe('预设配置', () => {
    it('应该支持 api-signature 预设', async () => {
      const result = await callAutoHook(null, {
        url: 'https://example.com',
        preset: 'api-signature',
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 network-core 预设', async () => {
      const result = await callAutoHook(null, {
        url: 'https://example.com',
        preset: 'network-core',
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 none 预设', async () => {
      const result = await callAutoHook(null, {
        url: 'https://example.com',
        preset: 'none',
      });

      assert.strictEqual(result.success, true);
    });
  });

  describe('加密库 Hook', () => {
    it('应该支持 hookCrypto 选项', async () => {
      const result = await callAutoHook(null, {
        url: 'https://example.com',
        hookCrypto: true,
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 hookRsa 选项', async () => {
      const result = await callAutoHook(null, {
        url: 'https://example.com',
        hookRsa: true,
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 hookSmCrypto 选项', async () => {
      const result = await callAutoHook(null, {
        url: 'https://example.com',
        hookSmCrypto: true,
      });

      assert.strictEqual(result.success, true);
    });
  });

  describe('基础 Hook', () => {
    it('应该支持 hookTimers 选项', async () => {
      const result = await callAutoHook(null, {
        url: 'https://example.com',
        hookTimers: true,
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 hookEval 选项', async () => {
      const result = await callAutoHook(null, {
        url: 'https://example.com',
        hookEval: true,
      });

      assert.strictEqual(result.success, true);
    });

    it('应该支持 hookCookie 选项', async () => {
      const result = await callAutoHook(null, {
        url: 'https://example.com',
        hookCookie: true,
      });

      assert.strictEqual(result.success, true);
    });
  });

  describe('Hook 报告生成', () => {
    it('应该生成包含所有注入 Hook 的报告', async () => {
      const result = await callAutoHook(null, {
        url: 'https://example.com',
        preset: 'network-core',
        hookCrypto: true,
        hookTimers: true,
        hookCookie: true,
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.data);
      const data = result.data as AutoHookToolData;

      // 验证报告包含所有注入的 Hook
      assert.ok(data.hooksInjected.length >= 3, '应该包含多个 Hook 注入记录');
    });
  });
});
