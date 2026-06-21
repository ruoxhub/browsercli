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
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

import {type PreloadPreset, getPreloadPreset} from './preload-presets.js';
import {checkScriptSyntaxBalance} from './validate-script-syntax.js';

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

interface ScriptStructuredResult {
  success: boolean;
  message: string;
  tooltype: string;
  result?: string;
}

type DesiredContext = 'page' | 'content-script';
type ContextProvider = NonNullable<
  ReturnType<typeof getRuntime>['contextProvider']
>;

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
  desiredContext: DesiredContext,
  selectedFrameId?: string,
  explicitFrameId?: string,
): string {
  const worldMatches = executionContexts.filter(
    ctx => ctx.world === desiredContext,
  );

  if (worldMatches.length === 0) {
    return `脚本执行失败：当前页面没有可用的 ${desiredContext} 执行上下文`;
  }

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
  context: DesiredContext,
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

function buildStructuredPayload(
  tooltype: string,
  success: boolean,
  message: string,
  result?: string,
): ScriptStructuredResult {
  return result === undefined
    ? {success, message, tooltype}
    : {success, message, tooltype, result};
}

function writeStructuredFailure(
  response: Response,
  tooltype: string,
  message: string,
  result?: string,
): void {
  response.setStructuredContent(
    buildStructuredPayload(tooltype, false, message, result),
  );
}

async function writeEvaluationOutput(
  resultString: string | undefined,
  response: Response,
  options: {filePath?: string; context?: Context},
): Promise<void> {
  if (options.filePath && options.context) {
    const data = new TextEncoder().encode(resultString ?? 'undefined');
    const {filename} = await options.context.saveFile(data, options.filePath);
    response.setStructuredContent({
      success: true,
      message: `Script ran. Output saved to ${filename}.`,
      tooltype: 'evaluate_script',
    });
    return;
  }

  response.setStructuredContent(
    buildStructuredPayload(
      'evaluate_script',
      true,
      'Script ran on page and returned',
      resultString,
    ),
  );
}

async function evaluateScriptInExecutionContext(
  client: CDPSession,
  executionContext: ExecutionContextInfo,
  functionCode: string,
): Promise<string | undefined> {
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

  return runtimeResult.result.value;
}

export async function evaluateScriptFn(
  frame: Frame,
  functionCode: string,
): Promise<ScriptStructuredResult> {
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

    return buildStructuredPayload(
      'evaluate_script',
      true,
      'Script ran on page and returned',
      result as string | undefined,
    );
  } catch (error) {
    return buildStructuredPayload(
      'evaluate_script',
      false,
      `脚本执行失败：${getUnknownErrorMessage(error)}`,
      '',
    );
  } finally {
    if (fn) {
      void fn.dispose();
    }
  }
}

async function runOnDebuggerContext(
  ctx: ContextProvider,
  request: {
    functionCode: string;
    desiredContext: DesiredContext;
    explicitFrameId?: string;
    allowAnyFrame: boolean;
    filePath?: string;
  },
  response: Response,
  toolContext?: Context,
): Promise<'handled' | 'unavailable'> {
  if (!hasDebuggerContextCapability()) {
    return 'unavailable';
  }

  try {
    const debuggerContext = await ctx.getDebuggerContext!();
    const executionContexts = debuggerContext.getExecutionContexts();
    const selectedFrameId = getFrameId(ctx.getSelectedFrame());
    const effectiveFrameId = request.explicitFrameId ?? selectedFrameId;
    const executionContext = selectExecutionContext(executionContexts, {
      context: request.desiredContext,
      frameId: effectiveFrameId,
      fallbackToFirst: request.allowAnyFrame,
    });

    if (!executionContext) {
      writeStructuredFailure(
        response,
        'evaluate_script',
        describeContextSelectionFailure(
          executionContexts,
          request.desiredContext,
          selectedFrameId,
          request.explicitFrameId,
        ),
      );
      return 'handled';
    }

    const client = debuggerContext.getClient();
    if (!client) {
      writeStructuredFailure(
        response,
        'evaluate_script',
        '脚本执行失败：Debugger CDP 会话不可用',
      );
      return 'handled';
    }

    try {
      const evalResult = await evaluateScriptInExecutionContext(
        client,
        executionContext,
        request.functionCode,
      );
      await writeEvaluationOutput(evalResult, response, {
        filePath: request.filePath,
        context: toolContext as Context,
      });
      return 'handled';
    } catch (error) {
      const raw = getUnknownErrorMessage(error);
      const isolationHint = getIsolationHint(
        request.functionCode,
        request.desiredContext,
        raw,
      );
      writeStructuredFailure(
        response,
        'evaluate_script',
        isolationHint ?? `脚本执行失败：${raw}`,
      );
      return 'handled';
    }
  } catch (error) {
    writeStructuredFailure(
      response,
      'evaluate_script',
      `脚本执行失败：${getUnknownErrorMessage(error)}`,
    );
    return 'handled';
  }
}

