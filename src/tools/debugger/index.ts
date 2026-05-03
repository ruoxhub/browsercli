/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from 'patchright';

import type {
  BreakpointInfo,
  PausedState,
  ScriptInfo,
} from '../../utils/DebuggerContext.js';
import type {ToolContextProvider} from '../../worker/ToolContextProvider.js';

import {hookFunction as hookFunctionImpl} from './hookFunction.js';
import type {DebuggerResult} from './types.js';

export {hookFunction} from './hookFunction.js';
export {unhookFunction} from './unhookFunction.js';
export {listHooks} from './listHooks.js';
export {inspectObject} from './inspectObject.js';
export {getStorage} from './getStorage.js';
export {monitorEvents} from './monitorEvents.js';
export {stopMonitor} from './stopMonitor.js';
export type {
  DebuggerResult,
  HookFunctionParams,
  HookFunctionData,
  HookFunctionResult,
  UnhookFunctionResult,
  HookEntry,
  ListHooksResult,
  InspectObjectParams,
  InspectObjectResult,
  StorageType,
  GetStorageParams,
  GetStorageResult,
  MonitorEventsParams,
  MonitorEventsResult,
  StopMonitorResult,
  Frame,
} from './types.js';

type DebuggerRuntime = Pick<
  ToolContextProvider,
  | 'getDebuggerContext'
  | 'getSelectedPage'
  | 'getSelectedFrame'
  | 'getNetworkRequestById'
  | 'getRequestInitiator'
>;

interface TraceFunctionParams {
  target?: string;
  logArgs?: boolean;
  logResult?: boolean;
  logStack?: boolean;
  hookId?: string;
}

function success(
  tooltype: string,
  message: string,
  data?: unknown,
): DebuggerResult {
  return {success: true, message, tooltype, data};
}

function failure(tooltype: string, message: string): DebuggerResult {
  return {success: false, message, tooltype};
}

function ensureString(
  value: unknown,
  name: string,
  tooltype: string,
): string | DebuggerResult {
  if (typeof value !== 'string' || value.trim() === '') {
    return failure(
      tooltype,
      `${name} 参数不能为空。需要提供一个字符串值，例如: --${name} "value"`,
    );
  }
  return value;
}

function ensureLineNumber(
  value: unknown,
  tooltype: string,
): number | DebuggerResult {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return failure(tooltype, 'lineNumber 必须是非负整数');
  }
  return value;
}

function summarizeBreakpoints(breakpoints: BreakpointInfo[]): string {
  if (breakpoints.length === 0) {
    return '当前无活跃断点';
  }
  return `当前共有 ${breakpoints.length} 个活跃断点`;
}

function summarizeScripts(scripts: ScriptInfo[], filter?: string): string {
  if (scripts.length === 0) {
    return filter ? `未找到匹配过滤词 "${filter}" 的脚本` : '当前无已记录脚本';
  }
  return filter
    ? `找到 ${scripts.length} 个匹配过滤词 "${filter}" 的脚本`
    : `已记录 ${scripts.length} 个脚本`;
}

function findMatches(
  source: string,
  query: string,
  caseSensitive = false,
): Array<{index: number; lineNumber: number; columnNumber: number}> {
  const haystack = caseSensitive ? source : source.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: Array<{
    index: number;
    lineNumber: number;
    columnNumber: number;
  }> = [];

  if (!needle) {
    return matches;
  }

  let fromIndex = 0;
  while (fromIndex < haystack.length) {
    const index = haystack.indexOf(needle, fromIndex);
    if (index === -1) {
      break;
    }
    const prefix = source.slice(0, index);
    const lines = prefix.split('\n');
    matches.push({
      index,
      lineNumber: lines.length - 1,
      columnNumber: lines.at(-1)?.length ?? 0,
    });
    fromIndex = index + Math.max(needle.length, 1);
  }

  return matches;
}

async function getDebugger(runtime: DebuggerRuntime) {
  if (!runtime || typeof runtime.getDebuggerContext !== 'function') {
    throw new Error(
      '缺少调试运行时上下文。请确保已选择页面且调试器可用。',
    );
  }
  try {
    return await runtime.getDebuggerContext();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`获取调试上下文失败: ${detail}`);
  }
}

