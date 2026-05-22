/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import type {CDPSession, Frame, JSHandle} from '../../third_party/index.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {selectExecutionContext} from '../debugger/contextSelector.js';
import type {ExecutionContextInfo} from '../debugger/executionContexts.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {type PreloadPreset, getPreloadPreset} from './preload-presets.js';

// Default script evaluation timeout in milliseconds (30 seconds)
const DEFAULT_SCRIPT_TIMEOUT = 30000;

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

function hasDebuggerContextCapability(): boolean {
  const ctx = getRuntime().contextProvider;
  return typeof ctx?.getDebuggerContext === 'function';
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
  explicitFrameId?: string,
): string {
  const worldMatches = executionContexts.filter(
    context => context.world === desiredContext,
  );

  if (worldMatches.length === 0) {
    return `脚本执行失败：当前页面没有可用的 ${desiredContext} 执行上下文`;
  }

  // 列出所有候选 context，便于用户下次用 --frameId 精确定位
  const candidateLines = worldMatches
    .slice(0, 8)
    .map(
      ctx =>
        `  - frameId=${ctx.frameId ?? '(null)'} origin=${ctx.origin || '(empty)'} name=${ctx.name || '(empty)'}`,
    )
    .join('\n');

  if (explicitFrameId) {
    return (
      `脚本执行失败：显式指定的 frameId=${explicitFrameId} 未在 ${desiredContext} 上下文中命中。\n` +
      `可选 ${desiredContext} 上下文：\n${candidateLines}`
    );
  }

  if (selectedFrameId) {
    return (
      `脚本执行失败：未找到与当前选中 Frame(${selectedFrameId}) 匹配的 ${desiredContext} 执行上下文。\n` +
      `可选 ${desiredContext} 上下文：\n${candidateLines}\n` +
      `提示：改用 --frameId <id> 显式指定，或 --allowAnyFrame true 回退到第一个可用上下文。`
    );
  }

  if (worldMatches.length > 1) {
    return (
      `脚本执行失败：存在 ${worldMatches.length} 个 ${desiredContext} 执行上下文，无法自动映射到唯一目标。\n` +
      `可选 ${desiredContext} 上下文：\n${candidateLines}\n` +
      `提示：改用 --frameId <id> 显式指定，或 --allowAnyFrame true 回退到第一个可用上下文。`
    );
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
): Promise<{
  success: boolean;
  message: string;
  tooltype: string;
  result?: string;
}> {
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
 * 在 Frame 上执行脚本（辅助函数）。
 */
export async function evaluateScriptFn(
  frame: Frame,
  functionCode: string,
): Promise<{
  success: boolean;
  message: string;
  tooltype: string;
  result?: string;
}> {
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
 * 执行脚本；支持 page / content-script 上下文，并透传 verbose 参数
 */
export const evaluateScript = defineTool({
  name: 'evaluate_script',
  description:
    'Execute JavaScript on the page; supports page / content-script context, with verbose parameter passthrough',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {
    function: zod.string().describe('JavaScript function code to execute'),
    context: zod
      .enum(['page', 'content-script'])
      .optional()
      .describe('Execution context (default: "page")'),
    frameId: zod
      .string()
      .optional()
      .describe(
        '显式指定要执行的 frame 的 frameId。多 iframe（如跨域登录、Cookie 检测）场景必填，否则可能因上下文歧义失败。优先级高于 selectedFrame。',
      ),
    allowAnyFrame: zod
      .boolean()
      .optional()
      .describe(
        '当存在多个匹配的执行上下文且无法精确定位时，是否回退到第一个可用上下文。默认 false。',
      ),
    verbose: zod.boolean().optional().describe('Enable verbose output'),
  },
  handler: async (request, response, _context) => {
    const functionCode = request.params.function;
    const desiredContext = request.params.context ?? 'page';
    const explicitFrameId = request.params.frameId;
    const allowAnyFrame = request.params.allowAnyFrame ?? false;

    if (!functionCode || functionCode.trim().length === 0) {
      response.setStructuredContent({
        success: false,
        message: 'function 参数不能为空',
        tooltype: 'evaluate_script',
        result: '',
      });
      return;
    }

    const ctx = getRuntime().contextProvider!;
    const frame = ctx.getSelectedFrame();

    if (hasDebuggerContextCapability()) {
      try {
        const debuggerContext = await ctx.getDebuggerContext!();
        const executionContexts = debuggerContext.getExecutionContexts();
        const selectedFrameId = getFrameId(frame);
        // frameId 优先级：explicitFrameId > selectedFrameId
        const effectiveFrameId = explicitFrameId ?? selectedFrameId;
        const executionContext = selectExecutionContext(executionContexts, {
          context: desiredContext,
          frameId: effectiveFrameId,
          fallbackToFirst: allowAnyFrame,
        });

        if (!executionContext) {
          response.setStructuredContent({
            success: false,
            message: describeContextSelectionFailure(
              executionContexts,
              desiredContext,
              selectedFrameId,
              explicitFrameId,
            ),
            tooltype: 'evaluate_script',
          });
          return;
        }

        const client = debuggerContext.getClient();
        if (!client) {
          response.setStructuredContent({
            success: false,
            message: '脚本执行失败：Debugger CDP 会话不可用',
            tooltype: 'evaluate_script',
          });
          return;
        }

        try {
          const evalResult = await evaluateScriptInExecutionContext(
            client,
            executionContext,
            functionCode,
          );
          response.appendResponseLine('```json');
          response.appendResponseLine(JSON.stringify(evalResult, null, 2));
          response.appendResponseLine('```');
          return;
        } catch (error) {
          const raw = getUnknownErrorMessage(error);
          const isolationHint = getIsolationHint(
            functionCode,
            desiredContext,
            raw,
          );

          response.appendResponseLine('```json');
          response.appendResponseLine(
            JSON.stringify(
              {
                success: false,
                message: isolationHint ?? `脚本执行失败：${raw}`,
                tooltype: 'evaluate_script',
              },
              null,
              2,
            ),
          );
          response.appendResponseLine('```');
          return;
        }
      } catch (error) {
        response.appendResponseLine('```json');
        response.appendResponseLine(
          JSON.stringify(
            {
              success: false,
              message: `脚本执行失败：${getUnknownErrorMessage(error)}`,
              tooltype: 'evaluate_script',
            },
            null,
            2,
          ),
        );
        response.appendResponseLine('```');
        return;
      }
    }

    if (desiredContext === 'content-script') {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: '当前页面没有可用的 content-script 执行上下文',
            tooltype: 'evaluate_script',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
      return;
    }

    if (!frame) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: '当前没有可用的 Frame',
            tooltype: 'evaluate_script',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
      return;
    }

    const result = await evaluateScriptFn(frame, functionCode);
    if (!result.success) {
      const isolationHint = getIsolationHint(
        functionCode,
        desiredContext,
        result.message,
      );
      if (isolationHint) {
        result.message = isolationHint;
      }
    }

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

/**
 * 注入预加载脚本
 */
export const injectPreloadScript = defineTool({
  name: 'inject_preload_script',
  description:
    'Register a preload script for future documents on the current page/context',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {
    script: zod
      .string()
      .optional()
      .describe('JavaScript code to inject as preload script'),
    preset: zod
      .enum([
        'capture-all-fetch',
        'capture-all-xhr',
        'capture-all-requests',
        'log-cookies',
      ])
      .optional()
      .describe('预设 hook 模板，与 script 参数互斥'),
  },
  handler: async (request, response, _context) => {
    const {preset} = request.params;
    const script = preset
      ? getPreloadPreset(preset as PreloadPreset)
      : (request.params.script ?? '');

    if (!script || script.trim().length === 0) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: '脚本内容不能为空',
            tooltype: 'inject_preload_script',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
      return;
    }

    const ctx = getRuntime().contextProvider!;
    const context = ctx.getContext?.() ?? null;
    const selectedPage = ctx.getSelectedPage?.() ?? null;
    const target = context ?? selectedPage ?? null;

    if (!target?.addInitScript) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: '当前运行时不支持注入预加载脚本',
            tooltype: 'inject_preload_script',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
      return;
    }

    const isClosed =
      ('isClosed' in target &&
        typeof target.isClosed === 'function' &&
        target.isClosed()) ||
      (selectedPage && selectedPage.isClosed());

    if (isClosed) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: '当前页面或浏览器上下文已关闭，无法注入预加载脚本',
            tooltype: 'inject_preload_script',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
      return;
    }

    try {
      await target.addInitScript(script);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: `注入预加载脚本失败：${msg}`,
            tooltype: 'inject_preload_script',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
      return;
    }

    response.appendResponseLine('```json');
    response.appendResponseLine(
      JSON.stringify(
        {
          success: true,
          message: 'Preload script registered for future documents',
          tooltype: 'inject_preload_script',
        },
        null,
        2,
      ),
    );
    response.appendResponseLine('```');
  },
});
