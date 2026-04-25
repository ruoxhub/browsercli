/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame, JSHandle} from '../../third_party/index.js';

/** Script 操作统一返回结构 */
export interface ScriptResult {
  success: boolean;
  message: string;
  tooltype: string;
  logFormat?: string;
}

/** 执行脚本参数 */
export interface EvaluateScriptParams {
  functionCode: string;
}

/** 执行脚本结果 */
export interface EvaluateScriptResult extends ScriptResult {
  tooltype: 'evaluate_script';
  result: string;
}

/** 注入预加载脚本参数 */
export interface InjectPreloadScriptParams {
  script: string;
}

/** 注入预加载脚本结果 */
export interface InjectPreloadScriptResult extends ScriptResult {
  tooltype: 'inject_preload_script';
}

interface ScriptRuntime {
  getSelectedPage(): {
    addInitScript?(script: string | ((...args: unknown[]) => unknown), arg?: unknown): Promise<void>;
  } | null;
  getSelectedFrame(): Frame | null;
  getContext?(): {
    addInitScript?(script: string | ((...args: unknown[]) => unknown), arg?: unknown): Promise<void>;
  } | null;
}

// Default script evaluation timeout in milliseconds (30 seconds)
const DEFAULT_SCRIPT_TIMEOUT = 30000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

/**
 * 在页面中执行 JavaScript 函数。
 *
 * @param frame - Puppeteer Frame 对象
 * @param functionCode - 要执行的 JS 函数代码
 * @returns 结构化结果对象
 */
export async function evaluateScriptFn(
  frame: Frame,
  functionCode: string,
): Promise<EvaluateScriptResult> {
  let fn: JSHandle<unknown> | undefined;
  try {
    fn = await withTimeout(
      frame.evaluateHandle(`(${functionCode})`),
      DEFAULT_SCRIPT_TIMEOUT,
      'Script evaluation timed out',
    );
    const result = await withTimeout(
      frame.evaluate(async (fn: unknown) => {
        // @ts-expect-error no types.
        return JSON.stringify(await fn());
      }, fn),
      DEFAULT_SCRIPT_TIMEOUT,
      'Script execution timed out',
    );

    return {
      success: true,
      message: 'Script ran on page and returned',
      tooltype: 'evaluate_script',
      result: result as string,
    };
  } catch (error) {
    return {
      success: false,
      message: `脚本执行失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'evaluate_script',
      result: '',
    };
  } finally {
    if (fn) {
      void fn.dispose();
    }
  }
}

/**
 * 运行时包装：在当前选中的 Frame / Page 上执行脚本。
 */
export async function evaluateScript(
  runtime: ScriptRuntime,
  params: {function?: string} = {},
): Promise<EvaluateScriptResult> {
  const functionCode = params.function;
  if (!functionCode || functionCode.trim().length === 0) {
    return {
      success: false,
      message: 'function 参数不能为空',
      tooltype: 'evaluate_script',
      result: '',
    };
  }

  const frame = runtime.getSelectedFrame();
  if (!frame) {
    return {
      success: false,
      message: '当前没有可用的 Frame',
      tooltype: 'evaluate_script',
      result: '',
    };
  }

  return evaluateScriptFn(frame, functionCode);
}

/**
 * 注册预加载脚本。
 *
 * 注意：此函数需要 runtime.pageController 来注入脚本，
 * 纯函数层仅定义签名，实际注入由 tool 层完成。
 *
 * @param script - JS 代码
 * @returns 结构化结果对象（仅声明成功，实际注入在 tool 层完成）
 */
export function injectPreloadScriptFn(
  script: string,
): InjectPreloadScriptResult {
  if (!script || script.trim().length === 0) {
    return {
      success: false,
      message: '脚本内容不能为空',
      tooltype: 'inject_preload_script',
    };
  }

  return {
    success: true,
    message: 'Preload script prepared for registration.',
    tooltype: 'inject_preload_script',
  };
}

/**
 * 运行时包装：向当前页面或上下文注册预加载脚本。
 */
export async function injectPreloadScript(
  runtime: ScriptRuntime,
  params: {script?: string} = {},
): Promise<InjectPreloadScriptResult> {
  const script = params.script ?? '';
  const prepared = injectPreloadScriptFn(script);
  if (!prepared.success) {
    return prepared;
  }

  const target =
    runtime.getContext?.() ?? runtime.getSelectedPage?.() ?? null;
  if (!target?.addInitScript) {
    return {
      success: false,
      message: '当前运行时不支持注入预加载脚本',
      tooltype: 'inject_preload_script',
    };
  }

  await target.addInitScript(script);
  return {
    success: true,
    message: 'Preload script registered for future documents',
    tooltype: 'inject_preload_script',
  };
}