function getTraceFrame(runtime: DebuggerRuntime) {
  const frame = runtime.getSelectedFrame();
  if (frame) {
    return frame;
  }

  const page = runtime.getSelectedPage() as Page | null;
  return page?.mainFrame() ?? null;
}

/**
 * 设置断点。
 */
export async function setBreakpoint(
  runtime: DebuggerRuntime,
  params: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
    condition?: string;
    isRegex?: boolean;
  } = {},
): Promise<DebuggerResult> {
  const url = ensureString(params.url, 'url', 'set_breakpoint');
  if (typeof url !== 'string') {
    return url;
  }
  const lineNumber = ensureLineNumber(params.lineNumber, 'set_breakpoint');
  if (typeof lineNumber !== 'number') {
    return lineNumber;
  }

  const debuggerContext = await getDebugger(runtime);
  const breakpoint = params.isRegex
    ? await debuggerContext.setBreakpointByUrlRegex(
        url,
        lineNumber,
        params.columnNumber ?? 0,
        params.condition,
      )
    : await debuggerContext.setBreakpoint(
        url,
        lineNumber,
        params.columnNumber ?? 0,
        params.condition,
      );

  return success(
    'set_breakpoint',
    `断点已设置: ${url}:${lineNumber}`,
    breakpoint,
  );
}

/**
 * 移除断点。
 */
export async function removeBreakpoint(
  runtime: DebuggerRuntime,
  params: {breakpointId?: string} = {},
): Promise<DebuggerResult> {
  const breakpointId = ensureString(
    params.breakpointId,
    'breakpointId',
    'remove_breakpoint',
  );
  if (typeof breakpointId !== 'string') {
    return breakpointId;
  }

  const debuggerContext = await getDebugger(runtime);
  await debuggerContext.removeBreakpoint(breakpointId);

  return success('remove_breakpoint', `断点已移除: ${breakpointId}`, {
    breakpointId,
  });
}

/**
 * 列出所有断点。
 */
export async function listBreakpoints(
  runtime: DebuggerRuntime,
): Promise<DebuggerResult> {
  const debuggerContext = await getDebugger(runtime);
  const breakpoints = debuggerContext.getBreakpoints();
  return success(
    'list_breakpoints',
    summarizeBreakpoints(breakpoints),
    breakpoints,
  );
}

/**
 * 单步进入。
 */
export async function stepInto(
  runtime: DebuggerRuntime,
): Promise<DebuggerResult> {
  const debuggerContext = await getDebugger(runtime);
  await debuggerContext.stepInto();
  return success('step_into', '单步进入执行完成');
}

/**
 * 单步跳过。
 */
export async function stepOver(
  runtime: DebuggerRuntime,
): Promise<DebuggerResult> {
  const debuggerContext = await getDebugger(runtime);
  await debuggerContext.stepOver();
  return success('step_over', '单步跳过执行完成');
}

/**
 * 单步跳出。
 */
export async function stepOut(
  runtime: DebuggerRuntime,
): Promise<DebuggerResult> {
  const debuggerContext = await getDebugger(runtime);
  await debuggerContext.stepOut();
  return success('step_out', '单步跳出执行完成');
}

/**
 * 继续执行。
 */
export async function resume(
  runtime: DebuggerRuntime,
): Promise<DebuggerResult> {
  const debuggerContext = await getDebugger(runtime);
  await debuggerContext.resume();
  return success('resume', '执行已恢复');
}

/**
 * 暂停执行。
 */
export async function pause(runtime: DebuggerRuntime): Promise<DebuggerResult> {
  const debuggerContext = await getDebugger(runtime);
  await debuggerContext.pause();
  return success('pause', '已请求暂停执行');
}

/**
 * 列出页面加载的脚本。
 */
export async function listScripts(
  runtime: DebuggerRuntime,
  params: {filter?: string} = {},
): Promise<DebuggerResult> {
  const debuggerContext = await getDebugger(runtime);
  const scripts = params.filter
    ? debuggerContext.getScriptsByUrlPattern(params.filter)
    : debuggerContext.getScripts();

  return success(
    'list_scripts',
    summarizeScripts(scripts, params.filter),
    scripts,
  );
}

/**
 * 获取脚本源码。
 */
