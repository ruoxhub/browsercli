/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {createPreloadHookId} from '../../modules/hook/index.js';
import {getRuntime} from '../../runtime.js';
import type {
  CDPSession,
  Frame,
  JSHandle,
  Page,
} from '../../third_party/index.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {selectExecutionContext} from '../debugger/contextSelector.js';
import type {ExecutionContextInfo} from '../debugger/executionContexts.js';
import {
  browserTimeoutSchema,
  withDebuggerTrapBypass,
} from '../shared/browserRuntime.js';
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
  data?: {value: unknown};
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function buildContextEvaluationExpression(functionCode: string): string {
  return `(async () => { const value = await (${functionCode}); return JSON.stringify(typeof value === 'function' ? await value() : value); })()`;
}

function hasDebuggerContextCapability(): boolean {
  const ctx = getRuntime().contextProvider;
  return typeof ctx?.getDebuggerContext === 'function';
}

function getUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 把选中的 Frame 解析成 CDP 的 frameId。
 *
 * Frame 对象上并没有 `frameId` 字段：patchright 的 Frame 只暴露 `_guid`
 * （形如 `frame@<hash>`），与 CDP `Page.getFrameTree` / `auxData.frameId`
 * 使用的十六进制 frameId 不是同一值域，直接拿来比较永远不相等 —— 这正是
 * 历史上 `select_frame` 报告成功、执行上下文却仍不切换的原因。
 *
 * 可靠做法是向 CDP 要一次 frame 树，并且**用 Playwright 自己的树**
 * （`mainFrame().childFrames()` 深度优先）建立顺序索引：`page.frames()` 是
 * 附加顺序，一旦嵌套帧晚于同级帧 attach，两个顺序就会错位，用其中一个的
 * 下标去查另一个会静默选中别的 frame 并把它的数据当作成功结果返回。
 * 目标帧不在自己的树里（已被 detach）时返回 undefined，绝不猜下标。
 */
export async function resolveSelectedFrameId(
  frame: Frame | null,
  options: {client?: CDPSession} = {},
): Promise<string | undefined> {
  if (!frame) return undefined;

  let page: Page;
  try {
    page = frame.page();
  } catch {
    return undefined;
  }

  // Worker mode hands tools a Proxy-wrapped Frame (frame.evaluate timeout
  // guard), so identity comparison fails even though frame.page() still works.
  // `_guid` (`frame@<hash>`) is stable across the wrapper and both objects; it
  // is only used to LOCATE the frame, never as a CDP frameId.
  const guid = (frame as Frame & {_guid?: string})._guid;
  const matchesTarget = (candidate: Frame): boolean =>
    candidate === frame ||
    (guid !== undefined &&
      (candidate as Frame & {_guid?: string})._guid === guid);

  // Depth-first from Playwright's own tree. `page.frames()` is ATTACH order,
  // which diverges from `Page.getFrameTree`'s DFS order as soon as a nested
  // frame attaches after a sibling — indexing one with the other silently
  // selects a different frame and returns its data as a success.
  const ordered: Frame[] = [];
  const walk = (node: Frame | null): void => {
    if (!node) return;
    ordered.push(node);
    for (const child of node.childFrames()) walk(child);
  };
  try {
    walk(page.mainFrame());
  } catch {
    return undefined;
  }
  const index = ordered.findIndex(matchesTarget);
  // A frame absent from its own page's tree is detached; never guess an index.
  if (index < 0) return undefined;

  const ownedClient = options.client;
  try {
    const client = ownedClient ?? (await page.context().newCDPSession(page));
    try {
      const {frameTree} = (await client.send('Page.getFrameTree')) as {
        frameTree?: {frame?: {id?: string}; childFrames?: unknown[]};
      };
      const ids: Array<string | undefined> = [];
      const walkTree = (node?: {
        frame?: {id?: string};
        childFrames?: Array<typeof node>;
      }): void => {
        if (!node) return;
        ids.push(node.frame?.id);
        for (const child of node.childFrames ?? []) walkTree(child);
      };
      walkTree(frameTree as never);
      return ids[index];
    } finally {
      // Only close the session this call opened; a caller-supplied one is
      // owned (and detached) by the caller.
      if (!ownedClient) await client.detach().catch(() => undefined);
    }
  } catch {
    return undefined;
  }
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
  if (result === undefined) {
    return {success, message, tooltype};
  }

  if (!success) {
    return {success, message, tooltype, result};
  }

  let value: unknown = result;
  try {
    value = JSON.parse(result) as unknown;
  } catch {
    // Keep non-JSON output usable while preserving the legacy result string.
  }
  return {success, message, tooltype, result, data: {value}};
}

