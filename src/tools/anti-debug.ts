/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {type Frame, zod} from '../third_party/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';

import {ToolCategory} from './categories.js';
import type {DomainManifest} from './manifest.js';
import {getErrorMessage} from './shared/pageResponse.js';
import type {MessagesResult} from './shared/types.js';
import {type Context, definePageTool, type Response} from './ToolDefinition.js';

// ─── types.ts ────────────────────────────────────────────

/**
 * Anti-Debug 函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface HookResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat?: string;
}

/** Bypass Debugger 目标 */
export type BypassTarget = 'eval' | 'Function' | 'constructor';

/** Anti-Anti-Debug 功能特性 */
export type AntiAntiDebugFeature =
  | 'fixedWindowSize'
  | 'fixedTime'
  | 'preventClose'
  | 'preventHistoryBack'
  | 'preventConsoleClear'
  | 'hideWebdriver';

export type {Frame};

// ─── hooks.ts ────────────────────────────────────────────

/** 浏览器端 hook 共用的命名空间前缀 */
const HOOK_TAG = 'anti_anti_debug';

/** anti_anti_debug 启用的窗口尺寸默认值 */
const DEFAULT_INNER_WIDTH = 1366;

const DEFAULT_INNER_HEIGHT = 660;

const DEFAULT_OUTER_WIDTH = 1400;

const DEFAULT_OUTER_HEIGHT = 760;

/**
 * 固定窗口尺寸的 hook。
 */
const FIXED_WINDOW_SIZE_HOOK = `
(function() {
  'use strict';
  Object.defineProperties(window, {
    innerWidth: { value: ${DEFAULT_INNER_WIDTH}, writable: false, configurable: true },
    innerHeight: { value: ${DEFAULT_INNER_HEIGHT}, writable: false, configurable: true },
    outerWidth: { value: ${DEFAULT_OUTER_WIDTH}, writable: false, configurable: true },
    outerHeight: { value: ${DEFAULT_OUTER_HEIGHT}, writable: false, configurable: true },
  });
  console.log('[${HOOK_TAG}] ✅ Fixed window size');
})();
`;

/**
 * 固定 Date.now / performance.now 的 hook。
 */
const FIXED_TIME_HOOK = `
(function() {
  'use strict';
  if (typeof performance !== 'undefined' && performance.now) {
    performance.now = () => 0;
    console.log('[${HOOK_TAG}] ✅ Fixed performance.now()');
  }
  Date.now = () => 0;
  console.log('[${HOOK_TAG}] ✅ Fixed Date.now()');
})();
`;

/**
 * 阻止 window.close 的 hook。
 */
const PREVENT_CLOSE_HOOK = `
(function() {
  'use strict';
  window.close = function() {
    console.log('[${HOOK_TAG}] ⛔ Blocked: window.close()');
  };
  console.log('[${HOOK_TAG}] ✅ Blocked window.close');
})();
`;

/**
 * 阻止 history.back / history.go 的 hook。
 */
const PREVENT_HISTORY_BACK_HOOK = `
(function() {
  'use strict';
  const originalHistory = window.history;
  originalHistory.back = function() {
    console.log('[${HOOK_TAG}] ⛔ Blocked: history.back()');
  };
  originalHistory.go = function() {
    console.log('[${HOOK_TAG}] ⛔ Blocked: history.go()');
  };
  console.log('[${HOOK_TAG}] ✅ Blocked history navigation');
})();
`;

/**
 * 阻止 console.clear 的 hook。
 */
const PREVENT_CONSOLE_CLEAR_HOOK = `
(function() {
  'use strict';
  console.clear = function() {
    console.log('[${HOOK_TAG}] ⛔ Blocked: console.clear()');
  };
  console.log('[${HOOK_TAG}] ✅ Blocked console.clear');
})();
`;

/**
 * 隐藏 navigator.webdriver 的 hook。
 */
const HIDE_WEBDRIVER_HOOK = `
(function() {
  'use strict';
  if (navigator.webdriver !== undefined) {
    Object.defineProperty(navigator, 'webdriver', {
      get: function() { return false; },
      configurable: true
    });
    console.log('[${HOOK_TAG}] ✅ Hidden navigator.webdriver');
  }
})();
`;

