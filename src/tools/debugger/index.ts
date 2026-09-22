/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';

import type {PageSelector} from '../../modules/browser/PageIdentity.js';
import type {DebuggerManager} from '../../modules/debugger/DebuggerManager.js';
import type {BreakpointInfo} from '../../modules/debugger/types.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes, ToolError} from '../../utils/errors.js';
import {writeScriptFileAtomic} from '../../utils/fsSafe.js';
import {safeStringify} from '../../utils/safeJson.js';
import type {ToolContextProvider} from '../../worker/ToolContext.js';
import {ToolCategory} from '../categories.js';
import {resolveScript} from '../shared/scriptResolver.js';
import {defineTool} from '../ToolDefinition.js';

import {
  filterMatchesByUrl,
  getDebuggerFromContext,
  MINIFIED_LINE_THRESHOLD,
  runTool,
  SCOPE_VAR_LIMIT,
} from './runtime-helpers.js';

// ─── 子模块工具导出（defineTool 格式）─────────────────────

export {hookFunction} from './hookFunction.js';
export {unhookFunction} from './unhookFunction.js';
export {listHooks} from './listHooks.js';
export {inspectObject} from './inspectObject.js';
export {getStorage} from './getStorage.js';
export {monitorEvents} from './monitorEvents.js';
export {stopMonitor} from './stopMonitor.js';

// ─── 类型导出 ─────────────────────────────────────────

export type {Frame} from '../../third_party/index.js';

// ─── 辅助函数 ───────────────────────────────────────────────

/**
 * scriptId 参数 Schema：脚本 ID 可能是字符串或数字（CDP 返回 number），
 * 统一收敛为字符串。list_scripts / search_in_sources / get_script_source / set_breakpoint 共用。
 */
const scriptIdSchema = zod
  .union([zod.string(), zod.number()])
  .transform(value => String(value));

/**
 * 脚本定位器 Schema：页面刷新后 CDP scriptId 会重新分配，旧 scriptId 失效，
 * 此时可用 get_script_source 返回的 locator 重新定位同一脚本。
 */
