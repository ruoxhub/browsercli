/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {PackerDeobfuscator} from '../../modules/deobfuscator/PackerDeobfuscator.js';
import {zod} from '../../third_party/index.js';
import type {ToolContextProvider} from '../../worker/ToolContext.js';
import type {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

// ─── 子模块工具导出（defineTool 格式）─────────────────────

export {hookFunction} from './hookFunction.js';
export {unhookFunction} from './unhookFunction.js';
export {listHooks} from './listHooks.js';
export {inspectObject} from './inspectObject.js';
export {getStorage} from './getStorage.js';
export {monitorEvents} from './monitorEvents.js';
export {stopMonitor} from './stopMonitor.js';

// ─── 类型导出 ─────────────────────────────────────────

export type {Frame} from './types.js';

// ─── 内部类型 ─────────────────────────────────────────

type DebuggerRuntime = Pick<
  ToolContextProvider,
  | 'getDebuggerContext'
  | 'getSelectedPage'
  | 'getSelectedFrame'
  | 'getNetworkRequestById'
  | 'getRequestInitiator'
>;

// ─── 辅助函数 ───────────────────────────────────────────────

/**
 * 从工具 Context 获取 DebuggerContext。
 *
 * 注：Context 既可能是 ToolAdapter 构建的 defineTool Context（拥有
 * `getDebuggerContext(): Promise<DebuggerContext>`），也可能直接是
 * ToolContextProvider 本身（旧路径，历史兼容）。两者都暴露同名方法，
 * 所以这里用鸭子类型。
 */
async function getDebugger(runtime: DebuggerRuntime) {
  if (!runtime || typeof runtime.getDebuggerContext !== 'function') {
    throw new Error(
      '缺少调试运行时上下文。请确保：1) 已选中页面；2) 工具通过 defineTool 上下文调用（ToolAdapter）。',
    );
  }
  try {
    return await runtime.getDebuggerContext();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`获取调试上下文失败: ${detail}`);
  }
}

/**
 * 工具 handler 通用包装：成功路径执行 `run()`，异常路径自动填充
 * `{success: false, tooltype, message, data}` 结构化响应。
 *
 * 用于消除各 defineTool handler 中重复的 try/catch + setStructuredContent
 * 样板。`errorData` 允许按请求参数回填少量字段（如 url、hookId）。
 */
async function runTool<P = unknown>(
  response: {setStructuredContent(content: unknown): void},
  request: {params: P},
  tooltype: string,
  run: () => Promise<void>,
  options: {
    errorData?: (params: P) => Record<string, unknown>;
    errorPrefix?: string;
  } = {},
): Promise<void> {
  const {errorData = () => ({}), errorPrefix} = options;
  try {
    await run();
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = errorPrefix ? `${errorPrefix}: ${raw}` : raw;
    response.setStructuredContent({
      success: false,
      message,
      tooltype,
      data: errorData(request.params),
    });
  }
}

/**
 * step_into / step_over / step_out 三工具共享逻辑：校验暂停态、执行
 * 单步动作、组装 pausedInfo 响应。
 */
function defineStepTool(config: {
  name: 'step_into' | 'step_over' | 'step_out';
  title: string;
  description: string;
  action: 'stepInto' | 'stepOver' | 'stepOut';
  notPausedMessage: string;
  successMessage: string;
  failurePrefix: string;
}) {
  return defineTool({
    name: config.name,
    description: config.description,
    annotations: {
      title: config.title,
      category: 'debugging' as ToolCategory,
      readOnlyHint: false,
    },
    schema: {
      includePausedInfo: zod
        .boolean()
        .optional()
        .default(true)
        .describe('返回值是否携带暂停后的 callFrames/scopes（默认 true）。'),
      includeScopes: zod
        .boolean()
        .optional()
        .default(true)
        .describe('暂停信息中是否包含作用域变量（默认 true）。'),
    },
    handler: async (request, response, context) => {
      const runtime = context as unknown as DebuggerRuntime;

      await runTool(
        response,
        request,
        config.name,
        async () => {
          const debuggerContext = await getDebugger(runtime);
          const pausedState = debuggerContext.getPausedState();
          if (!pausedState.isPaused) {
            response.setStructuredContent({
              success: false,
              message: config.notPausedMessage,
              tooltype: config.name,
              data: {isPaused: false},
            });
            return;
          }
          await debuggerContext[config.action]();
          const pausedInfo =
            request.params.includePausedInfo !== false
              ? await buildPausedInfoData(debuggerContext, {
                  includeScopes: request.params.includeScopes,
                })
              : null;
          response.setStructuredContent({
            success: true,
            message: config.successMessage,
            tooltype: config.name,
            data: {
              action: config.action,
              isPaused: pausedInfo !== null,
              pausedInfo: pausedInfo ?? undefined,
            },
          });
        },
        {errorPrefix: config.failurePrefix},
      );
    },
  });
}

/**
 * break_on_xhr / remove_xhr_breakpoint / xhr_to_js_breakpoint 共享的
 * CDP 调用与响应结构。
 */
function defineXhrBreakpointTool(config: {
  name: string;
  description: string;
  title: string;
  cdpMethod: string;
  buildSuccessMessage: (url: string) => string;
  successData: (url: string) => Record<string, unknown>;
  failurePrefix: string;
}) {
  return defineTool({
    name: config.name,
    description: config.description,
    annotations: {
      title: config.title,
      category: 'reverse_engineering' as ToolCategory,
      readOnlyHint: false,
    },
    schema: {
      url: zod.string().optional().describe('XHR URL 模式（部分匹配）。'),
    },
    handler: async (request, response, context) => {
      const runtime = context as unknown as DebuggerRuntime;
      const url = request.params.url ?? '';

      await runTool(
        response,
        request,
        config.name,
        async () => {
          const debuggerContext = await getDebugger(runtime);
          const client = debuggerContext.getClient();
          if (!client) {
            response.setStructuredContent({
              success: false,
              message: 'Debugger 客户端不可用。',
              tooltype: config.name,
              data: {},
            });
            return;
          }
          await client.send(config.cdpMethod as 'DOMDebugger.setXHRBreakpoint', {url});
          response.setStructuredContent({
            success: true,
            message: config.buildSuccessMessage(url || '*'),
            tooltype: config.name,
            data: config.successData(url || '*'),
          });
        },
        {
          errorPrefix: config.failurePrefix,
          errorData: () => ({url: request.params.url}),
        },
      );
    },
  });
}

/**
 * Shape of the structured `data` field returned by `get_paused_info` and
 * embedded in `step_*` responses when execution stays paused.
 */
export interface PausedInfoData {
  isPaused: true;
  reason?: string;
  hitBreakpoints?: string[];
  callFrames: Array<{
    index: number;
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
    callFrameId: string;
  }>;
  scopes?: Array<{
    scopeName: string;
    scopeType: string;
    variables?: Array<{name: string; value: unknown}>;
  }>;
}