/** 特性 → 浏览器端 hook 脚本 的映射。 */
const ANTI_ANTI_DEBUG_HOOKS: Record<AntiAntiDebugFeature, string> = {
  fixedWindowSize: FIXED_WINDOW_SIZE_HOOK,
  fixedTime: FIXED_TIME_HOOK,
  preventClose: PREVENT_CLOSE_HOOK,
  preventHistoryBack: PREVENT_HISTORY_BACK_HOOK,
  preventConsoleClear: PREVENT_CONSOLE_CLEAR_HOOK,
  hideWebdriver: HIDE_WEBDRIVER_HOOK,
};

/**
 * 将勾选的 anti_anti_debug 特性拼接成一段可在页面执行的脚本。
 */
export function buildAntiAntiDebugScript(
  features: readonly AntiAntiDebugFeature[],
): string {
  return features.map(feature => ANTI_ANTI_DEBUG_HOOKS[feature]).join('\n');
}

/**
 * bypass_debugger 注入脚本：移除 eval/Function/constructor 字符串中的 `debugger` 关键字。
 */
export function buildBypassDebuggerScript(
  targets: readonly BypassTarget[],
): string {
  const mutableTargets: BypassTarget[] = [...targets];
  return `
(function() {
  'use strict';

  const targets = ${JSON.stringify(mutableTargets)};
  const hookId = 'bypass_debugger';

  if (targets.includes('eval')) {
    const originalEval = window.eval;
    window.eval = function() {
      if (typeof arguments[0] === 'string') {
        arguments[0] = arguments[0].replaceAll(/debugger/g, '');
      }
      return originalEval.apply(this, arguments);
    };
    console.log('[' + hookId + '] ✅ Hooked: window.eval');
  }

  if (targets.includes('Function')) {
    const originalFunction = Function;
    function BypassedFunction() {
      for (let i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === 'string') {
          arguments[i] = arguments[i].replaceAll(/debugger/g, '');
        }
      }
      return originalFunction.apply(this, arguments);
    }
    BypassedFunction.prototype = originalFunction.prototype;
    // 兼容通过 window.Function 调用的场景
    Object.setPrototypeOf(BypassedFunction, originalFunction);
    window.Function = BypassedFunction;
    console.log('[' + hookId + '] ✅ Hooked: Function');
  }

  if (targets.includes('constructor')) {
    const originalFunction = Function;
    function BypassedConstructor() {
      for (let i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === 'string') {
          arguments[i] = arguments[i].replaceAll(/debugger/g, '');
        }
      }
      return originalFunction.apply(this, arguments);
    }
    BypassedConstructor.prototype = Function.prototype;
    Function.prototype.constructor = BypassedConstructor;
    console.log('[' + hookId + '] ✅ Hooked: Function.prototype.constructor');
  }

  console.log('[' + hookId + '] ✅ All debugger bypass hooks installed');
})();
`;
}

// ─── result.ts ───────────────────────────────────────────

/**
 * 包装一个异步工具调用，统一处理成功 / 失败结构化响应。
 *
 * 行为契约：与早期手写 try/catch 完全一致 —— 只调用 `setStructuredContent`，
 * 不会向响应行写入 JSON 文本。
 */
export async function runHook(
  response: Response,
  tooltype: string,
  action: () => Promise<string>,
): Promise<void> {
  try {
    const message = await action();
    response.setStructuredContent({
      success: true,
      message,
      tooltype,
      data: null,
    } satisfies HookResult);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error;
    throw createToolError(
      ErrorCodes.RUNTIME,
      `错误：${getErrorMessage(error)}`,
      {toolName: tooltype},
    );
  }
}

// ─── schema.ts ───────────────────────────────────────────

/** anti_anti_debug 工具的统一标识，避免在多处硬编码字面量。 */
export const ANTI_ANTI_DEBUG_TOOLTYPE = 'anti_anti_debug';

