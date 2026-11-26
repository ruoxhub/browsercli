/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {globalPageSnapshotManager} from '../modules/snapshot/PageSnapshotManager.js';
import {
  type CDPSession,
  type Frame,
  type JSHandle,
  type Page,
  zod,
} from '../third_party/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';

import {ToolCategory} from './categories.js';
import {type ExecutionContextInfo, selectExecutionContext} from './debugger.js';
import type {DomainManifest} from './manifest.js';
import {
  browserTimeoutSchema,
  withDebuggerTrapBypass,
} from './shared/browserRuntime.js';
import {type Context, definePageTool, type Response} from './ToolDefinition.js';

// ─── preload-presets.ts ──────────────────────────────────

export type PreloadPreset =
  | 'capture-all-fetch'
  | 'capture-all-xhr'
  | 'capture-all-requests'
  | 'log-cookies';

export const PRELOAD_PRESETS: Record<PreloadPreset, string> = {
  'capture-all-fetch': `(function() {
  'use strict';
  if (window.__preloadFetchHooked) return;
  window.__preloadFetchHooked = true;
  window.__capturedFetch = [];
  const origFetch = window.fetch;
  window.fetch = function() {
    const args = Array.from(arguments);
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = (init.method || (input && input.method) || 'GET').toUpperCase();
    const record = { url, method, body: init.body, timestamp: Date.now() };
    window.__capturedFetch.push(record);
    console.log('[preload:capture-all-fetch]', method, url);
    return origFetch.apply(this, arguments);
  };
  window.fetch.__proto__ = origFetch.__proto__;
})();`,

  'capture-all-xhr': `(function() {
  'use strict';
  if (window.__preloadXhrHooked) return;
  window.__preloadXhrHooked = true;
  window.__capturedXhr = [];
  const OrigXHR = window.XMLHttpRequest;
  function HookedXHR() {
    const xhr = new OrigXHR();
    const record = { method: '', url: '', timestamp: Date.now() };
    window.__capturedXhr.push(record);
    const origOpen = xhr.open.bind(xhr);
    xhr.open = function(method, url) {
      record.method = String(method).toUpperCase();
      record.url = String(url);
      console.log('[preload:capture-all-xhr]', record.method, record.url);
      return origOpen.apply(xhr, arguments);
    };
    return xhr;
  }
  HookedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = HookedXHR;
})();`,

  'capture-all-requests': `(function() {
  'use strict';
  if (window.__preloadAllHooked) return;
  window.__preloadAllHooked = true;
  window.__capturedRequests = [];

  // Hook fetch
  const origFetch = window.fetch;
  window.fetch = function() {
    const args = Array.from(arguments);
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = (init.method || (input && input.method) || 'GET').toUpperCase();
    window.__capturedRequests.push({ type: 'fetch', url, method, timestamp: Date.now() });
    console.log('[preload:capture-all-requests] fetch', method, url);
    return origFetch.apply(this, arguments);
  };
  window.fetch.__proto__ = origFetch.__proto__;

  // Hook XHR
  const OrigXHR = window.XMLHttpRequest;
  function HookedXHR() {
    const xhr = new OrigXHR();
    const record = { type: 'xhr', method: '', url: '', timestamp: Date.now() };
    window.__capturedRequests.push(record);
    const origOpen = xhr.open.bind(xhr);
    xhr.open = function(method, url) {
      record.method = String(method).toUpperCase();
      record.url = String(url);
      console.log('[preload:capture-all-requests] xhr', record.method, record.url);
      return origOpen.apply(xhr, arguments);
    };
    return xhr;
  }
  HookedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = HookedXHR;
})();`,

  'log-cookies': `(function() {
  'use strict';
  if (window.__preloadCookieHooked) return;
  window.__preloadCookieHooked = true;
  window.__cookieLog = [];
  const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
                     Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
  if (!cookieDesc) return;
  Object.defineProperty(document, 'cookie', {
    get: function() {
      const val = cookieDesc.get.call(this);
      return val;
    },
    set: function(val) {
      window.__cookieLog.push({ op: 'set', value: String(val), timestamp: Date.now() });
      console.log('[preload:log-cookies] set:', String(val).slice(0, 80));
      return cookieDesc.set.call(this, val);
    },
    configurable: true,
  });
})();`,
};