export async function getScriptSource(
  runtime: DebuggerRuntime,
  params: {
    scriptId?: string;
    script_id?: string;
    scriptid?: string;
    urlPattern?: string;
    urlFilter?: string;
    offset?: number;
    limit?: number;
  } = {},
): Promise<DebuggerResult> {
  const debuggerContext = await getDebugger(runtime);
  const requestedScriptId =
    params.scriptId ?? params.script_id ?? params.scriptid;
  const urlPattern = params.urlPattern ?? params.urlFilter;
  let scriptId = requestedScriptId;
  let resolution:
    | {mode: 'scriptId'; pattern?: undefined}
    | {mode: 'urlPattern'; pattern: string}
    | undefined;

  if (!scriptId && typeof urlPattern === 'string' && urlPattern.trim()) {
    const matches = debuggerContext.getScriptsByUrlPattern(urlPattern);
    scriptId = matches[0]?.scriptId;
    resolution = {mode: 'urlPattern', pattern: urlPattern};
    if (!scriptId) {
      return failure(
        'get_script_source',
        `未找到匹配 URL 模式 "${urlPattern}" 的脚本`,
      );
    }
  } else {
    const validatedScriptId = ensureString(
      scriptId,
      'scriptId',
      'get_script_source',
    );
    if (typeof validatedScriptId !== 'string') {
      return validatedScriptId;
    }
    scriptId = validatedScriptId;
    resolution = {mode: 'scriptId'};
  }

  const fullSource = await debuggerContext.getScriptSource(scriptId);
  const script = debuggerContext.getScriptById(scriptId);

  const offset =
    typeof params.offset === 'number' && params.offset >= 0
      ? params.offset
      : 0;
  const limit =
    typeof params.limit === 'number' && params.limit > 0
      ? params.limit
      : fullSource.length;
  const source = fullSource.substring(offset, offset + limit);
  const isPartial = offset > 0 || source.length < fullSource.length;

  return success(
    'get_script_source',
    `已获取脚本源码: ${scriptId}${isPartial ? ` (偏移 ${offset}, 长度 ${source.length} / ${fullSource.length})` : ''}`,
    {
      script,
      source,
      fullLength: fullSource.length,
      resolution,
      partial: isPartial,
      offset,
      limit: source.length,
    },
  );
}

/**
 * 在源码中搜索。
 */
export async function searchInSources(
  runtime: DebuggerRuntime,
  params: {
    query?: string;
    caseSensitive?: boolean;
    isRegex?: boolean;
    maxResults?: number;
    contextLines?: number;
    contextChars?: number;
    maxLineLength?: number;
    urlFilter?: string;
    scriptId?: string;
  } = {},
): Promise<DebuggerResult> {
  const query = ensureString(params.query, 'query', 'search_in_sources');
  if (typeof query !== 'string') {
    return query;
  }

  const debuggerContext = await getDebugger(runtime);
  const result = await debuggerContext.searchInScripts(query, {
    caseSensitive: params.caseSensitive,
    isRegex: params.isRegex,
  });
  let filteredMatches =
    typeof params.urlFilter === 'string' && params.urlFilter.length > 0
      ? result.matches.filter(match => match.url?.includes(params.urlFilter!))
      : result.matches;
  if (typeof params.scriptId === 'string' && params.scriptId.length > 0) {
    filteredMatches = filteredMatches.filter(
      match => match.scriptId === params.scriptId,
    );
  }
  const limitedMatches = params.maxResults
    ? filteredMatches.slice(0, params.maxResults)
    : filteredMatches;

  const hasLineContext =
    typeof params.contextLines === 'number' && params.contextLines > 0;
  const hasCharContext =
    typeof params.contextChars === 'number' && params.contextChars > 0;

  const matches =
    hasLineContext || hasCharContext
      ? await Promise.all(
          limitedMatches.map(async match => {
            const context = hasCharContext
              ? await buildCharSearchContext(debuggerContext, match, {
                  contextChars: params.contextChars!,
                  maxLineLength: params.maxLineLength,
                })
              : await buildSearchContext(debuggerContext, match, {
                  contextLines: params.contextLines!,
                  maxLineLength: params.maxLineLength,
                });
            return {...match, context};
          }),
        )
      : limitedMatches;

  return success(
    'search_in_sources',
    `源码搜索完成，命中 ${matches.length} 条`,
    {...result, matches, totalMatches: filteredMatches.length},
  );
}

