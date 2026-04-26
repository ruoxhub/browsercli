/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CDPSession, Frame, JSHandle} from '../../third_party/index.js';
import {selectExecutionContext} from '../debugger/contextSelector.js';
import type {ExecutionContextInfo} from '../debugger/executionContexts.js';

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
  context?: 'page' | 'content-script';
  verbose?: boolean;
}

/** 执行脚本结果 */
export interface EvaluateScriptResult extends ScriptResult {
  tooltype: 'evaluate_script';
  result: string | undefined;
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
  getDebuggerContext?(): Promise<{
    getExecutionContexts(): ExecutionContextInfo[];
    getClient(): CDPSession | null;
  }>;
  getContext?(): {
    addInitScript?(script: string | ((...args: unknown[]) => unknown), arg?: unknown): Promise<void>;
  } | null;
}

interface RuntimeEvaluateResult {
  exceptionDetails?: {
    text?: string;
    exception?: {description?: string; value?: unknown};
  };
  result: {
    value?: string;
    description?: string;
  };
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

function buildContextEvaluationExpression(functionCode: string): string {
  return `(async () => JSON.stringify(await (${functionCode})()))()`;
}

function hasDebuggerContextCapability(
  runtime: ScriptRuntime,
): runtime is ScriptRuntime & {
  getDebuggerContext(): Promise<{
    getExecutionContexts(): ExecutionContextInfo[];
    getClient(): CDPSession | null;
  }>;
} {
  return typeof runtime.getDebuggerContext === 'function';
}

function getUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getFrameId(frame: Frame | null): string | undefined {
  if (!frame || typeof frame !== 'object') {
    return undefined;
  }

  const candidateFrame = frame as {
    frameId?: string;
    _frameId?: string;
    _id?: string;
    _initializer?: {id?: string; frameId?: string};
    _channel?: {_initializer?: {id?: string; frameId?: string}};
  };

  return (
    candidateFrame.frameId ||
    candidateFrame._frameId ||
    candidateFrame._id ||
    candidateFrame._initializer?.frameId ||
    candidateFrame._initializer?.id ||
    candidateFrame._channel?._initializer?.frameId ||
    candidateFrame._channel?._initializer?.id
  );
}

function describeContextSelectionFailure(
  executionContexts: ExecutionContextInfo[],
  desiredContext: 'page' | 'content-script',
  selectedFrameId?: string,
): string {
  const worldMatches = executionContexts.filter(
    context => context.world === desiredContext,
  );

  if (worldMatches.length === 0) {
    return `脚本执行失败：当前页面没有可用的 ${desiredContext} 执行上下文`;
  }

  if (selectedFrameId) {
    return `脚本执行失败：未找到与当前选中 Frame(${selectedFrameId}) 匹配的 ${desiredContext} 执行上下文`;
  }

  if (worldMatches.length > 1) {
    return `脚本执行失败：存在多个 ${desiredContext} 执行上下文，但无法将当前选中 Frame 映射到唯一上下文`;
  }

  return `脚本执行失败：无法选择 ${desiredContext} 执行上下文`;
}

function getRuntimeEvaluateErrorMessage(result: RuntimeEvaluateResult): string {
  return (
    result.exceptionDetails?.exception?.description ||
    result.exceptionDetails?.text ||
    result.result.description ||
    'Runtime.evaluate failed'
  );
}

function getIsolationHint(
  functionCode: string,
  context: 'page' | 'content-script',
  errorMessage: string,
): string | null {
  if (context !== 'page') {
    return null;
  }

  const looksLikeExtensionObject =
    /(window|globalThis|self)\.__[A-Za-z0-9_$]+/.test(functionCode);
  const looksLikeIsolationMiss =
    /undefined|not defined|not a function|Cannot read properties/i.test(
      errorMessage,
    );

  if (!looksLikeExtensionObject || !looksLikeIsolationMiss) {
    return null;
  }

  return '执行失败：目标对象可能位于扩展 content script 隔离上下文，页面主上下文无法直接访问；请改用 --context content-script 或先分析扩展源码';
}

async function evaluateScriptInExecutionContext(
  client: CDPSession,
  executionContext: ExecutionContextInfo,
  functionCode: string,
): Promise<EvaluateScriptResult> {
  const runtimeResult = (await withTimeout(
    client.send('Runtime.evaluate', {
      expression: buildContextEvaluationExpression(functionCode),
      contextId: executionContext.id,
      returnByValue: true,
      awaitPromise: true,
    }),
    DEFAULT_SCRIPT_TIMEOUT,
    'Script execution timed out',
  )) as RuntimeEvaluateResult;

  if (runtimeResult.exceptionDetails) {
    throw new Error(getRuntimeEvaluateErrorMessage(runtimeResult));
  }

  return {
    success: true,
    message: `Script ran in ${executionContext.world} context and returned`,
    tooltype: 'evaluate_script',
    result: runtimeResult.result.value,
  };
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
      result: result as string | undefined,
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
  params: {
    function?: string;
    context?: 'page' | 'content-script';
    verbose?: boolean;
  } = {},
): Promise<EvaluateScriptResult> {
  const functionCode = params.function;
  const desiredContext = params.context ?? 'page';
  if (!functionCode || functionCode.trim().length === 0) {
    return {
      success: false,
      message: 'function 参数不能为空',
      tooltype: 'evaluate_script',
      result: '',
    };
  }

  const frame = runtime.getSelectedFrame();

  if (hasDebuggerContextCapability(runtime)) {
    try {
      const debuggerContext = await runtime.getDebuggerContext();
      const executionContexts = debuggerContext.getExecutionContexts();
      const selectedFrameId = getFrameId(frame);
      const executionContext = selectExecutionContext(
        executionContexts,
        {
          context: desiredContext,
          frameId: selectedFrameId,
        },
      );

      if (!executionContext) {
        return {
          success: false,
          message: describeContextSelectionFailure(
            executionContexts,
            desiredContext,
            selectedFrameId,
          ),
          tooltype: 'evaluate_script',
          result: undefined,
        };
      }

      const client = debuggerContext.getClient();
      if (!client) {
        return {
          success: false,
          message: '脚本执行失败：Debugger CDP 会话不可用',
          tooltype: 'evaluate_script',
          result: undefined,
        };
      }

      try {
        return await evaluateScriptInExecutionContext(
          client,
          executionContext,
          functionCode,
        );
      } catch (error) {
        const raw = getUnknownErrorMessage(error);
        const isolationHint = getIsolationHint(
          functionCode,
          desiredContext,
          raw,
        );

        return {
          success: false,
          message: isolationHint ?? `脚本执行失败：${raw}`,
          tooltype: 'evaluate_script',
          result: undefined,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `脚本执行失败：${getUnknownErrorMessage(error)}`,
        tooltype: 'evaluate_script',
        result: undefined,
      };
    }
  }

  if (desiredContext === 'content-script') {
    return {
      success: false,
      message: '当前页面没有可用的 content-script 执行上下文',
      tooltype: 'evaluate_script',
      result: undefined,
    };
  }

  if (!frame) {
    return {
      success: false,
      message: '当前没有可用的 Frame',
      tooltype: 'evaluate_script',
      result: undefined,
    };
  }

  const result = await evaluateScriptFn(frame, functionCode);
  if (!result.success) {
    const isolationHint = getIsolationHint(
      functionCode,
      desiredContext,
      result.message,
    );
    if (isolationHint) {
      return {
        ...result,
        message: isolationHint,
      };
    }
  }

  return result;
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