function writeStructuredFailure(
  _response: Response,
  tooltype: string,
  message: string,
  _result?: string,
): never {
  throw createToolError(ErrorCodes.RUNTIME, message, {toolName: tooltype});
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
  timeoutMs: number,
): Promise<string | undefined> {
  const runtimeResult = (await withTimeout(
    client.send('Runtime.evaluate', {
      expression: buildContextEvaluationExpression(functionCode),
      contextId: executionContext.id,
      returnByValue: true,
      awaitPromise: true,
    }),
    timeoutMs,
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
  timeoutMs = DEFAULT_SCRIPT_TIMEOUT,
): Promise<ScriptStructuredResult> {
  let fn: JSHandle<unknown> | undefined;
  try {
    fn = await withTimeout(
      frame.evaluateHandle(`(${functionCode})`),
      timeoutMs,
      'Script evaluation timed out',
    );
    const result = await withTimeout(
      frame.evaluate(async (value: unknown) => {
        const result =
          typeof value === 'function'
            ? await (value as () => unknown)()
            : await value;
        return JSON.stringify(result);
      }, fn),
      timeoutMs,
      'Script evaluation timed out',
    );

    return buildStructuredPayload(
      'evaluate_script',
      true,
      'Script ran on page and returned',
      result as string | undefined,
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error;
    throw createToolError(
      ErrorCodes.RUNTIME,
      `脚本执行失败：${getUnknownErrorMessage(error)}`,
      {toolName: 'evaluate_script'},
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
    timeoutMs: number;
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
    const selectedFrameId = await resolveSelectedFrameId(
      ctx.getSelectedFrame(),
    );
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
        request.timeoutMs,
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

async function runOnFrame(
  ctx: ContextProvider,
  request: {
    functionCode: string;
    desiredContext: DesiredContext;
    timeoutMs: number;
  },
  response: Response,
): Promise<void> {
  if (request.desiredContext === 'content-script') {
    throw createToolError(
      ErrorCodes.NOT_FOUND,
      '当前页面没有可用的 content-script 执行上下文',
      {toolName: 'evaluate_script'},
    );
  }

  const frame = ctx.getSelectedFrame();
  if (!frame) {
    throw createToolError(ErrorCodes.FRAME_REQUIRED, '当前没有可用的 Frame', {
      toolName: 'evaluate_script',
    });
  }

  try {
    const result = await evaluateScriptFn(
      frame,
      request.functionCode,
      request.timeoutMs,
    );
    response.setStructuredContent(result);
  } catch (error) {
    const raw = getUnknownErrorMessage(error);
    const hint = getIsolationHint(
      request.functionCode,
      request.desiredContext,
      raw,
    );
    if (hint) {
      throw createToolError(ErrorCodes.RUNTIME, hint, {
        toolName: 'evaluate_script',
      });
    }
    throw error;
  }
}

export const evaluateScript = defineTool({
  name: 'evaluate_script',
  description:
    '在页面上执行 JavaScript；支持 page / content-script 上下文。可选的，对于较大的结果可将输出保存到文件。',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {
    function: zod
      .string()
      .describe(
        'A complete, syntactically balanced JavaScript expression. ' +
          '函数表达式会被调用，其他表达式会直接返回求值结果。括号/大括号/字符串/模板字符串都要闭合，不能传半截定义。' +
          '示例：`document.title`、`(() => document.title)()`、`() => 1 + 1`、' +
          '`async () => await fetch("/api").then(r => r.json())`。' +
          '不要写 `function name() {`（缺 `}`）或 `() => {`（缺 `}`）。',
      ),
    context: zod
      .enum(['page', 'content-script'])
      .optional()
      .describe('执行上下文（默认："page"）'),
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
    verbose: zod.boolean().optional().describe('启用详细输出'),
    filePath: zod
      .string()
      .optional()
      .describe(
        '用于保存脚本输出的文件绝对或相对路径。省略时输出以内联方式返回。',
      ),
    timeoutMs: browserTimeoutSchema('脚本执行超时（毫秒，默认 30000）。'),
  },
  handler: async (request, response, toolContext) => {
    const functionCode = request.params.function;
    const desiredContext = (request.params.context ?? 'page') as DesiredContext;
    const explicitFrameId = request.params.frameId;
    const allowAnyFrame = request.params.allowAnyFrame ?? false;
    const filePath = request.params.filePath;
    const timeoutMs = request.params.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT;

    if (typeof functionCode !== 'string') {
      throw createToolError(
        ErrorCodes.VALIDATION,
        `function 参数必须是字符串，但收到 ${typeof functionCode}。请确保传入完整的函数表达式，如 () => { ... }`,
        {toolName: 'evaluate_script'},
      );
    }

    if (!functionCode || functionCode.trim().length === 0) {
      throw createToolError(ErrorCodes.VALIDATION, 'function 参数不能为空', {
        toolName: 'evaluate_script',
      });
    }

    const syntaxIssue = checkScriptSyntaxBalance(functionCode);
    if (syntaxIssue) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        `脚本未送入页面执行：${syntaxIssue.reason}。请先补全 function 体后再调用 evaluate_script，不要逐字符重试。CLI 中的复杂或多行脚本请改用 --file <script.js>，或通过 --stdin 传入 JSON 参数。`,
        {toolName: 'evaluate_script'},
      );
    }

    const ctx = getRuntime().contextProvider;
    if (!ctx) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        '脚本执行失败：运行时上下文不可用',
        {toolName: 'evaluate_script'},
      );
    }

    const evalRequest = {
      functionCode,
      desiredContext,
      explicitFrameId,
      allowAnyFrame,
      filePath,
      timeoutMs,
    };

    await withDebuggerTrapBypass(toolContext, async () => {
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
    });
  },
});

export const injectPreloadScript = defineTool({
  name: 'inject_preload_script',
  description: '为当前页面/上下文的后续文档注册预加载脚本',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {
    script: zod
      .string()
      .optional()
      .describe('要作为预加载脚本注入的 JavaScript 代码'),
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
  handler: async (request, response, toolContext) => {
    const tooltype = 'inject_preload_script';
    const {preset} = request.params;
    const script = preset
      ? getPreloadPreset(preset as PreloadPreset)
      : (request.params.script ?? '');

    if (!script || script.trim().length === 0) {
      throw createToolError(ErrorCodes.VALIDATION, '脚本内容不能为空', {
        toolName: tooltype,
      });
    }

    const browserContext = toolContext.getBrowserContext();
    if (!browserContext || browserContext.isClosed()) {
      throw createToolError(
        ErrorCodes.BROWSER_REQUIRED,
        '当前 BrowserContext 不可用或已关闭，无法注入预加载脚本',
        {toolName: tooltype},
      );
    }

    try {
      const registrationId = createPreloadHookId(script);
      const result = await toolContext.getPersistentHookRegistry().register({
        context: browserContext,
        hookId: registrationId,
        script,
        source: 'inject_preload_script',
        requestedWorld: 'main',
        applyMode: 'future-only',
      });
      response.setStructuredContent({
        success: true,
        message:
          'Preload script registered for future documents in the current BrowserContext',
        tooltype,
        data: {
          registrationId,
          scriptHash: result.entry.scriptHash,
          scriptSize: result.entry.scriptSize,
          scriptPreview: result.entry.scriptPreview,
          registeredAt: new Date(result.entry.registeredAt).toISOString(),
          registered: result.registered,
          idempotent: result.idempotent,
          requestedWorld: result.entry.requestedWorld,
          effectiveWorld: result.entry.effectiveWorld,
          applyMode: result.entry.applyMode,
          warnings: result.warnings,
        },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `注入预加载脚本失败：${getUnknownErrorMessage(error)}`,
        {toolName: tooltype},
      );
    }
  },
});