/**
 * Build the structured paused-info payload from the debugger's current state.
 * Returns `null` when execution is not paused so callers can short-circuit.
 *
 * Why a shared helper: `get_paused_info`, `step_into`, `step_over`, and
 * `step_out` all need the same shape; without this, single-step flows pay
 * an extra MCP roundtrip just to read the call stack after stepping.
 */
export async function buildPausedInfoData(
  debuggerContext: Awaited<ReturnType<DebuggerRuntime['getDebuggerContext']>>,
  options: {includeScopes?: boolean} = {},
): Promise<PausedInfoData | null> {
  const pausedState = debuggerContext.getPausedState();
  if (!pausedState.isPaused) {
    return null;
  }

  const callFrames = pausedState.callFrames.map((frame, i) => {
    const script = debuggerContext.getScriptById(frame.location.scriptId);
    const url =
      script?.url || frame.url || `script:${frame.location.scriptId}`;
    return {
      index: i + 1,
      functionName: frame.functionName,
      url,
      lineNumber: frame.location.lineNumber + 1,
      columnNumber: frame.location.columnNumber,
      callFrameId: frame.callFrameId,
    };
  });

  const result: PausedInfoData = {
    isPaused: true,
    reason: pausedState.reason || undefined,
    hitBreakpoints:
      pausedState.hitBreakpoints?.length > 0
        ? pausedState.hitBreakpoints
        : undefined,
    callFrames,
  };

  if (options.includeScopes !== false && pausedState.callFrames.length > 0) {
    const topFrame = pausedState.callFrames[0];
    const scopes: NonNullable<PausedInfoData['scopes']> = [];

    for (const scope of topFrame.scopeChain) {
      if (scope.type === 'global') {
        continue;
      }

      const scopeData: NonNullable<PausedInfoData['scopes']>[number] = {
        scopeName: scope.name || scope.type,
        scopeType: scope.type,
      };

      if (scope.object.objectId) {
        try {
          const variables = await debuggerContext.getScopeVariables(
            scope.object.objectId,
          );

          if (variables.length > 0) {
            scopeData.variables = variables.slice(0, 20).map(v => ({
              name: v.name,
              value: v.value,
            }));
            if (variables.length > 20) {
              scopeData.variables.push({
                name: `... 还有 ${variables.length - 20} 个`,
                value: null,
              });
            }
          }
        } catch {
          // ignore individual scope read failures
        }
      }

      scopes.push(scopeData);
    }

    result.scopes = scopes;
  }

  return result;
}

// ─── 工具定义（defineTool 格式）───────────────────────────────

/**
 * 设置断点。
 */