async function buildSearchContext(
  debuggerContext: Awaited<ReturnType<typeof getDebugger>>,
  match: {scriptId: string; lineNumber: number; lineContent: string},
  options: {contextLines: number; maxLineLength?: number},
) {
  const source = await debuggerContext.getScriptSource(match.scriptId);
  const lines = source.split('\n');
  const startLine = Math.max(0, match.lineNumber - options.contextLines);
  const endLine = Math.min(
    lines.length - 1,
    match.lineNumber + options.contextLines,
  );
  const formatLine = (line: string) =>
    truncateSourceLine(line, options.maxLineLength);
  const before = lines.slice(startLine, match.lineNumber).map(formatLine);
  const line = formatLine(lines[match.lineNumber] ?? match.lineContent);
  const after = lines.slice(match.lineNumber + 1, endLine + 1).map(formatLine);

  return {
    before,
    line,
    after,
    truncated:
      before.some(item => item.endsWith('...')) ||
      line.endsWith('...') ||
      after.some(item => item.endsWith('...')),
  };
}

async function buildCharSearchContext(
  debuggerContext: Awaited<ReturnType<typeof getDebugger>>,
  match: {scriptId: string; lineNumber: number; lineContent: string},
  options: {contextChars: number; maxLineLength?: number},
) {
  const source = await debuggerContext.getScriptSource(match.scriptId);
  const lines = source.split('\n');
  let lineStartOffset = 0;
  for (let i = 0; i < match.lineNumber && i < lines.length; i++) {
    lineStartOffset += lines[i].length + 1; // +1 for newline
  }
  const lineEndOffset = lineStartOffset + match.lineContent.length;
  const start = Math.max(0, lineStartOffset - options.contextChars);
  const end = Math.min(source.length, lineEndOffset + options.contextChars);

  const before = source.substring(start, lineStartOffset);
  const line = truncateSourceLine(
    source.substring(lineStartOffset, lineEndOffset),
    options.maxLineLength,
  );
  const after = source.substring(lineEndOffset, end);

  return {
    before,
    line,
    after,
    truncated: start > 0 || end < source.length,
  };
}

function truncateSourceLine(line: string, maxLineLength?: number): string {
  if (
    typeof maxLineLength !== 'number' ||
    maxLineLength <= 0 ||
    line.length <= maxLineLength
  ) {
    return line;
  }

  const prefix = line.slice(0, maxLineLength);
  const lastSpace = prefix.lastIndexOf(' ');
  const safePrefix =
    lastSpace > Math.floor(maxLineLength / 2)
      ? prefix.slice(0, lastSpace)
      : prefix;
  return `${safePrefix.trimEnd()}...`;
}

/**
 * 设置 XHR 断点。
 */
export async function breakOnXhr(
  runtime: DebuggerRuntime,
  params: {url?: string} = {},
): Promise<DebuggerResult> {
  const debuggerContext = await getDebugger(runtime);
  const client = debuggerContext.getClient();
  if (!client) {
    return failure('break_on_xhr', 'Debugger 尚未启用');
  }

  const url = typeof params.url === 'string' ? params.url : '';
  await client.send('DOMDebugger.setXHRBreakpoint', {url});
  return success('break_on_xhr', `XHR 断点已设置: ${url || '*'}`, {
    url: url || '*',
  });
}

/**
 * 移除 XHR 断点。
 */
export async function removeXhrBreakpoint(
  runtime: DebuggerRuntime,
  params: {url?: string} = {},
): Promise<DebuggerResult> {
  const debuggerContext = await getDebugger(runtime);
  const client = debuggerContext.getClient();
  if (!client) {
    return failure('remove_xhr_breakpoint', 'Debugger 尚未启用');
  }

  const url = typeof params.url === 'string' ? params.url : '';
  await client.send('DOMDebugger.removeXHRBreakpoint', {url});
  return success('remove_xhr_breakpoint', `XHR 断点已移除: ${url || '*'}`, {
    url: url || '*',
  });
}

/**
 * 追踪函数调用。
 */
