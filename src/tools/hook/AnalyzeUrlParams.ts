/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {buildHookStoreRuntime} from './store-utils.js';

/**
 * 分析 URL 参数构建过程：hook URL 构造函数和 URLSearchParams。
 */
export const analyzeUrlParams = defineTool({
  name: 'analyze_url_params',
  description:
    'Inject hooks to intercept URL constructor and URLSearchParams, recording all URL construction processes. Useful for analyzing how URLs and query parameters are built dynamically.',
  annotations: {
    title: '分析 URL 参数',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    urlFilter: zod
      .string()
      .optional()
      .describe('只捕获包含此字符串的 URL（子串匹配）'),
    captureStack: zod
      .boolean()
      .optional()
      .describe('是否记录调用栈'),
  },
  handler: async (request, response, context) => {
    const {urlFilter, captureStack} = request.params;
    const frame = (context as Context).getSelectedFrame();

    const hookCode = `
(function() {
  'use strict';
  const urlFilter = ${JSON.stringify(urlFilter ?? '')};
  const captureStack = ${JSON.stringify(!!captureStack)};
  const OrigURL = window.URL;
  const OrigURLSearchParams = window.URLSearchParams;
${buildHookStoreRuntime({
  hookId: 'analyze_url_params',
  type: 'url',
  target: 'URL constructor',
  showStack: captureStack,
  triggerDebugger: false,
})}

  function shouldCapture(urlStr) {
    if (!urlFilter) return true;
    return String(urlStr).includes(urlFilter);
  }

  function extractSearchParams(searchParams) {
    const result = {};
    try {
      for (const [key, value] of searchParams.entries()) {
        if (result[key] === undefined) {
          result[key] = value;
        } else if (Array.isArray(result[key])) {
          result[key].push(value);
        } else {
          result[key] = [result[key], value];
        }
      }
    } catch {}
    return result;
  }

  // Hook URL constructor
  window.URL = function URL(url, base) {
    const instance = base ? new OrigURL(url, base) : new OrigURL(url);
    const urlStr = instance.href;
    if (shouldCapture(urlStr)) {
      __pushHookRecord({
        event: 'url_construct',
        url: urlStr,
        input: String(url),
        base: base ? String(base) : undefined,
        searchParams: extractSearchParams(instance.searchParams),
      });
    }
    return instance;
  };
  window.URL.prototype = OrigURL.prototype;
  window.URL.createObjectURL = OrigURL.createObjectURL?.bind(OrigURL);
  window.URL.revokeObjectURL = OrigURL.revokeObjectURL?.bind(OrigURL);

  // Hook URLSearchParams mutation methods
  const methods = ['append', 'set', 'delete'];
  methods.forEach(function(method) {
    const orig = OrigURLSearchParams.prototype[method];
    OrigURLSearchParams.prototype[method] = function(name, value) {
      const result = orig.apply(this, arguments);
      const urlStr = this.toString();
      if (shouldCapture(urlStr)) {
        __pushHookRecord({
          event: 'searchparams_' + method,
          key: String(name),
          value: value !== undefined ? String(value) : undefined,
          searchParams: extractSearchParams(this),
        });
      }
      return result;
    };
  });

  console.log('[analyze_url_params] ✅ URL hooks installed');
})();
`;

    try {
      await frame.evaluate(hookCode);

      let recordCount = 0;
      try {
        recordCount = (await frame.evaluate(() => {
          const store = (window as any).__hookStore;
          if (!store) return 0;
          const records = store['analyze_url_params'];
          return Array.isArray(records) ? records.length : 0;
        })) as number;
      } catch {
        // 状态读取失败不影响主流程
      }

      getRuntime().hookManager.registerHook({
        hookId: 'analyze_url_params',
        type: 'url',
        description: 'URL Params Analysis Hook',
        script: hookCode,
      });

      response.setStructuredContent({
        success: true,
        message:
          `URL 参数分析 Hook 已注入。当前已捕获 ${recordCount} 条记录。` +
          (recordCount === 0
            ? ' 请触发页面中的 URL 构建操作以开始捕获。'
            : ''),
        tooltype: 'analyze_url_params',
        data: {
          hookId: 'analyze_url_params',
          status: 'active',
          recordCount,
          note: '后续 URL 构建和 URLSearchParams 操作将被自动捕获并存储在 window.__hookStore.analyze_url_params',
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `URL 参数分析 Hook 注入失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'analyze_url_params',
        data: {
          hookId: 'analyze_url_params',
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  },
});