export const setBreakpoint = defineTool({
  name: 'set_breakpoint',
  description:
    '设置 JavaScript 断点。支持按脚本 URL 和行号设置，可选条件表达式。注意：优先使用 hook_function 或 trace_function 进行监控，断点需要暂停/恢复协调，在自动化流程中容易出错。',
  annotations: {
    title: '设置断点',
    category: 'debugging' as ToolCategory,
    readOnlyHint: false,
  },
  schema: {
    url: zod.string().describe('JavaScript 文件的 URL（支持部分匹配或正则）.'),
    lineNumber: zod.number().int().describe('断点行号（1-based）.'),
    columnNumber: zod.number().int().optional().default(0).describe('列号（0-based，可选）.'),
    condition: zod.string().optional().describe('条件表达式，满足条件时断点才触发（可选）.'),
    isRegex: zod.boolean().optional().default(false).describe('是否将 URL 视为正则表达式.'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;
    const url = request.params.url;
    const lineNumber = request.params.lineNumber;
    const columnNumber = request.params.columnNumber;
    const condition = request.params.condition;
    const isRegex = request.params.isRegex;

    if (!url || typeof url !== 'string' || url.trim() === '') {
      response.setStructuredContent({
        success: false,
        message: "url 参数不能为空。",
        tooltype: 'set_breakpoint',
        data: {}
      });
      return;
    }

    const lineNum = typeof lineNumber === 'number' ? lineNumber : 1;

    try {
      const debuggerContext = await getDebugger(runtime);
      const breakpoint = isRegex
        ? await debuggerContext.setBreakpointByUrlRegex(
            url,
            lineNum - 1,
            columnNumber ?? 0,
            condition,
          )
        : await debuggerContext.setBreakpoint(
            url,
            lineNum - 1,
            columnNumber ?? 0,
            condition,
          );

      response.setStructuredContent({
        success: true,
        message: "断点已设置",
        tooltype: 'set_breakpoint',
        data: {
          breakpointId: breakpoint.breakpointId,
          url: url,
          lineNumber: lineNum,
          columnNumber: columnNumber ?? 0,
          condition: condition,
          locationsCount: breakpoint.locations.length,
          hint: "如果执行卡住，先运行 resume。如果总是在同一位置暂停，移除断点后改用 trace_function(pause=false) 或 hook_function。"
        }
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `设置断点失败: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'set_breakpoint',
        data: {}
      });
    }
  },
});

/**
 * 移除断点。
 */
export const removeBreakpoint = defineTool({
  name: 'remove_breakpoint',
  description: '移除指定 ID 的断点。使用 list_breakpoints 查看活跃断点。',
  annotations: {
    title: '移除断点',
    category: 'debugging' as ToolCategory,
    readOnlyHint: false,
  },
  schema: {
    breakpointId: zod.string().describe('要移除的断点 ID（来自 list_breakpoints 或 set_breakpoint）。'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;
    const breakpointId = request.params.breakpointId;

    if (!breakpointId || typeof breakpointId !== 'string' || breakpointId.trim() === '') {
      response.setStructuredContent({
        success: false,
        message: "breakpointId 参数不能为空。",
        tooltype: 'remove_breakpoint',
        data: {}
      });
      return;
    }

    try {
      const debuggerContext = await getDebugger(runtime);
      await debuggerContext.removeBreakpoint(breakpointId);
      response.setStructuredContent({
        success: true,
        message: "断点已移除",
        tooltype: 'remove_breakpoint',
        data: { breakpointId }
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `移除断点失败: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'remove_breakpoint',
        data: {}
      });
    }
  },
});

/**
 * 列出所有断点。
 */
export const listBreakpoints = defineTool({
  name: 'list_breakpoints',
  description: '列出当前调试会话中的所有活跃断点。',
  annotations: {
    title: '列出断点',
    category: 'debugging' as ToolCategory,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;

    try {
      const debuggerContext = await getDebugger(runtime);
      const breakpoints = debuggerContext.getBreakpoints();

      if (breakpoints.length === 0) {
        response.setStructuredContent({
          success: true,
          message: "当前无活跃断点。",
          tooltype: 'list_breakpoints',
          data: { breakpoints: [] }
        });
        return;
      }

      const breakpointData = breakpoints.map(bp => ({
        breakpointId: bp.breakpointId,
        url: bp.url,
        lineNumber: bp.lineNumber + 1,
        columnNumber: bp.columnNumber,
        condition: bp.condition || null,
        locationsCount: bp.locations.length
      }));

      response.setStructuredContent({
        success: true,
        message: `找到 ${breakpoints.length} 个活跃断点`,
        tooltype: 'list_breakpoints',
        data: { breakpoints: breakpointData }
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `列出断点失败: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'list_breakpoints',
        data: {}
      });
    }
  },
});

/**
 * 单步进入。
 */
export const stepInto = defineStepTool({
  name: 'step_into',
  title: '单步进入',
  description:
    '单步进入函数调用。用于进入函数体内部进行调试。需要先在断点暂停。返回结果默认包含暂停后的调用栈/作用域，省去再次调用 get_paused_info。',
  action: 'stepInto',
  notPausedMessage: '当前未处于暂停状态，无法单步进入。请先命中断点或调用 pause。',
  successMessage: '单步进入执行完成',
  failurePrefix: '单步进入失败',
});

/**
 * 单步跳过。
 */
export const stepOver = defineStepTool({
  name: 'step_over',
  title: '单步跳过',
  description:
    '单步跳过函数调用，将函数调用视为一个步骤。用于跳过函数体。需要先在断点暂停。返回结果默认包含暂停后的调用栈/作用域，省去再次调用 get_paused_info。',
  action: 'stepOver',
  notPausedMessage: '当前未处于暂停状态，无法单步跳过。请先命中断点或调用 pause。',
  successMessage: '单步跳过执行完成',
  failurePrefix: '单步跳过失败',
});

/**
 * 单步跳出。
 */
export const stepOut = defineStepTool({
  name: 'step_out',
  title: '单步跳出',
  description:
    '单步跳出当前函数，继续执行直到函数返回。用于快速退出函数。需要先在断点暂停。返回结果默认包含暂停后的调用栈/作用域，省去再次调用 get_paused_info。',
  action: 'stepOut',
  notPausedMessage: '当前未处于暂停状态，无法单步跳出。请先命中断点或调用 pause。',
  successMessage: '单步跳出执行完成',
  failurePrefix: '单步跳出失败',
});

/**
 * 继续执行。
 */
export const resume = defineTool({
  name: 'resume',
  description: '从暂停状态恢复执行，直到下一个断点或执行结束。',
  annotations: {
    title: '恢复执行',
    category: 'debugging' as ToolCategory,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;

    try {
      const debuggerContext = await getDebugger(runtime);
      await debuggerContext.resume();
      response.setStructuredContent({
        success: true,
        message: '执行已恢复',
        tooltype: 'resume',
        data: { action: 'resume' }
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `恢复执行失败: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'resume',
        data: {}
      });
    }
  },
});

/**
 * 暂停执行。
 */
export const pause = defineTool({
  name: 'pause',
  description: '暂停 JavaScript 执行。用于中断运行中的代码。',
  annotations: {
    title: '暂停执行',
    category: 'debugging' as ToolCategory,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;

    try {
      const debuggerContext = await getDebugger(runtime);
      const client = debuggerContext.getClient();
      if (!client) {
        response.setStructuredContent({
          success: false,
          message: 'Debugger 尚未启用，无法暂停执行',
          tooltype: 'pause',
          data: {}
        });
        return;
      }
      await debuggerContext.pause();
      response.setStructuredContent({
        success: true,
        message: '已请求暂停执行，等待暂停...',
        tooltype: 'pause',
        data: { action: 'pause' }
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `暂停执行失败: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'pause',
        data: {}
      });
    }
  },
});

/**
 * 列出所有已加载的脚本。
 */
export const listScripts = defineTool({
  name: 'list_scripts',
  description:
    '列出当前页面加载的所有 JavaScript 脚本。返回脚本 ID、URL 和 Source Map 信息。在设置断点或搜索前使用此工具查找脚本。',
  annotations: {
    title: '列出脚本',
    category: 'reverse_engineering' as ToolCategory,
    readOnlyHint: true,
  },
  schema: {
    filter: zod
      .string()
      .optional()
      .describe('可选的过滤字符串，匹配脚本 URL（不区分大小写）.'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;

    try {
      const debuggerContext = await getDebugger(runtime);
      let scripts = debuggerContext.getScripts();

      // 应用过滤
      if (request.params.filter) {
        scripts = debuggerContext.getScriptsByUrlPattern(request.params.filter);
      }

      // 过滤掉没有 URL 的脚本（内联/eval 脚本），除非它们是唯一的
      const scriptsWithUrls = scripts.filter(s => s.url);
      const displayScripts =
        scriptsWithUrls.length > 0 ? scriptsWithUrls : scripts;

      if (displayScripts.length === 0) {
        response.setStructuredContent({
          success: true,
          message: '未找到脚本。',
          tooltype: 'list_scripts',
          data: { scripts: [], filter: request.params.filter || null }
        });
        return;
      }

      const scriptData = displayScripts.map(script => ({
        scriptId: script.scriptId,
        url: script.url || null,
        sourceMapURL: script.sourceMapURL || null,
      }));

      response.setStructuredContent({
        success: true,
        message: `找到 ${displayScripts.length} 个脚本`,
        tooltype: 'list_scripts',
        data: { scripts: scriptData, filter: request.params.filter || null }
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `列出脚本失败: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'list_scripts',
        data: {}
      });
    }
  },
});

/**
 * 获取脚本源码。
 */
export const getScriptSource = defineTool({
  name: 'get_script_source',
  description:
    '根据脚本 ID 获取 JavaScript 脚本源码。支持行范围（多行文件）或字符偏移（单行压缩文件）。先使用 list_scripts 查找脚本 ID。',
  annotations: {
    title: '获取脚本源码',
    category: 'reverse_engineering' as ToolCategory,
    readOnlyHint: true,
  },
  schema: {
    scriptId: zod
      .string()
      .describe('脚本 ID（来自 list_scripts）用于获取源码。'),
    startLine: zod
      .number()
      .int()
      .optional()
      .describe('起始行号（1-based）。用于多行文件。'),
    endLine: zod
      .number()
      .int()
      .optional()
      .describe('结束行号（1-based）。用于多行文件。'),
    offset: zod
      .number()
      .int()
      .optional()
      .describe('字符偏移量起始位置（0-based）。用于压缩文件。'),
    length: zod
      .number()
      .int()
      .optional()
      .default(1000)
      .describe('使用 offset 时返回的字符数（默认: 1000）。'),
    prettyPrint: zod
      .boolean()
      .optional()
      .describe('是否对返回的源码进行格式化（适用于压缩文件）'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;
    const {scriptId, startLine, endLine, offset, length, prettyPrint} = request.params;

    try {
      const debuggerContext = await getDebugger(runtime);
      let source: string;
      if (prettyPrint) {
        source = await debuggerContext.getBeautifiedScriptSource(
          scriptId,
          raw => new PackerDeobfuscator().beautify(raw),
        );
      } else {
        source = await debuggerContext.getScriptSource(scriptId);
      }

      if (!source) {
        response.setStructuredContent({
          success: false,
          message: `未找到脚本 ${scriptId} 的源码。`,
          tooltype: 'get_script_source',
          data: { scriptId }
        });
        return;
      }

      // 格式化源码（可选）
      if (prettyPrint) {
        try {
          source = new PackerDeobfuscator().beautify(source);
        } catch {
          // 格式化失败时 fallback 返回原始源码
        }
      }

      const script = debuggerContext.getScriptById(scriptId);
      const url = script?.url || null;

      // 字符偏移模式（用于压缩文件）
      if (offset !== undefined) {
        const start = Math.max(0, offset);
        const end = Math.min(source.length, start + (length || 1000));
        const extract = source.substring(start, end);
        const prefix = start > 0 ? '...' : '';
        const suffix = end < source.length ? '...' : '';

        response.setStructuredContent({
          success: true,
          message: `脚本 ${scriptId} 的源码（字符 ${start}-${end} / ${source.length}）`,
          tooltype: 'get_script_source',
          data: {
            scriptId,
            url,
            mode: 'offset',
            sourceLength: source.length,
            sourceStart: start,
            sourceEnd: end,
            sourcePreview: `${prefix}${extract}${suffix}`,
            isComplete: end >= source.length && start === 0
          }
        });
        return;
      }

      // 行范围模式（用于正常文件）
      if (startLine !== undefined || endLine !== undefined) {
        const lines = source.split('\n');
        const start = (startLine ?? 1) - 1; // 转换为 0-based
        const end = endLine ?? lines.length;
        const selectedLines = lines.slice(start, end);

        response.setStructuredContent({
          success: true,
          message: `脚本 ${scriptId} 的源码（行 ${start + 1}-${Math.min(end, lines.length)}）`,
          tooltype: 'get_script_source',
          data: {
            scriptId,
            url,
            mode: 'lineRange',
            totalLines: lines.length,
            startLine: start + 1,
            endLine: Math.min(end, lines.length),
            lines: selectedLines.map((line, i) => ({
              lineNumber: start + i + 1,
              content: line
            })),
            isComplete: start === 0 && end >= lines.length
          }
        });
        return;
      }

      // 完整源码 - 但警告如果太大
      if (source.length > 50000) {
        response.setStructuredContent({
          success: true,
          message: `脚本 ${scriptId} 很大（${source.length} 字符）。请使用 offset/length 或 startLine/endLine 读取部分。`,
          tooltype: 'get_script_source',
          data: {
            scriptId,
            url,
            mode: 'full',
            sourceLength: source.length,
            sourcePreview: source.substring(0, 1000) + '...',
            warning: 'Source too large, use offset/length or startLine/endLine for partial view'
          }
        });
      } else {
        response.setStructuredContent({
          success: true,
          message: `脚本 ${scriptId} 的源码`,
          tooltype: 'get_script_source',
          data: {
            scriptId,
            url,
            mode: 'full',
            sourceLength: source.length,
            source: source,
            isComplete: true
          }
        });
      }
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `获取脚本源码失败: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'get_script_source',
        data: { scriptId: request.params.scriptId }
      });
    }
  },
});

/**
 * 在源码中搜索。
 */
export const searchInSources = defineTool({
  name: 'search_in_sources',
  description:
    '在所有已加载的 JavaScript 源码中搜索字符串或正则表达式。返回匹配行及脚本 ID、URL 和行号。使用 get_script_source 和 startLine/endLine 查看匹配周围的完整上下文。',
  annotations: {
    title: '在源码中搜索',
    category: 'reverse_engineering' as ToolCategory,
    readOnlyHint: true,
  },
  schema: {
    query: zod.string().describe('搜索查询（字符串或正则表达式）。'),
    caseSensitive: zod
      .boolean()
      .optional()
      .default(false)
      .describe('搜索是否区分大小写。'),
    isRegex: zod
      .boolean()
      .optional()
      .default(false)
      .describe('是否将查询视为正则表达式。'),
    maxResults: zod
      .number()
      .int()
      .optional()
      .default(30)
      .describe('返回的最大结果数（默认: 30）。'),
    maxLineLength: zod
      .number()
      .int()
      .optional()
      .default(150)
      .describe('每行预览的最大字符数（默认: 150）。设为 0 显示完整行。'),
    excludeMinified: zod
      .boolean()
      .optional()
      .default(true)
      .describe('跳过压缩文件（行长度 > 10000 字符）。默认: true。'),
    urlFilter: zod
      .string()
      .optional()
      .describe('只搜索 URL 包含此字符串的脚本（不区分大小写）。'),
    source: zod
      .enum(['live', 'cache', 'auto'])
      .optional()
      .default('auto')
      .describe("搜索来源：'live' 只走 CDP，'cache' 只走本地缓存，'auto' 先尝试 CDP 失败时 fallback 到缓存"),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;
    const {
      query,
      caseSensitive,
      isRegex,
      maxResults,
      maxLineLength,
      excludeMinified,
      urlFilter,
      source,
    } = request.params;

    const searchWithCdp = async () => {
      const debuggerContext = await getDebugger(runtime);
      return debuggerContext.searchInScripts(query, { caseSensitive, isRegex });
    };

    const searchWithCache = async () => {
      const {CodeCache} = await import('../../modules/collector/CodeCache.js');
      const cache = new CodeCache();
      return cache.searchInCache(query, { caseSensitive, isRegex, urlFilter });
    };

    try {
      let matches: Array<{scriptId: string; url?: string; lineNumber: number; lineContent: string}>;
      let searchSource: string;

      if (source === 'cache') {
        const cacheMatches = await searchWithCache();
        matches = cacheMatches;
        searchSource = 'cache';
      } else if (source === 'live') {
        const result = await searchWithCdp();
        matches = result.matches;
        searchSource = 'live';
      } else {
        // auto: 先尝试 CDP，失败时 fallback 到 cache
        try {
          const result = await searchWithCdp();
          matches = result.matches;
          searchSource = 'live';
        } catch {
          const cacheMatches = await searchWithCache();
          matches = cacheMatches;
          searchSource = 'cache (fallback)';
        }
      }

      if (matches.length === 0) {
        response.setStructuredContent({
          success: true,
          message: `未找到匹配 "${query}"。`,
          tooltype: 'search_in_sources',
          data: { query, matches: [], totalMatches: 0, filtered: false, searchSource }
        });
        return;
      }

      // 过滤匹配
      let filteredMatches = matches;

      // 应用 URL 过滤
      if (urlFilter) {
        const lowerFilter = urlFilter.toLowerCase();
        filteredMatches = filteredMatches.filter(
          m => m.url && m.url.toLowerCase().includes(lowerFilter),
        );
      }

      // 过滤掉压缩文件（行 > 10000 字符）
      const minifiedThreshold = 10000;
      let skippedMinified = 0;
      if (excludeMinified) {
        const beforeCount = filteredMatches.length;
        filteredMatches = filteredMatches.filter(m => {
          if (m.lineContent.length > minifiedThreshold) {
            return false;
          }
          return true;
        });
        skippedMinified = beforeCount - filteredMatches.length;
      }

      if (filteredMatches.length === 0) {
        response.setStructuredContent({
          success: true,
          message: `未找到匹配 "${query}"。`,
          tooltype: 'search_in_sources',
          data: {
            query,
            matches: [],
            totalMatches: 0,
            skippedMinified,
            hint: skippedMinified > 0 ? '设置 excludeMinified=false 以包含压缩文件中的匹配' : null
          }
        });
        return;
      }

      const displayMatches = filteredMatches.slice(0, maxResults);
      const totalMatches = filteredMatches.length;

      const matchData = displayMatches.map(match => {
        const lineNum = match.lineNumber + 1;
        const scriptId = match.scriptId;
        const url = match.url || '(内联)';

        // 截断行内容，尽可能以匹配位置为中心
        let preview = match.lineContent.trim();
        if (maxLineLength > 0 && preview.length > maxLineLength) {
          // 尝试找到查询位置以居中预览
          const lowerContent = caseSensitive ? preview : preview.toLowerCase();
          const lowerQuery = caseSensitive ? query : query.toLowerCase();
          const matchPos = isRegex ? 0 : lowerContent.indexOf(lowerQuery);

          if (matchPos >= 0) {
            // 以匹配位置为中心
            const halfLen = Math.floor(maxLineLength / 2);
            let start = Math.max(0, matchPos - halfLen);
            let end = start + maxLineLength;

            if (end > preview.length) {
              end = preview.length;
              start = Math.max(0, end - maxLineLength);
            }

            const prefix = start > 0 ? '...' : '';
            const suffix = end < preview.length ? '...' : '';
            preview = prefix + preview.substring(start, end) + suffix;
          } else {
            // 回退：从开头截断
            preview = preview.substring(0, maxLineLength) + '...';
          }
        }

        return {
          scriptId,
          url,
          lineNumber: lineNum,
          preview,
          lineContentLength: match.lineContent.length
        };
      });

      response.setStructuredContent({
        success: true,
        message: `找到 ${totalMatches} 个匹配 "${query}"${totalMatches > maxResults ? ` (显示前 ${maxResults})` : ''}`,
        tooltype: 'search_in_sources',
        data: {
          query,
          matches: matchData,
          totalMatches,
          displayedMatches: displayMatches.length,
          skippedMinified,
          maxResults,
          hint: '使用 get_script_source(scriptId, startLine, endLine) 查看匹配周围的完整上下文。'
        }
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'search_in_sources',
        data: { query: request.params.query }
      });
    }
  },
});

/**
 * 设置 XHR 断点。
 */
export const breakOnXhr = defineXhrBreakpointTool({
  name: 'break_on_xhr',
  description: '在 XHR/Fetch 请求 URL 包含指定字符串时触发断点。',
  title: '设置 XHR 断点',
  cdpMethod: 'DOMDebugger.setXHRBreakpoint',
  buildSuccessMessage: url => `XHR 断点已设置，URL 模式: "${url}"`,
  successData: url => ({url, hint: '匹配的 XHR/Fetch 请求发出时将暂停执行。'}),
  failurePrefix: '设置 XHR 断点失败',
});

/**
 * 移除 XHR 断点。
 */
export const removeXhrBreakpoint = defineXhrBreakpointTool({
  name: 'remove_xhr_breakpoint',
  description: '移除 XHR/Fetch 断点。',
  title: '移除 XHR 断点',
  cdpMethod: 'DOMDebugger.removeXHRBreakpoint',
  buildSuccessMessage: url => `XHR 断点已移除: "${url}"`,
  successData: url => ({url}),
  failurePrefix: '移除 XHR 断点失败',
});

/**
 * 追踪函数调用。
 */
export const traceFunction = defineTool({
  name: 'trace_function',
  description:
    '追踪源码中指定名称的函数调用。适用于任何函数（包括 webpack/rollup 打包的内部函数）。使用"日志点"（条件断点）记录参数而不暂停执行。',
  annotations: {
    title: '追踪函数',
    category: 'reverse_engineering' as ToolCategory,
    readOnlyHint: false,
  },
  schema: {
    target: zod
      .string()
      .describe(
        '要追踪的函数名。将搜索 "function NAME" 或 "NAME = function" 或 "NAME(" 模式。',
      ),
    urlFilter: zod
      .string()
      .optional()
      .describe('只搜索 URL 包含此字符串的脚本（不区分大小写）。'),
    logArgs: zod
      .boolean()
      .optional()
      .default(true)
      .describe('是否记录函数参数（默认: true）。'),
    logResult: zod
      .boolean()
      .optional()
      .default(true)
      .describe('是否记录返回值（默认: true）。'),
    logStack: zod
      .boolean()
      .optional()
      .default(false)
      .describe('是否记录调用栈（默认: false）。'),
    hookId: zod
      .string()
      .optional()
      .describe('自定义追踪 ID，用于后续识别日志。'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;
    const {target, urlFilter, logArgs, logResult, logStack, hookId} = request.params;

    if (!target || typeof target !== 'string') {
      response.appendResponseLine('target 参数不能为空。需要提供一个函数名。');
      return;
    }

    const debugger_ = await getDebugger(runtime);
    if (!debugger_.isEnabled()) {
      response.appendResponseLine('调试器未启用，请先选择页面。');
      return;
    }

    // 搜索函数名
    const patterns = [
      `function ${target}`,
      `${target}=function`,
      `${target} = function`,
      `${target}=(`,
      `${target} = (`,
      `${target}(`,
      `${target}:function`,
      `${target}: function`,
    ];

    try {
      let foundMatch = null;

      // 搜索每个模式
      for (const pattern of patterns) {
        const result = await debugger_.searchInScripts(pattern, {
          caseSensitive: true,
          isRegex: false,
        });

        let matches = result.matches;

        // 应用 URL 过滤
        if (urlFilter) {
          const lowerFilter = urlFilter.toLowerCase();
          matches = matches.filter(
            m => m.url && m.url.toLowerCase().includes(lowerFilter),
          );
        }

        // 跳过压缩文件
        matches = matches.filter(m => m.lineContent.length < 100000);

        if (matches.length > 0) {
          foundMatch = {pattern, match: matches[0]};
          break;
        }
      }

      if (!foundMatch) {
        response.setStructuredContent({
          success: false,
          message: `未找到函数 "${target}"。`,
          tooltype: 'trace_function',
          data: {
            target,
            searchedPatterns: patterns.slice(0, 4),
            hint: '使用 search_in_sources 查找确切的函数签名，然后使用 set_breakpoint。'
          }
        });
        return;
      }

      const {match} = foundMatch;
      const script = debugger_.getScriptById(match.scriptId);
      const url = script?.url || match.url;

      if (!url) {
        response.setStructuredContent({
          success: false,
          message: '无法追踪：脚本没有 URL（内联脚本）。',
          tooltype: 'trace_function',
          data: { target }
        });
        return;
      }

      // 获取精确的列位置
      const source = await debugger_.getScriptSource(match.scriptId);
      const lines = source.split('\n');
      let columnNumber = 0;

      if (match.lineNumber < lines.length) {
        const lineContent = lines[match.lineNumber];
        const funcStart = lineContent.indexOf(foundMatch.pattern);
        if (funcStart >= 0) {
          const afterPattern = lineContent.substring(
            funcStart + foundMatch.pattern.length,
          );
          const braceMatch = afterPattern.match(/[({]/);
          if (braceMatch && braceMatch.index !== undefined) {
            columnNumber =
              funcStart + foundMatch.pattern.length + braceMatch.index + 1;
          } else {
            columnNumber = funcStart;
          }
        }
      }

      // 构建 logging 表达式
      const logParts = [`'[Trace ${hookId || target}] ${target} called'`];
      if (logArgs) {
        logParts.push(`'args:'`);
        logParts.push(`JSON.stringify(Array.from(arguments)).slice(0,500)`);
      }
      if (logStack) {
        logParts.push(`'stack:'`);
        logParts.push(`new Error().stack?.split('\\n').slice(2, 6).map(s => s.trim())`);
      }
      const logExpr = `console.log(${logParts.join(', ')})`;

      // 如果不暂停，包装为返回 false 的表达式
      const condition = logStack ? logExpr : `(${logExpr}, false)`;

      // 设置断点
      const breakpointInfo = await debugger_.setBreakpoint(
        url,
        match.lineNumber,
        columnNumber,
        condition,
      );

      response.setStructuredContent({
        success: true,
        message: '函数追踪已安装！',
        tooltype: 'trace_function',
        data: {
          traceId: hookId || target,
          target,
          breakpointId: breakpointInfo.breakpointId,
          url,
          lineNumber: match.lineNumber + 1,
          columnNumber,
          mode: logStack ? 'pause on call' : 'Log only (no pause)',
          hint: '调用将被记录到控制台。使用 list_console_messages 查看。',
          stopCommand: `remove_breakpoint(breakpointId: "${breakpointInfo.breakpointId}")`
        }
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'trace_function',
        data: { target: request.params.target }
      });
    }
  },
});

/**
 * 获取 AI 调试状态。
 */
export const getAiDebugStatus = defineTool({
  name: 'get_ai_debug_status',
  description: '获取当前调试状态，包括暂停状态、断点数量、脚本数量等。',
  annotations: {
    title: '获取 AI 调试状态',
    category: 'debugging' as ToolCategory,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;

    try {
      const debuggerContext = await getDebugger(runtime);
      const pausedState = debuggerContext.getPausedState();
      const breakpoints = debuggerContext.getBreakpoints();
      const scripts = debuggerContext.getScripts();

      response.setStructuredContent({
        success: true,
        message: '已获取调试状态',
        tooltype: 'get_ai_debug_status',
        data: {
          isPaused: pausedState.isPaused,
          breakpointsCount: breakpoints.length,
          scriptsCount: scripts.length,
          lastAutoRecoveryEvent: debuggerContext.getLastAutoRecoveryEvent() ?? null,
          debuggerStatus: '已启用'
        }
      });
    } catch {
      response.setStructuredContent({
        success: false,
        message: '调试器尚未初始化',
        tooltype: 'get_ai_debug_status',
        data: {
          isPaused: false,
          breakpointsCount: 0,
          scriptsCount: 0,
          lastAutoRecoveryEvent: null,
          debuggerStatus: '未启用'
        }
      });
    }
  },
});

/**
 * 在脚本中查找文本。
 */
export const findInScript = defineTool({
  name: 'find_in_script',
  description:
    '在指定脚本中查找字符串，返回精确的行号/列号及周围上下文。适用于在压缩文件中设置断点。',
  annotations: {
    title: '在脚本中查找',
    category: 'reverse_engineering' as ToolCategory,
    readOnlyHint: true,
  },
  schema: {
    scriptId: zod
      .string()
      .describe('要搜索的脚本 ID（来自 list_scripts）。'),
    query: zod.string().describe('要在脚本中查找的字符串。'),
    contextChars: zod
      .number()
      .int()
      .optional()
      .default(100)
      .describe('匹配前后显示的字符数（默认: 100）。'),
    occurrence: zod
      .number()
      .int()
      .optional()
      .default(1)
      .describe('要查找第几个匹配（1=第一个，2=第二个，等）。'),
    caseSensitive: zod
      .boolean()
      .optional()
      .default(true)
      .describe('搜索是否区分大小写（默认: true）。'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;
    const {scriptId, query, contextChars, occurrence, caseSensitive} =
      request.params;

    try {
      const debuggerContext = await getDebugger(runtime);
      const source = await debuggerContext.getScriptSource(scriptId);

      if (!source) {
        response.setStructuredContent({
          success: false,
          message: `未找到脚本 ${scriptId} 的源码。`,
          tooltype: 'find_in_script',
          data: { scriptId }
        });
        return;
      }

      // 查找指定匹配
      const searchSource = caseSensitive ? source : source.toLowerCase();
      const searchQuery = caseSensitive ? query : query.toLowerCase();

      let position = -1;
      let currentOccurrence = 0;
      let searchStart = 0;

      while (currentOccurrence < occurrence) {
        position = searchSource.indexOf(searchQuery, searchStart);
        if (position === -1) {
          break;
        }
        currentOccurrence++;
        searchStart = position + 1;
      }

      if (position === -1) {
        response.setStructuredContent({
          success: false,
          message: `"${query}" 未在脚本 ${scriptId} 中找到${occurrence > 1 ? ` (第 ${occurrence} 个匹配)` : ''}。`,
          tooltype: 'find_in_script',
          data: { scriptId, query, occurrence }
        });
        return;
      }

      // 计算行号和列号（0-based）
      let lineNumber = 0;
      let columnNumber = position;
      for (let i = 0; i < position; i++) {
        if (source[i] === '\n') {
          lineNumber++;
          columnNumber = position - i - 1;
        }
      }

      // 提取上下文
      const contextStart = Math.max(0, position - contextChars);
      const contextEnd = Math.min(
        source.length,
        position + query.length + contextChars,
      );

      const beforeContext = source.substring(contextStart, position);
      const matchText = source.substring(position, position + query.length);
      const afterContext = source.substring(
        position + query.length,
        contextEnd,
      );

      const prefix = contextStart > 0 ? '...' : '';
      const suffix = contextEnd < source.length ? '...' : '';

      const script = debuggerContext.getScriptById(scriptId);
      const url = script?.url || '(内联)';

      response.setStructuredContent({
        success: true,
        message: `在脚本 ${scriptId} 中找到 "${query}"`,
        tooltype: 'find_in_script',
        data: {
          scriptId,
          url,
          query,
          occurrence,
          lineNumber: lineNumber + 1,
          columnNumber,
          charOffset: position,
          context: {
            prefix,
            match: matchText,
            suffix,
            fullContext: `${prefix}${beforeContext}【${matchText}】${afterContext}${suffix}`
          },
          setBreakpointCommand: `set_breakpoint(url: "${url}", lineNumber: ${lineNumber + 1}, columnNumber: ${columnNumber})`
        }
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'find_in_script',
        data: { scriptId: request.params.scriptId }
      });
    }
  },
});

/**
 * 获取请求发起者信息。
 */
export const getRequestInitiator = defineTool({
  name: 'get_request_initiator',
  description:
    '获取网络请求的 JavaScript 调用栈（发起者）。帮助追踪哪个代码触发了 API 调用。',
  annotations: {
    title: '获取请求发起者',
    category: 'reverse_engineering' as ToolCategory,
    readOnlyHint: true,
  },
  schema: {
    requestId: zod
      .number()
      .int()
      .describe('请求 ID（来自 list_network_requests）用于获取发起者。'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;
    const {requestId} = request.params;

    try {
      const httpRequest = runtime.getNetworkRequestById(requestId);
      const initiator = runtime.getRequestInitiator(httpRequest);

      if (!initiator) {
        response.setStructuredContent({
          success: false,
          message: `未找到请求 ${requestId} 的发起者信息。`,
          tooltype: 'get_request_initiator',
          data: {
            requestId,
            hint: '这可能是导航请求或发起者未被捕获。'
          }
        });
        return;
      }

      const stackFrames = initiator.stack?.callFrames?.map((frame, i) => ({
        index: i + 1,
        functionName: frame.functionName || '(匿名)',
        url: frame.url,
        lineNumber: frame.lineNumber + 1,
        columnNumber: frame.columnNumber
      })) || [];

      response.setStructuredContent({
        success: true,
        message: `请求 ${httpRequest.url()} 的发起者信息获取完成`,
        tooltype: 'get_request_initiator',
        data: {
          requestId,
          requestUrl: httpRequest.url(),
          type: initiator.type,
          url: initiator.url || null,
          lineNumber: initiator.lineNumber !== undefined ? initiator.lineNumber + 1 : null,
          columnNumber: initiator.columnNumber !== undefined ? initiator.columnNumber : null,
          stackFrames,
          hasStack: stackFrames.length > 0
        }
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `获取发起者失败: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'get_request_initiator',
        data: { requestId: request.params.requestId }
      });
    }
  },
});

/**
 * 获取当前暂停信息。
 */
export const getPausedInfo = defineTool({
  name: 'get_paused_info',
  description:
    '获取当前暂停状态信息，包括调用栈、当前位置和作用域变量。在断点命中后使用此工具了解执行上下文。',
  annotations: {
    title: '获取暂停信息',
    category: 'debugging' as ToolCategory,
    readOnlyHint: true,
  },
  schema: {
    includeScopes: zod
      .boolean()
      .optional()
      .default(true)
      .describe('是否包含作用域变量（默认: true）。'),
    maxScopeDepth: zod
      .number()
      .int()
      .optional()
      .default(2)
      .describe('遍历的最大作用域深度（默认: 2）。'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;

    try {
      const debuggerContext = await getDebugger(runtime);
      const pausedInfo = await buildPausedInfoData(debuggerContext, {
        includeScopes: request.params.includeScopes,
      });

      if (!pausedInfo) {
        response.setStructuredContent({
          success: false,
          message: '执行未暂停。',
          tooltype: 'get_paused_info',
          data: {
            isPaused: false,
            hint: '请先设置断点并触发它来暂停执行。'
          }
        });
        return;
      }

      response.setStructuredContent({
        success: true,
        message: '执行已暂停',
        tooltype: 'get_paused_info',
        data: pausedInfo
      });

      response.appendResponseLine(
        '\n💡 使用 resume、step_over、step_into 或 step_out 继续。',
      );
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `获取暂停信息失败: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'get_paused_info',
        data: { isPaused: false }
      });
    }
  },
});

/**
 * 在调用帧上执行表达式。
 */
export const evaluateOnCallframe = defineTool({
  name: 'evaluate_on_callframe',
  description:
    '在暂停时的指定调用帧上下文中执行 JavaScript 表达式。允许检查变量和执行代码。',
  annotations: {
    title: '在调用帧上执行',
    category: 'debugging' as ToolCategory,
    readOnlyHint: true,
  },
  schema: {
    expression: zod.string().describe('要执行的 JavaScript 表达式。'),
    frameIndex: zod
      .number()
      .int()
      .optional()
      .default(0)
      .describe('要执行表达式的调用帧索引（0=顶层帧，默认: 0）。'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;
    const {expression, frameIndex} = request.params;

    try {
      const debuggerContext = await getDebugger(runtime);
      const pausedState = debuggerContext.getPausedState();

      if (!pausedState.isPaused) {
        response.setStructuredContent({
          success: false,
          message: '执行未暂停，无法执行表达式。',
          tooltype: 'evaluate_on_callframe',
          data: { isPaused: false }
        });
        return;
      }

      if (frameIndex >= pausedState.callFrames.length) {
        response.setStructuredContent({
          success: false,
          message: `无效的帧索引 ${frameIndex}。可用帧: 0-${pausedState.callFrames.length - 1}`,
          tooltype: 'evaluate_on_callframe',
          data: {
            frameIndex,
            availableFrames: pausedState.callFrames.length
          }
        });
        return;
      }

      const callFrameId = pausedState.callFrames[frameIndex].callFrameId;

      const result = await debuggerContext.evaluateOnCallFrame(
        callFrameId,
        expression,
        {returnByValue: true, generatePreview: true},
      );

      if (result.exceptionDetails) {
        response.setStructuredContent({
          success: false,
          message: `错误: ${result.exceptionDetails.text}`,
          tooltype: 'evaluate_on_callframe',
          data: {
            expression,
            frameIndex,
            exception: result.exceptionDetails.exception?.description || null
          }
        });
      } else {
        response.setStructuredContent({
          success: true,
          message: '执行成功',
          tooltype: 'evaluate_on_callframe',
          data: {
            expression,
            frameIndex,
            result: result.result.value !== undefined
              ? result.result.value
              : result.result.description || `[${result.result.type}]`
          }
        });
      }
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `执行失败: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'evaluate_on_callframe',
        data: { expression: request.params.expression }
      });
    }
  },
});

/**
 * 检查当前暂停栈的局部变量摘要。
 */
export const inspectLocals = defineTool({
  name: 'inspect_locals',
  description: '检查当前暂停栈所有帧的局部变量摘要。',
  annotations: {
    title: '检查局部变量',
    category: 'debugging' as ToolCategory,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;

    try {
      const debuggerContext = await getDebugger(runtime);
      const pausedState = debuggerContext.getPausedState();

      if (!pausedState.isPaused) {
        response.setStructuredContent({
          success: false,
          message: '当前未处于暂停状态',
          tooltype: 'inspect_locals',
          data: { isPaused: false }
        });
        return;
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
            lineNumber: frame.location.lineNumber + 1,
            locals: locals.slice(0, 10),
            localCount: locals.length,
          };
        }),
      );

      response.setStructuredContent({
        success: true,
        message: `当前暂停栈共 ${frames.length} 帧，已读取局部变量摘要`,
        tooltype: 'inspect_locals',
        data: {
          isPaused: true,
          totalFrames: frames.length,
          totalLocals: frames.reduce((sum, f) => sum + f.localCount, 0),
          frames: frames.map(f => ({
            index: f.index,
            callFrameId: f.callFrameId,
            functionName: f.functionName,
            url: f.url,
            lineNumber: f.lineNumber,
            localCount: f.localCount,
            locals: f.locals
          }))
        }
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `检查局部变量失败: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'inspect_locals',
        data: { isPaused: false }
      });
    }
  },
});

/**
 * 在文本上设置断点。
 */
export const setBreakpointOnText = defineTool({
  name: 'set_breakpoint_on_text',
  description:
    '在指定代码文本（函数名、语句等）上设置断点，通过搜索自动确定精确位置。适用于正常和压缩文件。注意：优先使用 hook_function 监控函数调用 — 它无需暂停执行即可捕获参数/返回值。仅在需要检查特定代码位置的局部变量时使用此工具。',
  annotations: {
    title: '在文本上设置断点',
    category: 'reverse_engineering' as ToolCategory,
    readOnlyHint: false,
  },
  schema: {
    text: zod
      .string()
      .describe(
        '要查找并设置断点的代码文本（如 "function myFunc", "fetchData(", "apiCall"）。',
      ),
    urlFilter: zod
      .string()
      .optional()
      .describe(
        '只搜索 URL 包含此字符串的脚本（不区分大小写）。',
      ),
    occurrence: zod
      .number()
      .int()
      .optional()
      .default(1)
      .describe('要断点的第几个匹配（1=第一个，2=第二个，等）。'),
    condition: zod
      .string()
      .optional()
      .describe('条件表达式，断点仅在表达式求值为 true 时触发。'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;
    const {text, urlFilter, occurrence, condition} = request.params;

    try {
      const debuggerContext = await getDebugger(runtime);

      // 步骤 1: 在所有脚本中搜索文本
      const searchResult = await debuggerContext.searchInScripts(text, {
        caseSensitive: true,
        isRegex: false,
      });

      if (searchResult.matches.length === 0) {
        response.setStructuredContent({
          success: false,
          message: `"${text}" 未在任何已加载脚本中找到。`,
          tooltype: 'set_breakpoint_on_text',
          data: { text }
        });
        return;
      }

      // 应用 URL 过滤
      let matches = searchResult.matches;
      if (urlFilter) {
        const lowerFilter = urlFilter.toLowerCase();
        matches = matches.filter(
          m => m.url && m.url.toLowerCase().includes(lowerFilter),
        );
        if (matches.length === 0) {
          response.setStructuredContent({
            success: false,
            message: `"${text}" 在未匹配 "${urlFilter}" 的脚本中找到。`,
            tooltype: 'set_breakpoint_on_text',
            data: { text, urlFilter }
          });
          return;
        }
      }

      // 获取指定的匹配项
      if (occurrence > matches.length) {
        response.setStructuredContent({
          success: false,
          message: `只有 ${matches.length} 个匹配项，但请求了第 ${occurrence} 个。`,
          tooltype: 'set_breakpoint_on_text',
          data: { text, matchesCount: matches.length, requestedOccurrence: occurrence }
        });
        return;
      }

      const match = matches[occurrence - 1];
      const script = debuggerContext.getScriptById(match.scriptId);
      const url = script?.url || match.url;

      if (!url) {
        response.setStructuredContent({
          success: false,
          message: '无法设置断点：脚本没有 URL（内联脚本）。',
          tooltype: 'set_breakpoint_on_text',
          data: { text }
        });
        return;
      }

      // 步骤 2: 通过搜索脚本源码获取精确列位置
      const source = await debuggerContext.getScriptSource(match.scriptId);
      const lines = source.split('\n');
      let columnNumber = 0;

      // 对于压缩文件，查找精确列
      if (match.lineNumber < lines.length) {
        const lineContent = lines[match.lineNumber];
        const colPos = lineContent.indexOf(text);
        if (colPos >= 0) {
          columnNumber = colPos;
        }
      }

      // 步骤 3: 设置断点
      const breakpointInfo = await debuggerContext.setBreakpoint(
        url,
        match.lineNumber,
        columnNumber,
        condition,
      );

      // 获取上下文预览
      let contextPreview = null;
      if (match.lineNumber < lines.length) {
        const lineContent = lines[match.lineNumber];
        const contextStart = Math.max(0, columnNumber - 50);
        const contextEnd = Math.min(
          lineContent.length,
          columnNumber + text.length + 50,
        );
        const preview = lineContent.substring(contextStart, contextEnd);
        const prefix = contextStart > 0 ? '...' : '';
        const suffix = contextEnd < lineContent.length ? '...' : '';
        contextPreview = `${prefix}${preview}${suffix}`;
      }

      response.setStructuredContent({
        success: true,
        message: '断点设置成功！',
        tooltype: 'set_breakpoint_on_text',
        data: {
          breakpointId: breakpointInfo.breakpointId,
          url,
          lineNumber: match.lineNumber + 1,
          columnNumber,
          condition: condition || null,
          contextPreview,
          hint: '如果执行卡住，先运行 resume。如果总是在同一位置暂停，移除断点后改用 trace_function(pause=false) 或 hook_function。'
        }
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'set_breakpoint_on_text',
        data: { text: request.params.text }
      });
    }
  },
});

/**
 * XHR 到 JS 断点转换。
 */
export const xhrToJsBreakpoint = defineXhrBreakpointTool({
  name: 'xhr_to_js_breakpoint',
  description:
    '设置 XHR 断点；命中后可结合 get_paused_info / set_breakpoint 完成 JS 断点定位。',
  title: 'XHR 到 JS 断点',
  cdpMethod: 'DOMDebugger.setXHRBreakpoint',
  buildSuccessMessage: url => `XHR 断点已设置: ${url}`,
  successData: url => ({
    url,
    hint: '命中后可结合 get_paused_info / set_breakpoint 完成 JS 断点定位',
  }),
  failurePrefix: '设置 XHR 断点失败',
});

/**
 * 开始连续调试。
 */
export const startContinuousDebugging = defineTool({
  name: 'start_continuous_debugging',
  description:
    '开始连续调试会话。注意：当前工具层尚未接入 AIContinuousDebugger 运行时，请改用 pause/set_breakpoint/get_paused_info 组合。',
  annotations: {
    title: '开始连续调试',
    category: 'debugging' as ToolCategory,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (request, response, context) => {
    response.setStructuredContent({
      success: false,
      message: '当前工具层尚未接入 AIContinuousDebugger 运行时，请改用 pause/set_breakpoint/get_paused_info 组合',
      tooltype: 'start_continuous_debugging',
      data: {
        hint: 'Use pause, set_breakpoint, and get_paused_info instead'
      }
    });
  },
});

/**
 * 停止连续调试。
 */
export const stopContinuousDebugging = defineTool({
  name: 'stop_continuous_debugging',
  description: '停止连续调试会话。',
  annotations: {
    title: '停止连续调试',
    category: 'debugging' as ToolCategory,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (request, response, context) => {
    response.setStructuredContent({
      success: false,
      message: '当前没有可停止的连续调试会话',
      tooltype: 'stop_continuous_debugging',
      data: {}
    });
  },
});