export async function traceFunction(
  runtime: DebuggerRuntime,
  params: TraceFunctionParams = {},
): Promise<DebuggerResult> {
  const target = ensureString(params.target, 'target', 'trace_function');
  if (typeof target !== 'string') {
    return target;
  }

  const frame = getTraceFrame(runtime);
  if (!frame) {
    return failure('trace_function', '当前没有可用的页面或 Frame');
  }

  const result = await hookFunctionImpl(frame, {
    target,
    logArgs: params.logArgs,
    logResult: params.logResult,
    logStack: params.logStack,
    hookId: params.hookId,
  });

  return {
    ...result,
    tooltype: 'trace_function',
    message: result.success ? `函数追踪已启动: ${target}` : result.message,
  };
}

/**
 * 获取 AI 调试状态。
 */
export async function getAiDebugStatus(
  runtime: DebuggerRuntime,
): Promise<DebuggerResult> {
  const debuggerContext = await getDebugger(runtime);
  const pausedState = debuggerContext.getPausedState();
  const breakpoints = debuggerContext.getBreakpoints();
  const scripts = debuggerContext.getScripts();

  return success('get_ai_debug_status', '已获取调试状态', {
    isPaused: pausedState.isPaused,
    breakpointCount: breakpoints.length,
    scriptCount: scripts.length,
    lastAutoRecoveryEvent: debuggerContext.getLastAutoRecoveryEvent(),
  });
}

/**
 * 在脚本中查找文本。
 */
export async function findInScript(
  runtime: DebuggerRuntime,
  params: {scriptId?: string; query?: string; caseSensitive?: boolean} = {},
): Promise<DebuggerResult> {
  const scriptId = ensureString(params.scriptId, 'scriptId', 'find_in_script');
  if (typeof scriptId !== 'string') {
    return scriptId;
  }
  const query = ensureString(params.query, 'query', 'find_in_script');
  if (typeof query !== 'string') {
    return query;
  }

  const debuggerContext = await getDebugger(runtime);
  const source = await debuggerContext.getScriptSource(scriptId);
  const matches = findMatches(source, query, params.caseSensitive);

  return success(
    'find_in_script',
    `在脚本 ${scriptId} 中找到 ${matches.length} 处匹配`,
    {scriptId, query, matches},
  );
}

/**
 * 获取请求发起者信息。
 */
export async function getRequestInitiator(
  runtime: DebuggerRuntime,
  params: {requestId?: number} = {},
): Promise<DebuggerResult> {
  if (typeof params.requestId !== 'number') {
    return failure('get_request_initiator', 'requestId 必须是数字');
  }

  const request = runtime.getNetworkRequestById(params.requestId);
  const initiator = runtime.getRequestInitiator(request);

  if (!initiator) {
    return failure(
      'get_request_initiator',
      `请求 ${params.requestId} 没有 initiator 信息`,
    );
  }

  return success(
    'get_request_initiator',
    `已获取请求 ${params.requestId} 的发起者信息`,
    initiator,
  );
}

/**
 * 获取当前暂停信息。
 */
export async function getPausedInfo(
  runtime: DebuggerRuntime,
): Promise<DebuggerResult> {
  const debuggerContext = await getDebugger(runtime);
  const pausedState = debuggerContext.getPausedState();

  if (!pausedState.isPaused) {
    return success('get_paused_info', '当前未暂停', pausedState);
  }

  return success(
    'get_paused_info',
    `当前已暂停，调用帧数量 ${pausedState.callFrames.length}`,
    pausedState,
  );
}

/**
 * 在调用帧上执行表达式。
 */