export function getPreloadPreset(preset: PreloadPreset): string {
  return PRELOAD_PRESETS[preset];
}

// ─── validate-script-syntax.ts ───────────────────────────

/**
 * 轻量 JS 语法预检：在不调用 V8 的情况下识别明显不完整的 function 代码。
 *
 * 不是完整的 JS parser，只追踪：
 *   - 字符串（'、"、`，含转义与模板字面量 `${...}` 嵌套）
 *   - 单行 / 块注释
 *   - (), {}, [] 配平
 *
 * 不识别：正则字面量、JSX、半段语义错误（例如缺少表达式）。
 * 这些会在 V8 报错时被原样透传，不会造成误杀。
 */

export interface ScriptSyntaxIssue {
  reason: string;
}

type ScanState =
  | 'normal'
  | 'single-quote'
  | 'double-quote'
  | 'template'
  | 'line-comment'
  | 'block-comment';

export function checkScriptSyntaxBalance(
  code: string,
): ScriptSyntaxIssue | null {
  let state: ScanState = 'normal';
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  // 模板字面量 `${...}` 嵌套：栈中每一项 = 进入 `${` 之后 brace 计数。
  // 当一个 `}` 把 brace 降回该值减一时，表示模板表达式结束。
  const templateBraceStack: number[] = [];

  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    const next = code[i + 1];

    switch (state) {
      case 'normal': {
        if (c === '/' && next === '/') {
          state = 'line-comment';
          i++;
          continue;
        }
        if (c === '/' && next === '*') {
          state = 'block-comment';
          i++;
          continue;
        }
        if (c === "'") {
          state = 'single-quote';
          continue;
        }
        if (c === '"') {
          state = 'double-quote';
          continue;
        }
        if (c === '`') {
          state = 'template';
          continue;
        }
        if (c === '(') {
          paren++;
        } else if (c === ')') {
          paren--;
          if (paren < 0) {
            return {
              reason: `多了一个 ')'（位置 ${i + 1}），无对应的 '('`,
            };
          }
        } else if (c === '{') {
          brace++;
        } else if (c === '}') {
          if (
            templateBraceStack.length > 0 &&
            brace === templateBraceStack[templateBraceStack.length - 1]
          ) {
            templateBraceStack.pop();
            brace--;
            state = 'template';
            continue;
          }
          brace--;
          if (brace < 0) {
            return {
              reason: `多了一个 '}'（位置 ${i + 1}），无对应的 '{'`,
            };
          }
        } else if (c === '[') {
          bracket++;
        } else if (c === ']') {
          bracket--;
          if (bracket < 0) {
            return {
              reason: `多了一个 ']'（位置 ${i + 1}），无对应的 '['`,
            };
          }
        }
        continue;
      }
      case 'single-quote':
      case 'double-quote': {
        if (c === '\\') {
          i++;
          continue;
        }
        if (state === 'single-quote' && c === "'") {
          state = 'normal';
        } else if (state === 'double-quote' && c === '"') {
          state = 'normal';
        }
        continue;
      }
      case 'template': {
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === '`') {
          state = 'normal';
          continue;
        }
        if (c === '$' && next === '{') {
          brace++;
          templateBraceStack.push(brace);
          state = 'normal';
          i++;
        }
        continue;
      }
      case 'line-comment': {
        if (c === '\n') {
          state = 'normal';
        }
        continue;
      }
      case 'block-comment': {
        if (c === '*' && next === '/') {
          state = 'normal';
          i++;
        }
        continue;
      }
    }
  }

  if (state === 'single-quote' || state === 'double-quote') {
    return {reason: '字符串字面量未闭合（缺少匹配的引号）'};
  }
  if (state === 'template') {
    return {reason: '模板字符串未闭合（缺少匹配的反引号）'};
  }
  if (state === 'block-comment') {
    return {reason: '块注释未闭合（缺少 */）'};
  }
  if (templateBraceStack.length > 0) {
    return {reason: '模板字符串中的 ${...} 未闭合'};
  }
  if (paren !== 0) {
    return {
      reason:
        paren > 0
          ? `function 定义不完整：缺少 ${paren} 个 ')'`
          : `function 定义不完整：多了 ${-paren} 个 ')'`,
    };
  }
  if (brace !== 0) {
    return {
      reason:
        brace > 0
          ? `function 定义不完整：缺少 ${brace} 个 '}'`
          : `function 定义不完整：多了 ${-brace} 个 '}'`,
    };
  }
  if (bracket !== 0) {
    return {
      reason:
        bracket > 0
          ? `function 定义不完整：缺少 ${bracket} 个 ']'`
          : `function 定义不完整：多了 ${-bracket} 个 ']'`,
    };
  }

  return null;
}