function runOnFrame(
  ctx: ContextProvider,
  request: {
    functionCode: string;
    desiredContext: DesiredContext;
  },
  response: Response,
): Promise<void> {
  if (request.desiredContext === 'content-script') {
    response.setStructuredContent(
      buildStructuredPayload(
        'evaluate_script',
        false,
        '当前页面没有可用的 content-script 执行上下文',
      ),
    );
    return Promise.resolve();
  }

  const frame = ctx.getSelectedFrame();
  if (!frame) {
    response.setStructuredContent(
      buildStructuredPayload('evaluate_script', false, '当前没有可用的 Frame'),
    );
    return Promise.resolve();
  }

  return evaluateScriptFn(frame, request.functionCode).then(result => {
    if (!result.success) {
      const hint = getIsolationHint(
        request.functionCode,
        request.desiredContext,
        result.message,
      );
      if (hint) {
        result.message = hint;
      }
    }
    response.setStructuredContent(result);
  });
}

export const evaluateScript = defineTool({
  name: 'evaluate_script',
  description:
    'Execute JavaScript on the page; supports page / content-script context. Optionally saves output to a file for large results.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {
    function: zod
      .string()
      .describe(
        'A complete, syntactically balanced JavaScript expression that evaluates to a function. ' +
          '必须是「完整的」函数表达式，括号/大括号/字符串/模板字符串都要闭合，不能传半截定义。' +
          '示例：`() => 1 + 1`、`async () => await fetch("/api").then(r => r.json())`、' +
          '`function () { return document.cookie; }`。' +
          '不要写 `function name() {`（缺 `}`）或 `() => {`（缺 `}`）。',
      ),
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
    filePath: zod
      .string()
      .optional()
      .describe(
        'The absolute or relative path to a file to save the script output to. If omitted, the output is returned inline.',
      ),
  },
  handler: async (request, response, toolContext) => {
    const functionCode = request.params.function;
    const desiredContext = (request.params.context ?? 'page') as DesiredContext;
    const explicitFrameId = request.params.frameId;
    const allowAnyFrame = request.params.allowAnyFrame ?? false;
    const filePath = request.params.filePath;

    if (!functionCode || functionCode.trim().length === 0) {
      writeStructuredFailure(
        response,
        'evaluate_script',
        'function 参数不能为空',
        '',
      );
      return;
    }

    const syntaxIssue = checkScriptSyntaxBalance(functionCode);
    if (syntaxIssue) {
      writeStructuredFailure(
        response,
        'evaluate_script',
        `脚本未送入页面执行：${syntaxIssue.reason}。请先补全 function 体后再调用 evaluate_script，不要逐字符重试。`,
        '',
      );
      return;
    }

    const ctx = getRuntime().contextProvider;
    if (!ctx) {
      writeStructuredFailure(
        response,
        'evaluate_script',
        '脚本执行失败：运行时上下文不可用',
      );
      return;
    }

    const evalRequest = {
      functionCode,
      desiredContext,
      explicitFrameId,
      allowAnyFrame,
      filePath,
    };

    const outcome = await runOnDebuggerContext(
      ctx,
      evalRequest,
      response,
      toolContext,
    );
    if (outcome === 'handled') {
      return;
    }
    await runOnFrame(ctx, evalRequest, response);
  },
});

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
  handler: async (request, response) => {
    const tooltype = 'inject_preload_script';
    const {preset} = request.params;
    const script = preset
      ? getPreloadPreset(preset as PreloadPreset)
      : (request.params.script ?? '');

    if (!script || script.trim().length === 0) {
      response.setStructuredContent({
        success: false,
        message: '脚本内容不能为空',
        tooltype,
      });
      return;
    }

    const ctx = getRuntime().contextProvider;
    if (!ctx) {
      response.setStructuredContent({
        success: false,
        message: '当前运行时上下文不可用',
        tooltype,
      });
      return;
    }

    const context = ctx.getContext?.() ?? null;
    const selectedPage = ctx.getSelectedPage?.() ?? null;
    const target = context ?? selectedPage ?? null;

    if (!target?.addInitScript) {
      response.setStructuredContent({
        success: false,
        message: '当前运行时不支持注入预加载脚本',
        tooltype,
      });
      return;
    }

    const targetClosed =
      'isClosed' in target &&
      typeof target.isClosed === 'function' &&
      target.isClosed();
    const pageClosed =
      selectedPage &&
      typeof selectedPage.isClosed === 'function' &&
      selectedPage.isClosed();
    if (targetClosed || pageClosed) {
      response.setStructuredContent({
        success: false,
        message: '当前页面或浏览器上下文已关闭，无法注入预加载脚本',
        tooltype,
      });
      return;
    }

    try {
      await target.addInitScript(script);
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `注入预加载脚本失败：${getUnknownErrorMessage(error)}`,
        tooltype,
      });
      return;
    }

    response.setStructuredContent({
      success: true,
      message: 'Preload script registered for future documents',
      tooltype,
    });
  },
});