export async function evaluateOnCallframe(
  runtime: DebuggerRuntime,
  params: {callFrameId?: string; expression?: string} = {},
): Promise<DebuggerResult> {
  const expression = ensureString(
    params.expression,
    'expression',
    'evaluate_on_callframe',
  );
  if (typeof expression !== 'string') {
    return expression;
  }

  const debuggerContext = await getDebugger(runtime);
  const pausedState = debuggerContext.getPausedState();

  if (!pausedState.isPaused) {
    return failure(
      'evaluate_on_callframe',
      '当前未处于暂停状态，无法执行表达式。请先命中断点或调用 pause。',
    );
  }

  const callFrameId =
    params.callFrameId ?? pausedState.callFrames[0]?.callFrameId;
  if (!callFrameId || typeof callFrameId !== 'string') {
    return failure(
      'evaluate_on_callframe',
      '当前没有可用的调用帧。请确认已命中断点，或显式提供 --callFrameId 参数（可从 get_paused_info 获取）。',
    );
  }

  try {
    const result = await debuggerContext.evaluateOnCallFrame(
      callFrameId,
      expression,
      {returnByValue: true},
    );
    return success(
      'evaluate_on_callframe',
      `表达式已在调用帧 ${callFrameId} 上执行`,
      result,
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : String(error);
    return failure(
      'evaluate_on_callframe',
      `表达式执行失败: ${detail}。请确认 callFrameId "${callFrameId}" 有效且调试器仍处于暂停状态。`,
    );
  }
}

/**
 * 检查当前暂停栈的局部变量摘要。
 */
export async function inspectLocals(
  runtime: DebuggerRuntime,
): Promise<DebuggerResult> {
  const debuggerContext = await getDebugger(runtime);
  const pausedState = debuggerContext.getPausedState();

  if (!pausedState.isPaused) {
    return failure('inspect_locals', '当前未处于暂停状态');
  }

  const frames = await Promise.all(
    pausedState.callFrames.map(async (frame, idx) => {
      const locals: Array<{name: string; type: string; value: unknown}> = [];
      const localScope = frame.scopeChain.find(s => s.type === 'local');
      if (localScope?.object?.objectId) {
        try {
          const vars = await debuggerContext.getScopeVariables(
            localScope.object.objectId,
          );
          locals.push(
            ...vars.map(v => ({
              name: v.name,
              type: v.type,
              value: v.value,
            })),
          );
        } catch {
          // 忽略单个作用域读取失败
        }
      }
      return {
        index: idx,
        callFrameId: frame.callFrameId,
        functionName: frame.functionName,
        scriptId: frame.location.scriptId,
        url: frame.url,
        lineNumber: frame.location.lineNumber,
        locals,
        localCount: locals.length,
      };
    }),
  );

  return success(
    'inspect_locals',
    `当前暂停栈共 ${frames.length} 帧，已读取局部变量摘要`,
    {frames, totalFrames: frames.length},
  );
}

/**
 * 在文本上设置断点。
 */
export async function setBreakpointOnText(
  runtime: DebuggerRuntime,
  params: {
    text?: string;
    occurrence?: number;
    condition?: string;
    caseSensitive?: boolean;
  } = {},
): Promise<DebuggerResult> {
  const text = ensureString(params.text, 'text', 'set_breakpoint_on_text');
  if (typeof text !== 'string') {
    return text;
  }

  const debuggerContext = await getDebugger(runtime);
  const result = await debuggerContext.searchInScripts(text, {
    caseSensitive: params.caseSensitive,
  });
  const occurrence = Math.max(1, params.occurrence ?? 1);
  const match = result.matches[occurrence - 1];

  if (!match?.url) {
    return failure(
      'set_breakpoint_on_text',
      `未找到文本 "${text}" 对应的可断点脚本位置`,
    );
  }

  const breakpoint = await debuggerContext.setBreakpoint(
    match.url,
    match.lineNumber,
    0,
    params.condition,
  );
  return success('set_breakpoint_on_text', `文本断点已设置: "${text}"`, {
    match,
    breakpoint,
  });
}

/**
 * XHR 到 JS 断点转换。
 */
export async function xhrToJsBreakpoint(
  runtime: DebuggerRuntime,
  params: {url?: string} = {},
): Promise<DebuggerResult> {
  const xhrResult = await breakOnXhr(runtime, params);
  if (!xhrResult.success) {
    return xhrResult;
  }

  return success(
    'xhr_to_js_breakpoint',
    '已设置 XHR 断点；命中后可结合 get_paused_info / set_breakpoint 完成 JS 断点定位',
    xhrResult.data,
  );
}

/**
 * 开始连续调试。
 */
export async function startContinuousDebugging(
  _runtime: DebuggerRuntime,
): Promise<DebuggerResult> {
  return failure(
    'start_continuous_debugging',
    '当前工具层尚未接入 AIContinuousDebugger 运行时，请改用 pause/set_breakpoint/get_paused_info 组合',
  );
}

/**
 * 停止连续调试。
 */
export async function stopContinuousDebugging(
  _runtime: DebuggerRuntime,
): Promise<DebuggerResult> {
  return failure('stop_continuous_debugging', '当前没有可停止的连续调试会话');
}