// ─── script.ts ───────────────────────────────────────────

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

type ContextProvider = Context;

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

type ScriptFormat = 'function' | 'script';

function buildContextEvaluationExpression(
  functionCode: string,
  format: ScriptFormat = 'function',
): string {
  if (format === 'script') {
    return `(async () => { const value = (0, eval)(${JSON.stringify(functionCode)}); return JSON.stringify(value instanceof Promise ? await value : value); })()`;
  }
  return `(async () => { const value = await (${functionCode}); return JSON.stringify(typeof value === 'function' ? await value() : value); })()`;
}

function hasDebuggerContextCapability(ctx: ContextProvider): boolean {
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
 * 可靠做法是向 CDP 要一次 frame 树，再用 Playwright 稳定的 DFS 顺序
 * （`page.frames()` 与 `Page.getFrameTree` 同为深度优先）定位到同一帧。
 * 顺序对不上时返回 undefined，退回"由调用方按多候选报歧义"的旧行为，
 * 而不是猜一个可能指向别的 frame 的 id。
 */
async function resolveSelectedFrameId(
  frame: Frame | null,
): Promise<string | undefined> {
  if (!frame) return undefined;

  let page: Page;
  try {
    page = frame.page();
  } catch {
    return undefined;
  }

  const frames = page.frames();
  const index = frames.indexOf(frame);
  if (index < 0) return undefined;

  try {
    const client = await page.context().newCDPSession(page);
    try {
      const {frameTree} = (await client.send('Page.getFrameTree')) as {
        frameTree?: {frame?: {id?: string}; childFrames?: unknown[]};
      };
      const ordered: Array<{id?: string}> = [];
      const walk = (node?: {
        frame?: {id?: string};
        childFrames?: Array<typeof node>;
      }): void => {
        if (!node) return;
        ordered.push(node.frame ?? {});
        for (const child of node.childFrames ?? []) walk(child);
      };
      walk(frameTree as never);
      return ordered[index]?.id;
    } finally {
      await client.detach().catch(() => undefined);
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
  format: ScriptFormat = 'function',
): Promise<string | undefined> {
  const runtimeResult = (await withTimeout(
    client.send('Runtime.evaluate', {
      expression: buildContextEvaluationExpression(functionCode, format),
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: {format?: ScriptFormat; args?: Array<JSHandle<any>>} = {},
): Promise<ScriptStructuredResult> {
  const format = options.format ?? 'function';
  const evalArgs = options.args ?? [];
  let fn: JSHandle<unknown> | undefined;
  try {
    if (format === 'script') {
      const result = await withTimeout(
        frame.evaluate(async (source: string) => {
          const value = (0, eval)(source);
          const resolved = value instanceof Promise ? await value : value;
          return JSON.stringify(resolved);
        }, functionCode),
        timeoutMs,
        'Script evaluation timed out',
      );
      return buildStructuredPayload(
        'evaluate_script',
        true,
        'Script ran on page and returned',
        result as string | undefined,
      );
    }

    fn = await withTimeout(
      frame.evaluateHandle(`(${functionCode})`),
      timeoutMs,
      'Script evaluation timed out',
    );
    const result = await withTimeout(
      evalArgs.length === 0
        ? frame.evaluate(async (value: unknown) => {
            const res =
              typeof value === 'function'
                ? await (value as () => unknown)()
                : await value;
            return JSON.stringify(res);
          }, fn)
        : frame.evaluate(
            async ([value, ...passedArgs]: [unknown, ...unknown[]]) => {
              const res =
                typeof value === 'function'
                  ? await (value as (...a: unknown[]) => unknown)(...passedArgs)
                  : await value;
              return JSON.stringify(res);
            },
            [fn, ...evalArgs] as unknown as [unknown, ...unknown[]],
          ),
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
    format: ScriptFormat;
    desiredContext: DesiredContext;
    explicitFrameId?: string;
    allowAnyFrame: boolean;
    filePath?: string;
    timeoutMs: number;
  },
  response: Response,
  toolContext?: Context,
): Promise<'handled' | 'unavailable'> {
  if (!hasDebuggerContextCapability(ctx)) {
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
        request.format,
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
    format: ScriptFormat;
    uidArgs?: string[];
    desiredContext: DesiredContext;
    filePath?: string;
    timeoutMs: number;
  },
  response: Response,
  toolContext?: Context,
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handles: Array<JSHandle<any>> = [];
  try {
    if (request.uidArgs?.length) {
      const page = ctx.getSelectedPage?.() ?? frame.page();
      for (const uid of request.uidArgs) {
        const locator = globalPageSnapshotManager.getLocatorByUid(page, uid);
        const handle = await locator.elementHandle();
        if (!handle) {
          throw createToolError(
            ErrorCodes.NOT_FOUND,
            `无法解析元素句柄：uid=${uid}`,
            {toolName: 'evaluate_script', uid},
          );
        }
        handles.push(handle);
      }
    }

    const result = await evaluateScriptFn(
      frame,
      request.functionCode,
      request.timeoutMs,
      {format: request.format, args: handles},
    );
    if (request.filePath && toolContext) {
      await writeEvaluationOutput(result.result, response, {
        filePath: request.filePath,
        context: toolContext,
      });
    } else {
      response.setStructuredContent(result);
    }
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
  } finally {
    for (const handle of handles) {
      void handle.dispose().catch(() => undefined);
    }
  }
}

async function resolveScriptSource(
  fnString: unknown,
  sourcePath: string | undefined,
): Promise<string> {
  if (fnString !== undefined && typeof fnString !== 'string') {
    throw createToolError(
      ErrorCodes.VALIDATION,
      `function 参数必须是字符串，但收到 ${typeof fnString}。请确保传入完整的函数表达式，如 () => { ... }`,
      {toolName: 'evaluate_script'},
    );
  }
  const hasFn = typeof fnString === 'string' && fnString.trim().length > 0;
  const hasPath =
    typeof sourcePath === 'string' && sourcePath.trim().length > 0;

  if (hasFn && hasPath) {
    throw createToolError(
      ErrorCodes.VALIDATION,
      'function 与 sourcePath 互斥，请仅提供其中一项。',
      {toolName: 'evaluate_script'},
    );
  }
  if (!hasFn && !hasPath) {
    throw createToolError(
      ErrorCodes.VALIDATION,
      '必须提供 function 或 sourcePath 参数，且不能为空。',
      {toolName: 'evaluate_script'},
    );
  }

  if (hasFn) {
    return fnString as string;
  }

  const trimmed = sourcePath!.trim();
  const fsPath = trimmed.startsWith('file://')
    ? fileURLToPath(trimmed)
    : path.resolve(trimmed);
  try {
    const content = await readFile(fsPath, 'utf-8');
    if (content.trim().length === 0) {
      throw createToolError(ErrorCodes.VALIDATION, `脚本文件为空：${fsPath}`, {
        toolName: 'evaluate_script',
        sourcePath,
      });
    }
    return content;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as {code: unknown}).code === ErrorCodes.VALIDATION
    ) {
      throw error;
    }
    throw createToolError(
      ErrorCodes.NOT_FOUND,
      `读取脚本文件失败 (${fsPath})：${getUnknownErrorMessage(error)}`,
      {toolName: 'evaluate_script', sourcePath},
    );
  }
}

export const evaluateScript = definePageTool({
  name: 'evaluate_script',
  description:
    '在页面上执行 JavaScript（支持 inline function 或本地 sourcePath 文件，支持按 function / script 模式解释、传入元素 uid args、处理执行期间弹窗及保存到文件）。',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  blockedByDialog: false,
  concurrency: 'exclusive',
  schema: {
    function: zod
      .string()
      .optional()
      .describe(
        'A complete, syntactically balanced JavaScript expression (与 sourcePath 二选一). ' +
          '函数表达式会被调用，其他表达式会直接返回求值结果。' +
          '示例：`document.title`、`(() => document.title)()`、`() => 1 + 1`、`async (el) => el.innerText`。',
      ),
    sourcePath: zod
      .string()
      .optional()
      .describe('本地 JavaScript 文件路径（与 function 互斥，不可同时提供）。'),
    format: zod
      .enum(['function', 'script'])
      .optional()
      .describe(
        '源码解释方式："function" 按函数/表达式执行并支持 args（默认）；"script" 按经典脚本顺序求值，不支持 args。',
      ),
    args: zod
      .array(zod.string())
      .optional()
      .describe(
        '可选：由 take_snapshot 返回的元素 uid 列表，作为参数传给 function。',
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
    dialogAction: zod
      .string()
      .optional()
      .describe(
        '脚本执行期间若触发弹窗的处理方式："accept"、"dismiss" 或作为 prompt 回答的文本。',
      ),
    waitForStableDom: zod
      .boolean()
      .optional()
      .describe(
        '脚本执行后是否等待 DOM 稳定（默认 false；DOM 变更脚本可传 true）。',
      ),
    timeoutMs: browserTimeoutSchema('脚本执行超时（毫秒，默认 30000）。'),
  },
  handler: async (request, response, toolContext) => {
    const desiredContext = (request.params.context ?? 'page') as DesiredContext;
    const explicitFrameId = request.params.frameId;
    const allowAnyFrame = request.params.allowAnyFrame ?? false;
    const filePath = request.params.filePath;
    const timeoutMs = request.params.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT;
    const format: ScriptFormat = request.params.format ?? 'function';
    const uidArgs = request.params.args;
    const dialogAction = request.params.dialogAction;
    const waitForStableDom = request.params.waitForStableDom;

    if (format === 'script' && uidArgs && uidArgs.length > 0) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        'args cannot be used when format is "script".',
        {toolName: 'evaluate_script'},
      );
    }

    const functionCode = await resolveScriptSource(
      request.params.function,
      request.params.sourcePath,
    );

    const syntaxIssue = checkScriptSyntaxBalance(functionCode);
    if (syntaxIssue) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        `脚本未送入页面执行：${syntaxIssue.reason}。请先补全 function 体后再调用 evaluate_script，不要逐字符重试。CLI 中的复杂或多行脚本请改用 --file <script.js> 或 --sourcePath <path>，或通过 --stdin 传入 JSON 参数。`,
        {toolName: 'evaluate_script'},
      );
    }

    const ctx = toolContext;
    if (!ctx) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        '脚本执行失败：运行时上下文不可用',
        {toolName: 'evaluate_script'},
      );
    }

    const evalRequest = {
      functionCode,
      format,
      uidArgs,
      desiredContext,
      explicitFrameId,
      allowAnyFrame,
      filePath,
      timeoutMs,
    };

    const executeEval = () =>
      withDebuggerTrapBypass(toolContext, async () => {
        if (!uidArgs?.length) {
          const outcome = await runOnDebuggerContext(
            ctx,
            evalRequest,
            response,
            toolContext,
          );
          if (outcome === 'handled') {
            return;
          }
        }
        await runOnFrame(ctx, evalRequest, response, toolContext);
      });

    if (
      (dialogAction !== undefined || waitForStableDom === true) &&
      typeof toolContext.waitForEventsAfterAction === 'function'
    ) {
      const waitResult = await toolContext.waitForEventsAfterAction(
        executeEval,
        {
          timeout: timeoutMs,
          waitForStableDom: Boolean(waitForStableDom),
          handleDialog: dialogAction ?? 'ignore',
        },
      );
      if (waitResult && response.attachWaitForResult) {
        response.attachWaitForResult(waitResult);
      }
      return;
    }

    await executeEval();
  },
});

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'script',
  description: 'Page script evaluation tools.',
  profile: 'workflow',
  tools: [{modulePath: './script.js', handlerName: 'evaluateScript'}],
} satisfies DomainManifest;
