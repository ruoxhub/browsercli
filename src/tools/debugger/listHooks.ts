/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import {evaluateInPageRuntime} from './evaluateInPageRuntime.js';
import type {HookEntry, ListHooksResult} from './types.js';

/**
 * 列出当前页面所有已安装的 Hook。
 *
 * @param frame - Puppeteer Frame 对象
 * @returns 结构化结果对象，data 包含 Hook 列表
 */
export async function listHooks(frame: Frame): Promise<ListHooksResult> {
  try {
    const hooks = (await evaluateInPageRuntime<
      Array<{id: string; target: string}>
    >(
      frame,
      `
(function() {
  if (!window.__mcp_hooks__) return [];
  return Object.keys(window.__mcp_hooks__).map(id => {
    const hook = window.__mcp_hooks__[id];
    return { id, target: hook.obj.constructor.name + '.' + hook.methodName };
  });
})()
`,
    )) as Array<{id: string; target: string}>;

    if (!hooks || hooks.length === 0) {
      return {
        success: true,
        message: '当前没有已安装的 Hook',
        tooltype: 'list_hooks',
        data: [],
      };
    }

    const entries: HookEntry[] = hooks.map(h => ({
      id: h.id,
      target: h.target,
    }));

    return {
      success: true,
      message: `找到 ${entries.length} 个活跃 Hook`,
      tooltype: 'list_hooks',
      logFormat: 'json',
      data: entries,
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'list_hooks',
    };
  }
}