const scriptLocatorSchema = zod.object({
  pageId: zod
    .string()
    .optional()
    .describe('关联的稳定页面 ID（仅存在性校验，不用于缩小候选）。'),
  url: zod.string().optional().describe('脚本 URL（精确匹配）。'),
  domIndex: zod
    .number()
    .int()
    .optional()
    .describe('在候选脚本中的下标（0-based，用于同名 URL 消歧）。'),
  contentHash: zod
    .string()
    .optional()
    .describe('脚本源码 SHA-256（十六进制），用于精确匹配。'),
  sourceLength: zod
    .number()
    .int()
    .optional()
    .describe('脚本源码字节长度（UTF-8）。'),
});

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
      category: ToolCategory.DEBUGGING,
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
      await runTool(
        response,
        request,
        config.name,
        async () => {
          const debuggerContext = await getDebuggerFromContext(context);
          if (!debuggerContext.isPaused()) {
            throw createToolError(
              ErrorCodes.DEBUGGER_NOT_PAUSED,
              config.notPausedMessage,
              {toolName: config.name},
              {
                recovery: {
                  tool: 'pause',
                  command: 'browsercli call pause',
                  reason: 'Pause execution first',
                },
              },
            );
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
      category: ToolCategory.REVERSE_ENGINEERING,
      readOnlyHint: false,
    },
    schema: {
      url: zod.string().optional().describe('XHR URL 模式（部分匹配）。'),
    },
    handler: async (request, response, context) => {
      const url = request.params.url ?? '';

      await runTool(
        response,
        request,
        config.name,
        async () => {
          const debuggerContext = await getDebuggerFromContext(context);
          const client = debuggerContext.getClient();
          if (!client) {
            throw createToolError(
              ErrorCodes.CONNECTION,
              'Debugger 客户端不可用。',
              {toolName: config.name},
            );
          }
          await client.send(
            config.cdpMethod as 'DOMDebugger.setXHRBreakpoint',
            {url},
          );
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
  debuggerContext: DebuggerManager,
  options: {includeScopes?: boolean} = {},
): Promise<PausedInfoData | null> {
  const pausedState = debuggerContext.getPausedState();
  if (!pausedState) {
    return null;
  }

  const callFrames = pausedState.callFrames.map((frame, i) => {
    const script = debuggerContext.getScriptById(frame.location.scriptId);
    const url = script?.url || frame.url || `script:${frame.location.scriptId}`;
    return {
      index: i + 1,
      functionName: frame.functionName,
      url,
      lineNumber: frame.location.lineNumber + 1,
      columnNumber: frame.location.columnNumber ?? 0,
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
          const variables = await debuggerContext.getScopeVariablesForObjectId(
            scope.object.objectId,
          );

          if (variables.length > 0) {
            scopeData.variables = variables.slice(0, 20).map(v => ({
              name: v.name,
              value: v.value,
            }));
            if (variables.length > SCOPE_VAR_LIMIT) {
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
    '设置 JavaScript 断点。支持按脚本 URL 或 scriptId（来自 list_scripts / search_in_sources）加行号设置，可选条件表达式。注意：优先使用 hook_function 或 trace_function 进行监控，断点需要暂停/恢复协调，在自动化流程中容易出错。',
  annotations: {
    title: '设置断点',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    url: zod
      .string()
      .optional()
      .describe(
        'JavaScript 文件的 URL（支持部分匹配或正则）。与 scriptId 二选一，优先使用 scriptId 精确定位。',
      ),
    scriptId: scriptIdSchema
      .optional()
      .describe(
        '脚本 ID（来自 list_scripts / search_in_sources）。按 scriptId 定位可避免 URL 歧义，要求该脚本在当前调试会话中仍已加载。',
      ),
    lineNumber: zod.number().int().describe('断点行号（1-based）.'),
    columnNumber: zod
      .number()
      .int()
      .optional()
      .default(0)
      .describe('列号（0-based，可选）.'),
    condition: zod
      .string()
      .optional()
      .describe('条件表达式，满足条件时断点才触发（可选）.'),
    isRegex: zod
      .boolean()
      .optional()
      .default(false)
      .describe('是否将 URL 视为正则表达式（仅在使用 url 时生效）.'),
  },
  handler: async (request, response, context) => {
    const url = request.params.url;
    const scriptId = request.params.scriptId;
    const lineNumber = request.params.lineNumber;
    const columnNumber = request.params.columnNumber;
    const condition = request.params.condition;
    const isRegex = request.params.isRegex;

    // url 与 scriptId 必须提供其一。
    const hasUrl = !!url && typeof url === 'string' && url.trim() !== '';
    const hasScriptId = !!scriptId && scriptId.trim() !== '';
    if (!hasUrl && !hasScriptId) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        'url 与 scriptId 至少提供一个。',
        {toolName: 'set_breakpoint'},
      );
    }

    const lineNum = typeof lineNumber === 'number' ? lineNumber : 1;

    try {
      const debuggerContext = await getDebuggerFromContext(context);
      let breakpoint: BreakpointInfo;
      if (hasScriptId) {
        breakpoint = await debuggerContext.setBreakpoint({
          scriptId,
          lineNumber: lineNum - 1,
          columnNumber: columnNumber ?? 0,
          condition,
        });
      } else if (isRegex) {
        breakpoint = await debuggerContext.setBreakpointByUrlRegex({
          urlRegex: url,
          lineNumber: lineNum - 1,
          columnNumber: columnNumber ?? 0,
          condition,
        });
      } else {
        breakpoint = await debuggerContext.setBreakpointByUrl({
          url,
          lineNumber: lineNum - 1,
          columnNumber: columnNumber ?? 0,
          condition,
        });
      }

      response.setStructuredContent({
        success: true,
        message: '断点已设置',
        tooltype: 'set_breakpoint',
        data: {
          breakpointId: breakpoint.breakpointId,
          url: hasUrl ? url : null,
          scriptId: hasScriptId ? scriptId : null,
          lineNumber: lineNum,
          columnNumber: columnNumber ?? 0,
          condition: condition,
          hint: '如果执行卡住，先运行 resume。如果总是在同一位置暂停，移除断点后改用 trace_function(pause=false) 或 hook_function。',
        },
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `设置断点失败: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'set_breakpoint'},
      );
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
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    breakpointId: zod
      .string()
      .describe('要移除的断点 ID（来自 list_breakpoints 或 set_breakpoint）。'),
  },
  handler: async (request, response, context) => {
    const breakpointId = request.params.breakpointId;

    if (
      !breakpointId ||
      typeof breakpointId !== 'string' ||
      breakpointId.trim() === ''
    ) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        'breakpointId 参数不能为空。',
        {toolName: 'remove_breakpoint'},
      );
    }

    try {
      const debuggerContext = await getDebuggerFromContext(context);
      await debuggerContext.removeBreakpoint(breakpointId);
      response.setStructuredContent({
        success: true,
        message: '断点已移除',
        tooltype: 'remove_breakpoint',
        data: {breakpointId},
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `移除断点失败: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'remove_breakpoint', breakpointId},
      );
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
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    try {
      const debuggerContext = await getDebuggerFromContext(context);
      const breakpoints = debuggerContext.getBreakpoints();

      if (breakpoints.length === 0) {
        response.setStructuredContent({
          success: true,
          message: '当前无活跃断点。',
          tooltype: 'list_breakpoints',
          data: {breakpoints: []},
        });
        return;
      }

      const breakpointData = breakpoints.map(bp => {
        const loc = bp.location ?? (bp as unknown as {location?: {url?: string; lineNumber?: number; columnNumber?: number}}).location;
        const url = loc?.url || (bp as unknown as {url?: string}).url || null;
        const lineNumber = (loc?.lineNumber ?? (bp as unknown as {lineNumber?: number}).lineNumber ?? 0) + 1;
        const columnNumber = loc?.columnNumber ?? (bp as unknown as {columnNumber?: number}).columnNumber ?? 0;
        return {
          breakpointId: bp.breakpointId,
          url,
          lineNumber,
          columnNumber,
          condition: bp.condition || null,
        };
      });

      response.setStructuredContent({
        success: true,
        message: `找到 ${breakpoints.length} 个活跃断点`,
        tooltype: 'list_breakpoints',
        data: {breakpoints: breakpointData},
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `列出断点失败: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'list_breakpoints'},
      );
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
  notPausedMessage:
    '当前未处于暂停状态，无法单步进入。请先命中断点或调用 pause。',
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
  notPausedMessage:
    '当前未处于暂停状态，无法单步跳过。请先命中断点或调用 pause。',
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
  notPausedMessage:
    '当前未处于暂停状态，无法单步跳出。请先命中断点或调用 pause。',
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
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
    requirements: {
      browser: 'connected',
      page: 'selected',
      debugger: 'available',
      recovery: true,
    },
  },
  schema: {},
  handler: async (request, response, context) => {
    try {
      const debuggerContext = await getDebuggerFromContext(context);
      await debuggerContext.resume();
      response.setStructuredContent({
        success: true,
        message: '执行已恢复',
        tooltype: 'resume',
        data: {action: 'resume'},
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `恢复执行失败: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'resume'},
      );
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
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (request, response, context) => {
    try {
      const debuggerContext = await getDebuggerFromContext(context);
      const client = debuggerContext.getClient();
      if (!client) {
        throw createToolError(
          ErrorCodes.CONNECTION,
          'Debugger 尚未启用，无法暂停执行',
          {toolName: 'pause'},
        );
      }
      await debuggerContext.pause();
      let reason: string;
      try {
        const pausedState = await debuggerContext.waitForPaused(5000);
        reason = pausedState.reason;
      } catch {
        const current = debuggerContext.getPausedState();
        if (!current) {
          response.setStructuredContent({
            success: true,
            message:
              '暂停请求已下发，但页面 5 秒内未执行 JavaScript（可能处于空闲状态）。' +
              '请求仍然生效，下次 JS 执行时会暂停；可调用 resume 取消。',
            tooltype: 'pause',
            data: {action: 'pause', pending: true},
          });
          return;
        }
        reason = current.reason;
      }
      response.setStructuredContent({
        success: true,
        message: '执行已暂停',
        tooltype: 'pause',
        data: {action: 'pause', reason},
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `暂停执行失败: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'pause'},
      );
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
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
    requirements: {
      browser: 'connected',
      page: 'selected',
      debugger: 'available',
    },
  },
  schema: {
    filter: zod
      .string()
      .optional()
      .describe('可选的过滤字符串，匹配脚本 URL（不区分大小写）.'),
  },
  handler: async (request, response, context) => {
    try {
      const debuggerContext = await getDebuggerFromContext(context);
      let scripts = debuggerContext.getScripts();

      // 应用过滤
      if (request.params.filter) {
        scripts = await debuggerContext.getScriptsByUrlPattern(
          request.params.filter,
        );
      }

      // 只保留 http(s) 协议的脚本（目标站点），排除 chrome-extension:// 等扩展脚本。
      const filteredScripts = scripts.filter(
        s => !!s.url && s.url.startsWith('http'),
      );

      // 过滤掉没有 URL 的脚本（内联/eval 脚本），除非它们是唯一的
      const scriptsWithUrls = filteredScripts.filter(s => s.url);
      const displayScripts =
        scriptsWithUrls.length > 0 ? scriptsWithUrls : scripts;

      if (displayScripts.length === 0) {
        response.setStructuredContent({
          success: true,
          message: '未找到脚本。',
          tooltype: 'list_scripts',
          data: {scripts: [], filter: request.params.filter || null},
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
        data: {scripts: scriptData, filter: request.params.filter || null},
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `列出脚本失败: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'list_scripts'},
      );
    }
  },
});

/**
 * 获取脚本源码。
 */
export const getScriptSource = defineTool({
  name: 'get_script_source',
  description:
    '根据脚本 ID 获取 JavaScript 脚本源码的本地缓存路径。触发 CDP 加载并写入临时文件，返回文件路径供后续直接读取。先使用 list_scripts 查找脚本 ID。可选 filePath 参数可将源码写入自定义路径并返回该绝对路径。',
  annotations: {
    title: '获取脚本源码',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    // 接受字符串或数字：纯远程 CLI（browsercli）会把纯数字 ID 自动推断为
    // number，这里统一归一化为 string，避免 [VALIDATION] 校验失败。
    scriptId: scriptIdSchema
      .optional()
      .describe(
        '脚本 ID（来自 list_scripts）用于获取源码缓存路径。页面刷新后 scriptId 会重新分配，可搭配 locator 恢复定位。',
      ),
    locator: scriptLocatorSchema
      .optional()
      .describe(
        '脚本定位器（来自 get_script_source 返回的 locator 字段）。当 scriptId 失效或省略时，用于按 URL/长度/hash 重新定位同一脚本。',
      ),
    filePath: zod
      .string()
      .optional()
      .describe(
        '可选的自定义保存路径。提供时将源码写入该文件并返回其绝对路径；不传则使用内置临时缓存路径。',
      ),
    startLine: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('可选的起始行号（从 1 开始，须与 endLine 同时提供）。'),
    endLine: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        '可选的结束行号（从 1 开始，包含该行，须与 startLine 同时提供）。',
      ),
  },
  handler: async (request, response, context) => {
    const {filePath, startLine, endLine, locator} = request.params;
    // scriptId 可能被 browsercli 推断为 number，统一归一化为 string。
    // schema 的 transform 在生产管线会生效，但单测直接调用 handler 时不会经过
    // schema，这里再做一次兜底，保证 resolveScript 的精确匹配。scriptId 与
    // locator 均为可选，由 resolver 校验至少提供其一。
    const scriptId =
      request.params.scriptId !== undefined
        ? String(request.params.scriptId)
        : undefined;

    try {
      if ((startLine === undefined) !== (endLine === undefined)) {
        throw new Error('startLine 与 endLine 必须同时提供');
      }
      if (
        startLine !== undefined &&
        endLine !== undefined &&
        startLine > endLine
      ) {
        throw new Error('startLine 不能大于 endLine');
      }

      const debuggerContext = await getDebuggerFromContext(context);
      const resolved = await resolveScript(
        {
          getScripts: () => debuggerContext.getScripts(),
          getScriptSource: (id: string) => debuggerContext.getScriptSource(id),
          // DebuggerManager 自身不含 resolvePage，pageId 存在性校验须复用
          // 工具上下文的页面解析能力。
          resolvePage: (selector: PageSelector) =>
            context.resolvePage(selector),
        },
        {
          scriptId,
          locator,
        },
      );

      let sourcePath: string;
      let bytesWritten: number | undefined;
      if (filePath) {
        // 显式 filePath：走原子写入器，完整落盘 + 字节长度/SHA-256 校验。
        const target = path.resolve(filePath);
        const written = await writeScriptFileAtomic(target, resolved.source);
        sourcePath = target;
        bytesWritten = written.bytesWritten;
      } else {
        // 未传 filePath：保持原有行为，返回内置缓存路径。
        const cachePath = await debuggerContext.getScriptSourcePath(
          resolved.scriptId,
        );
        if (!cachePath) {
          throw createToolError(
            ErrorCodes.NOT_FOUND,
            `未找到脚本 ${resolved.scriptId} 的源码或加载失败。`,
            {toolName: 'get_script_source', scriptId: resolved.scriptId},
          );
        }
        sourcePath = cachePath;
      }

      const excerpt =
        startLine !== undefined && endLine !== undefined
          ? resolved.source
              .split(/\r?\n/)
              .slice(startLine - 1, endLine)
              .join('\n')
          : undefined;

      const selectedPage = context.getSelectedPage();

      response.setStructuredContent({
        success: true,
        message: `脚本 ${resolved.scriptId} 源码已缓存至 ${sourcePath}`,
        data: {
          scriptId: resolved.scriptId,
          url: resolved.url || null,
          sourceLength: resolved.sourceLength,
          sourcePath,
          sha256: resolved.sha256,
          // 该工具返回文件路径而非内联源码，磁盘文件始终是经 sha256 校验的完整源码，
          // 因此 responseTruncated 恒为 false（startLine/endLine 是用户显式请求的区间，非预算截断）。
          responseTruncated: false,
          matchedBy: resolved.matchedBy,
          locator: {
            ...(selectedPage ? {pageId: context.getPageId(selectedPage)} : {}),
            // url 保留原始值（内联/eval 脚本为 ''），确保 locator 可往返精确匹配；
            // 顶层 url 字段仍归一化为 null 供展示。
            url: resolved.url,
            sourceLength: resolved.sourceLength,
            contentHash: resolved.sha256,
          },
          ...(resolved.staleScriptIdRecovered
            ? {staleScriptIdRecovered: true}
            : {}),
          ...(bytesWritten === undefined ? {} : {bytesWritten}),
          ...(excerpt === undefined
            ? {}
            : {startLine, endLine, source: excerpt}),
        },
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `获取脚本源码路径失败: ${error instanceof Error ? error.message : String(error)}`,
        {
          toolName: 'get_script_source',
          ...(scriptId !== undefined ? {scriptId} : {}),
        },
      );
    }
  },
});

/**
 * 中间截断 URL：保留头部（origin + 路径起点）与尾部（末段路径/查询），
 * 比单纯末尾截断更利于识别 combo/合并服务脚本的来源。
 */
/**
 * 在源码中搜索。
 */
export const searchInSources = defineTool({
  name: 'search_in_sources',
  description:
    '在所有已加载的 JavaScript 源码中搜索字符串或正则表达式。每条匹配仅返回脚本 ID、行号与源码缓存路径（sourcePath），避免上下文臃肿；需要查看代码内容时直接读取 sourcePath 或调用 get_script_source(scriptId, startLine, endLine)。可选 filePath 参数（目录）可将每个匹配脚本的源码写入该目录（<filePath>/<scriptId>.js）并返回绝对路径。',
  annotations: {
    title: '在源码中搜索',
    category: ToolCategory.REVERSE_ENGINEERING,
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
    excludeMinified: zod
      .boolean()
      .optional()
      .default(false)
      .describe('跳过压缩文件（行长度 > 10000 字符）。默认: false。'),
    urlFilter: zod
      .string()
      .optional()
      .describe('只搜索 URL 包含此字符串的脚本（不区分大小写）。'),
    source: zod
      .enum(['live', 'cache', 'auto'])
      .optional()
      .default('auto')
      .describe(
        "搜索来源：'live' 只走 CDP，'cache' 只走本地缓存，'auto' 先尝试 CDP 失败时 fallback 到缓存",
      ),
    filePath: zod
      .string()
      .optional()
      .describe(
        '可选的目录路径。提供时把每个匹配脚本的源码写入该目录下以脚本 ID 命名的文件（<filePath>/<scriptId>.js）并返回其绝对路径；不传则使用内置临时缓存路径。',
      ),
  },
  handler: async (request, response, context) => {
    const {
      query,
      caseSensitive,
      isRegex,
      maxResults,
      excludeMinified,
      urlFilter,
      source,
      filePath,
    } = request.params;

    const searchWithCdp = async () => {
      const debuggerContext = await getDebuggerFromContext(context);
      return debuggerContext.searchInScripts(query, {caseSensitive, isRegex});
    };

    const searchWithCache = async () => {
      const {CodeCache} = await import('../../modules/collector/CodeCache.js');
      const cache = new CodeCache();
      return cache.searchInCache(query, {caseSensitive, isRegex, urlFilter});
    };

    try {
      let matches: Array<{
        scriptId: string;
        url?: string;
        lineNumber: number;
        lineContent: string;
      }>;
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
          data: {
            query,
            matches: [],
            totalMatches: 0,
            filtered: false,
            searchSource,
          },
        });
        return;
      }

      // 只保留 http(s) 协议的脚本（目标站点），排除 chrome-extension:// 等扩展脚本。
      matches = matches.filter(m => !!m.url && m.url.startsWith('http'));

      if (matches.length === 0) {
        response.setStructuredContent({
          success: true,
          message: `未找到匹配 "${query}"。`,
          tooltype: 'search_in_sources',
          data: {
            query,
            matches: [],
            totalMatches: 0,
            filtered: false,
            searchSource,
          },
        });
        return;
      }

      // 过滤匹配
      let filteredMatches = matches;

      // 应用 URL 过滤
      filteredMatches = filterMatchesByUrl(
        filteredMatches,
        urlFilter,
        m => m.url,
      );

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

      // CDP 对 combo/合并脚本可能对同一行返回多条匹配，按 (scriptId, lineNumber) 去重。
      const seenPositions = new Set<string>();
      filteredMatches = filteredMatches.filter(m => {
        const key = `${m.scriptId}:${m.lineNumber}`;
        if (seenPositions.has(key)) return false;
        seenPositions.add(key);
        return true;
      });

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
            hint:
              skippedMinified > 0
                ? '设置 excludeMinified=false 以包含压缩文件中的匹配'
                : null,
          },
        });
        return;
      }

      const displayMatches = filteredMatches.slice(0, maxResults);
      const totalMatches = filteredMatches.length;

      // 按 scriptId 去重批量获取 sourcePath，避免重复 IO。
      // cache 模式或调试器未启用时 debuggerContext 不可用，sourcePath 留 null。
      let debuggerContextForPaths: Awaited<
        ReturnType<typeof getDebuggerFromContext>
      > | null = null;
      try {
        debuggerContextForPaths = await getDebuggerFromContext(context);
      } catch {
        debuggerContextForPaths = null;
      }

      const uniqueScriptIds = [...new Set(displayMatches.map(m => m.scriptId))];
      const sourcePathMap = new Map<string, string | null>();
      if (debuggerContextForPaths) {
        // filePath 作为目录：把每个脚本源码写入 <filePath>/<scriptId>.js。
        const savePathFor = (id: string) =>
          filePath ? path.join(path.resolve(filePath), `${id}.js`) : undefined;
        await Promise.all(
          uniqueScriptIds.map(async id => {
            try {
              sourcePathMap.set(
                id,
                await debuggerContextForPaths!.getScriptSourcePath(
                  id,
                  savePathFor(id),
                ),
              );
            } catch {
              sourcePathMap.set(id, null);
            }
          }),
        );
      }

      const matchData = displayMatches.map(match => {
        const scriptId = match.scriptId;

        return {
          scriptId,
          lineNumber: match.lineNumber + 1,
          sourcePath: sourcePathMap.get(scriptId) ?? null,
        };
      });

      // 防御性体积预判：即使 URL 已截断，匹配数量多时仍可能超过 512KB offload 阈值。
      // 在工具层主动收窄 displayMatches，免去二次 get_detailed_data 调用。
      const SAFETY_THRESHOLD = 200 * 1024;
      const DEFAULT_HINT =
        '直接读取 sourcePath 查看完整源码，或用 get_script_source(scriptId, startLine, endLine) 查看指定区间。';
      const buildPayload = (matches: typeof matchData) => ({
        success: true as const,
        message: `找到 ${totalMatches} 个匹配 "${query}"${totalMatches > maxResults ? ` (显示前 ${maxResults})` : ''}`,
        tooltype: 'search_in_sources',
        data: {
          query,
          matches,
          totalMatches,
          displayedMatches: matches.length,
          skippedMinified,
          maxResults,
          hint: DEFAULT_HINT,
        },
      });

      let safeMatches = matchData;
      let truncatedBySize = false;
      if (
        safeMatches.length > 1 &&
        safeStringify(buildPayload(safeMatches)).length > SAFETY_THRESHOLD
      ) {
        while (
          safeMatches.length > 1 &&
          safeStringify(buildPayload(safeMatches)).length > SAFETY_THRESHOLD
        ) {
          safeMatches = safeMatches.slice(0, Math.ceil(safeMatches.length / 2));
          truncatedBySize = true;
        }
      }

      const hint = truncatedBySize
        ? `${DEFAULT_HINT} 响应体积过大，已自动收窄显示数量（${safeMatches.length}/${matchData.length}）。使用 maxResults 或 urlFilter 收窄查询。`
        : DEFAULT_HINT;

      response.setStructuredContent({
        success: true,
        message: `找到 ${totalMatches} 个匹配 "${query}"${totalMatches > maxResults ? ` (显示前 ${maxResults})` : ''}`,
        tooltype: 'search_in_sources',
        data: {
          query,
          matches: safeMatches,
          totalMatches,
          displayedMatches: safeMatches.length,
          skippedMinified,
          maxResults,
          truncatedBySize,
          hint,
        },
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'search_in_sources', query: request.params.query},
      );
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
    category: ToolCategory.REVERSE_ENGINEERING,
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
    const {target, urlFilter, logArgs, logStack, hookId} = request.params;

    if (!target || typeof target !== 'string') {
      throw createToolError(
        ErrorCodes.VALIDATION,
        'target 参数不能为空。需要提供一个函数名。',
        {toolName: 'trace_function'},
      );
    }

    const debugger_ = await getDebuggerFromContext(context);
    if (!debugger_.isEnabled()) {
      throw createToolError(
        ErrorCodes.PREREQUISITE,
        '调试器未启用，请先选择页面。',
        {toolName: 'trace_function', target},
      );
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
        matches = filterMatchesByUrl(matches, urlFilter, m => m.url);

        // 跳过压缩文件
        matches = matches.filter(
          m => m.lineContent.length < MINIFIED_LINE_THRESHOLD,
        );

        if (matches.length > 0) {
          foundMatch = {pattern, match: matches[0]};
          break;
        }
      }

      if (!foundMatch) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `未找到函数 "${target}"。`,
          {
            toolName: 'trace_function',
            target,
            searchedPatterns: patterns.slice(0, 4),
            hint: '使用 search_in_sources 查找确切的函数签名，然后使用 set_breakpoint。',
          },
        );
      }

      const {match} = foundMatch;
      const script = debugger_.getScriptById(match.scriptId);
      const url = script?.url || match.url;

      if (!url) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          '无法追踪：脚本没有 URL（内联脚本）。',
          {toolName: 'trace_function', target},
        );
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
        logParts.push(
          `new Error().stack?.split('\\n').slice(2, 6).map(s => s.trim())`,
        );
      }
      const logExpr = `console.log(${logParts.join(', ')})`;

      // 如果不暂停，包装为返回 false 的表达式
      const condition = logStack ? logExpr : `(${logExpr}, false)`;

      // 设置断点
      const breakpointInfo = await debugger_.setBreakpointByUrl({
        url,
        lineNumber: match.lineNumber,
        columnNumber,
        condition,
      });

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
          stopCommand: `remove_breakpoint(breakpointId: "${breakpointInfo.breakpointId}")`,
        },
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `错误: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'trace_function', target: request.params.target},
      );
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
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    try {
      const debuggerContext = await getDebuggerFromContext(context);
      const breakpoints = debuggerContext.getBreakpoints();
      const scripts = debuggerContext.getScripts();

      response.setStructuredContent({
        success: true,
        message: '已获取调试状态',
        tooltype: 'get_ai_debug_status',
        data: {
          isPaused: debuggerContext.isPaused(),
          breakpointsCount: breakpoints.length,
          scriptsCount: scripts.length,
          lastAutoRecoveryEvent:
            debuggerContext.getLastAutoRecoveryEvent() ?? null,
          debuggerStatus: '已启用',
        },
      });
    } catch {
      response.setStructuredContent({
        success: true,
        message: '调试器尚未初始化',
        tooltype: 'get_ai_debug_status',
        data: {
          isPaused: false,
          breakpointsCount: 0,
          scriptsCount: 0,
          lastAutoRecoveryEvent: null,
          debuggerStatus: '未启用',
        },
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
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    // 与 get_script_source 一致：CLI 可能传入数字 ID，统一归一化为 string。
    scriptId: scriptIdSchema.describe('要搜索的脚本 ID（来自 list_scripts）。'),
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
    const {
      scriptId,
      query,
      contextChars = 100,
      occurrence = 1,
      caseSensitive = true,
    } = request.params;

    try {
      const debuggerContext = await getDebuggerFromContext(context);
      const source = await debuggerContext.getScriptSource(scriptId);

      if (!source) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `未找到脚本 ${scriptId} 的源码。`,
          {toolName: 'find_in_script', scriptId},
        );
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
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `"${query}" 未在脚本 ${scriptId} 中找到${occurrence > 1 ? ` (第 ${occurrence} 个匹配)` : ''}。`,
          {toolName: 'find_in_script', scriptId, query, occurrence},
        );
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
            fullContext: `${prefix}${beforeContext}【${matchText}】${afterContext}${suffix}`,
          },
          setBreakpointCommand: `set_breakpoint(url: "${url}", lineNumber: ${lineNumber + 1}, columnNumber: ${columnNumber})`,
        },
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `错误: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'find_in_script', scriptId: request.params.scriptId},
      );
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
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    requestId: zod
      .number()
      .int()
      .describe('请求 ID（来自 list_network_requests）用于获取发起者。'),
  },
  handler: async (request, response, context) => {
    const {requestId} = request.params;

    try {
      const ctx = context as unknown as ToolContextProvider;
      const httpRequest = ctx.getNetworkRequestById(requestId);
      const initiator = ctx.getRequestInitiator(httpRequest);

      if (!initiator) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `未找到请求 ${requestId} 的发起者信息。`,
          {
            toolName: 'get_request_initiator',
            requestId,
            hint: '这可能是导航请求或发起者未被捕获。',
          },
        );
      }

      const stackFrames =
        initiator.stack?.callFrames?.map((frame, i) => ({
          index: i + 1,
          functionName: frame.functionName || '(匿名)',
          url: frame.url,
          lineNumber: frame.lineNumber + 1,
          columnNumber: frame.columnNumber,
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
          lineNumber:
            initiator.lineNumber !== undefined
              ? initiator.lineNumber + 1
              : null,
          columnNumber:
            initiator.columnNumber !== undefined
              ? initiator.columnNumber
              : null,
          stackFrames,
          hasStack: stackFrames.length > 0,
        },
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `获取发起者失败: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'get_request_initiator', requestId: request.params.requestId},
      );
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
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    includeScopes: zod
      .boolean()
      .optional()
      .default(true)
      .describe('是否包含作用域变量（默认: true）。'),
  },
  handler: async (request, response, context) => {
    try {
      const debuggerContext = await getDebuggerFromContext(context);
      const pausedInfo = await buildPausedInfoData(debuggerContext, {
        includeScopes: request.params.includeScopes,
      });

      if (!pausedInfo) {
        throw createToolError(
          ErrorCodes.DEBUGGER_NOT_PAUSED,
          '执行未暂停。',
          {toolName: 'get_paused_info'},
          {
            recovery: {
              tool: 'pause',
              command: 'browsercli call pause',
              reason: 'Pause execution first',
            },
          },
        );
      }

      response.setStructuredContent({
        success: true,
        message: '执行已暂停',
        tooltype: 'get_paused_info',
        data: pausedInfo,
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `获取暂停信息失败: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'get_paused_info'},
      );
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
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
    requirements: {
      browser: 'connected',
      page: 'selected',
      debugger: 'paused',
    },
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
    const {expression, frameIndex: rawFrameIndex} = request.params;
    const frameIndex = rawFrameIndex ?? 0;

    try {
      const debuggerContext = await getDebuggerFromContext(context);
      const pausedState = debuggerContext.getPausedState();

      if (!pausedState) {
        throw createToolError(
          ErrorCodes.DEBUGGER_NOT_PAUSED,
          '执行未暂停，无法执行表达式。',
          {toolName: 'evaluate_on_callframe'},
          {
            recovery: {
              tool: 'pause',
              command: 'browsercli call pause',
              reason: 'Pause execution first',
            },
          },
        );
      }

      if (frameIndex >= pausedState.callFrames.length) {
        throw createToolError(
          ErrorCodes.VALIDATION,
          `无效的帧索引 ${frameIndex}。可用帧: 0-${pausedState.callFrames.length - 1}`,
          {
            toolName: 'evaluate_on_callframe',
            frameIndex,
            availableFrames: pausedState.callFrames.length,
          },
        );
      }

      const callFrameId = pausedState.callFrames[frameIndex].callFrameId;

      const result = await debuggerContext.evaluateOnCallFrame({
        callFrameId,
        expression,
        returnByValue: true,
        generatePreview: true,
      });

      if (result.exceptionDetails) {
        throw createToolError(
          ErrorCodes.RUNTIME,
          `错误: ${result.exceptionDetails.text}`,
          {
            toolName: 'evaluate_on_callframe',
            expression,
            frameIndex,
            exception: result.exceptionDetails.exception?.description || null,
          },
        );
      } else {
        response.setStructuredContent({
          success: true,
          message: '执行成功',
          tooltype: 'evaluate_on_callframe',
          data: {
            expression,
            frameIndex,
            result:
              result.result.value !== undefined
                ? result.result.value
                : result.result.description || `[${result.result.type}]`,
          },
        });
      }
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `执行失败: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'evaluate_on_callframe', expression: request.params.expression},
      );
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
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    try {
      const debuggerContext = await getDebuggerFromContext(context);
      const pausedState = debuggerContext.getPausedState();

      if (!pausedState) {
        throw createToolError(
          ErrorCodes.DEBUGGER_NOT_PAUSED,
          '当前未处于暂停状态',
          {toolName: 'inspect_locals'},
          {
            recovery: {
              tool: 'pause',
              command: 'browsercli call pause',
              reason: 'Pause execution first',
            },
          },
        );
      }

      const frames = await Promise.all(
        pausedState.callFrames.map(async (frame, idx) => {
          const locals: Array<{name: string; type: string; value: unknown}> =
            [];
          const localScope = frame.scopeChain.find(s => s.type === 'local');
          if (localScope?.object?.objectId) {
            try {
              const vars = await debuggerContext.getScopeVariablesForObjectId(
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
            locals: f.locals,
          })),
        },
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `检查局部变量失败: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'inspect_locals'},
      );
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
    category: ToolCategory.REVERSE_ENGINEERING,
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
      .describe('只搜索 URL 包含此字符串的脚本（不区分大小写）。'),
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
    const {text, urlFilter, occurrence = 1, condition} = request.params;

    try {
      const debuggerContext = await getDebuggerFromContext(context);

      // 步骤 1: 在所有脚本中搜索文本
      const searchResult = await debuggerContext.searchInScripts(text, {
        caseSensitive: true,
        isRegex: false,
      });

      if (searchResult.matches.length === 0) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `"${text}" 未在任何已加载脚本中找到。`,
          {toolName: 'set_breakpoint_on_text', text},
        );
      }

      // 应用 URL 过滤
      const matches = filterMatchesByUrl(
        searchResult.matches,
        urlFilter,
        m => m.url,
      );
      if (matches.length === 0) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `"${text}" 在未匹配 "${urlFilter}" 的脚本中找到。`,
          {toolName: 'set_breakpoint_on_text', text, urlFilter},
        );
      }

      // 获取指定的匹配项
      if (occurrence > matches.length) {
        throw createToolError(
          ErrorCodes.VALIDATION,
          `只有 ${matches.length} 个匹配项，但请求了第 ${occurrence} 个。`,
          {
            toolName: 'set_breakpoint_on_text',
            text,
            matchesCount: matches.length,
            requestedOccurrence: occurrence,
          },
        );
      }

      const match = matches[occurrence - 1];
      if (!match) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `未找到第 ${occurrence} 个匹配项。`,
          {
            toolName: 'set_breakpoint_on_text',
            text,
            matchesCount: matches.length,
            requestedOccurrence: occurrence,
          },
        );
      }
      const script = debuggerContext.getScriptById(match.scriptId);
      const url = script?.url || match.url;

      if (!url) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          '无法设置断点：脚本没有 URL（内联脚本）。',
          {toolName: 'set_breakpoint_on_text', text},
        );
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
      const breakpointInfo = await debuggerContext.setBreakpointByUrl({
        url,
        lineNumber: match.lineNumber,
        columnNumber,
        condition,
      });

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
          hint: '如果执行卡住，先运行 resume。如果总是在同一位置暂停，移除断点后改用 trace_function(pause=false) 或 hook_function。',
        },
      });
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `错误: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'set_breakpoint_on_text', text: request.params.text},
      );
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