/** bypass_debugger 工具的统一标识。 */
export const BYPASS_DEBUGGER_TOOLTYPE = 'bypass_debugger';

/** Anti-Anti-Debug 工具接收的特性枚举。 */
export const antiAntiDebugFeatureSchema = zod.enum([
  'fixedWindowSize',
  'fixedTime',
  'preventClose',
  'preventHistoryBack',
  'preventConsoleClear',
  'hideWebdriver',
]) satisfies zod.ZodType<AntiAntiDebugFeature>;

/** Bypass Debugger 工具接收的目标枚举。 */
export const bypassTargetSchema = zod.enum([
  'eval',
  'Function',
  'constructor',
]) satisfies zod.ZodType<BypassTarget>;

/** Bypass Debugger 的默认目标：覆盖全部三类入口。 */
export const DEFAULT_BYPASS_TARGETS: readonly BypassTarget[] = [
  'eval',
  'Function',
  'constructor',
];

// ─── antiAntiDebug.ts ────────────────────────────────────

/** 默认启用全部反反调试特性（在 features 未显式传入时使用）。 */
const ALL_ANTI_ANTI_DEBUG_FEATURES: AntiAntiDebugFeature[] = [
  'fixedWindowSize',
  'fixedTime',
  'preventClose',
  'preventHistoryBack',
  'preventConsoleClear',
  'hideWebdriver',
];

/**
 * 反反调试工具集：窗口尺寸/时间函数/页面关闭/历史跳转/控制台清除/隐藏 webdriver。
 */
export const antiAntiDebug = definePageTool({
  name: 'anti_anti_debug',
  description:
    '反反调试工具集：固定窗口尺寸、冻结时间、阻止页面关闭、阻止历史导航、阻止控制台清除、隐藏 webdriver 标记。',
  annotations: {
    title: 'Anti Anti-Debug',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    features: zod
      .array(antiAntiDebugFeatureSchema)
      .optional()
      .describe(
        '要启用的功能。可选：fixedWindowSize、fixedTime、preventClose、preventHistoryBack、preventConsoleClear、hideWebdriver。省略时启用全部。',
      ),
  },
  handler: async (request, response, context) => {
    const features = request.params.features ?? ALL_ANTI_ANTI_DEBUG_FEATURES;

    await runHook(response, ANTI_ANTI_DEBUG_TOOLTYPE, async () => {
      const frame = (context as Context).getSelectedFrame();
      await frame.evaluate(buildAntiAntiDebugScript(features));
      return `Anti-Anti-Debug 已安装，启用功能：${features.join(', ')}（共 ${features.length} 项）`;
    });
  },
});

// ─── bypassDebugger.ts ───────────────────────────────────

/**
 * 绕过无限 debugger：自动移除 eval/Function/constructor 中的 debugger 关键字。
 */
export const bypassDebugger = definePageTool({
  name: 'bypass_debugger',
  description:
    '通过移除 eval/Function/constructor 中的 debugger 关键字来绕过无限 debugger 语句。',
  annotations: {
    title: 'Bypass Debugger',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    targets: zod
      .array(bypassTargetSchema)
      .optional()
      .describe(
        '要 Hook 的目标，默认为全部：["eval", "Function", "constructor"]。',
      ),
  },
  handler: async (request, response, context) => {
    const targets: readonly BypassTarget[] =
      request.params.targets ?? DEFAULT_BYPASS_TARGETS;

    await runHook(response, BYPASS_DEBUGGER_TOOLTYPE, async () => {
      const frame = (context as Context).getSelectedFrame();
      await frame.evaluate(buildBypassDebuggerScript(targets));
      return `Bypass Debugger 已安装，Hook 目标：${targets.join(', ')}`;
    });
  },
});

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'anti-debug',
  description: 'Anti-debugging detection and bypass tools.',
  profile: 'full',
  tools: [
    {modulePath: './anti-debug.js', handlerName: 'antiAntiDebug'},
    {
      modulePath: './anti-debug.js',
      handlerName: 'bypassDebugger',
    },
  ],
} satisfies DomainManifest;
