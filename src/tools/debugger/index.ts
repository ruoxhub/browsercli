/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ToolContextProvider} from '../../worker/ToolContextProvider.js';

import {defineTool} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

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

async function getDebugger(runtime: DebuggerRuntime) {
  if (!runtime) {
    throw new Error(
      '缺少调试运行时上下文：runtime 为空。请确保已选择页面且调试器可用。',
    );
  }
  if (typeof runtime.getDebuggerContext !== 'function') {
    const available = Object.keys(runtime).slice(0, 10).join(', ');
    throw new Error(
      `缺少调试运行时上下文：runtime.getDebuggerContext 不是函数` +
        `(typeof=${typeof runtime.getDebuggerContext}, keys=[${available}])。` +
        '请确保已选择页面且调试器可用。',
    );
  }
  try {
    return await runtime.getDebuggerContext();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`获取调试上下文失败: ${detail}`);
  }
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
      response.appendResponseLine('url 参数不能为空。');
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

      response.appendResponseLine(`✅ 断点已设置！`);
      response.appendResponseLine(`- ID: ${breakpoint.breakpointId}`);
      response.appendResponseLine(`- URL: ${url}`);
      response.appendResponseLine(`- 行号: ${lineNum}`);
      if (condition) {
        response.appendResponseLine(`- 条件: ${condition}`);
      }
      if (breakpoint.locations.length > 0) {
        response.appendResponseLine(
          `- 已解析到 ${breakpoint.locations.length} 个位置`,
        );
      }
      response.appendResponseLine(
        '- 提示: 如果执行卡住，先运行 resume。如果总是在同一位置暂停，移除断点后改用 trace_function(pause=false) 或 hook_function。',
      );
    } catch (error) {
      response.appendResponseLine(
        `设置断点失败: ${error instanceof Error ? error.message : String(error)}`,
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
      response.appendResponseLine('breakpointId 参数不能为空。');
      return;
    }

    try {
      const debuggerContext = await getDebugger(runtime);
      await debuggerContext.removeBreakpoint(breakpointId);
      response.appendResponseLine(`✅ 断点 ${breakpointId} 已移除`);
    } catch (error) {
      response.appendResponseLine(
        `移除断点失败: ${error instanceof Error ? error.message : String(error)}`,
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
        response.appendResponseLine('当前无活跃断点。');
        return;
      }

      response.appendResponseLine(`活跃断点（${breakpoints.length} 个）:\n`);
      for (const bp of breakpoints) {
        response.appendResponseLine(`- ID: ${bp.breakpointId}`);
        response.appendResponseLine(`  URL: ${bp.url}`);
        response.appendResponseLine(
          `  行号: ${bp.lineNumber + 1}, 列号: ${bp.columnNumber}`,
        );
        if (bp.condition) {
          response.appendResponseLine(`  条件: ${bp.condition}`);
        }
        if (bp.locations.length > 0) {
          response.appendResponseLine(`  位置数量: ${bp.locations.length}`);
        }
        response.appendResponseLine('');
      }
    } catch (error) {
      response.appendResponseLine(
        `列出断点失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

/**
 * 单步进入。
 */
export const stepInto = defineTool({
  name: 'step_into',
  description:
    '单步进入函数调用。用于进入函数体内部进行调试。需要先在断点暂停。',
  annotations: {
    title: '单步进入',
    category: 'debugging' as ToolCategory,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;

    try {
      const debuggerContext = await getDebugger(runtime);
      const pausedState = debuggerContext.getPausedState();
      if (!pausedState.isPaused) {
        response.appendResponseLine(
          '当前未处于暂停状态，无法单步进入。请先命中断点或调用 pause。',
        );
        return;
      }
      await debuggerContext.stepInto();
      response.appendResponseLine('⏭️ 单步进入执行完成');
      response.appendResponseLine('使用 get_paused_info 查看当前状态。');
    } catch (error) {
      response.appendResponseLine(
        `单步进入失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

/**
 * 单步跳过。
 */
export const stepOver = defineTool({
  name: 'step_over',
  description:
    '单步跳过函数调用，将函数调用视为一个步骤。用于跳过函数体。需要先在断点暂停。',
  annotations: {
    title: '单步跳过',
    category: 'debugging' as ToolCategory,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;

    try {
      const debuggerContext = await getDebugger(runtime);
      const pausedState = debuggerContext.getPausedState();
      if (!pausedState.isPaused) {
        response.appendResponseLine(
          '当前未处于暂停状态，无法单步跳过。请先命中断点或调用 pause。',
        );
        return;
      }
      await debuggerContext.stepOver();
      response.appendResponseLine('⏭️ 单步跳过执行完成');
      response.appendResponseLine('使用 get_paused_info 查看当前状态。');
    } catch (error) {
      response.appendResponseLine(
        `单步跳过失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

/**
 * 单步跳出。
 */
export const stepOut = defineTool({
  name: 'step_out',
  description:
    '单步跳出当前函数，继续执行直到函数返回。用于快速退出函数。需要先在断点暂停。',
  annotations: {
    title: '单步跳出',
    category: 'debugging' as ToolCategory,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;

    try {
      const debuggerContext = await getDebugger(runtime);
      const pausedState = debuggerContext.getPausedState();
      if (!pausedState.isPaused) {
        response.appendResponseLine(
          '当前未处于暂停状态，无法单步跳出。请先命中断点或调用 pause。',
        );
        return;
      }
      await debuggerContext.stepOut();
      response.appendResponseLine('⏆️ 单步跳出执行完成');
      response.appendResponseLine('使用 get_paused_info 查看当前状态。');
    } catch (error) {
      response.appendResponseLine(
        `单步跳出失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
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
      response.appendResponseLine('▶️ 执行已恢复');
    } catch (error) {
      response.appendResponseLine(
        `恢复执行失败: ${error instanceof Error ? error.message : String(error)}`,
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
        response.appendResponseLine('Debugger 尚未启用，无法暂停执行');
        return;
      }
      await debuggerContext.pause();
      response.appendResponseLine('⏸️ 已请求暂停执行，等待暂停...');
    } catch (error) {
      response.appendResponseLine(
        `暂停执行失败: ${error instanceof Error ? error.message : String(error)}`,
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
        response.appendResponseLine('未找到脚本。');
        return;
      }

      response.appendResponseLine(`找到 ${displayScripts.length} 个脚本:\n`);
      for (const script of displayScripts) {
        response.appendResponseLine(`- ID: ${script.scriptId}`);
        response.appendResponseLine(`  URL: ${script.url || '(内联/eval)'}`);
        if (script.sourceMapURL) {
          response.appendResponseLine(`  SourceMap: ${script.sourceMapURL}`);
        }
        response.appendResponseLine('');
      }
    } catch (error) {
      response.appendResponseLine(
        `列出脚本失败: ${error instanceof Error ? error.message : String(error)}`,
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
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;
    const {scriptId, startLine, endLine, offset, length} = request.params;

    try {
      const debuggerContext = await getDebugger(runtime);
      const source = await debuggerContext.getScriptSource(scriptId);

      if (!source) {
        response.appendResponseLine(`未找到脚本 ${scriptId} 的源码。`);
        return;
      }

      // 字符偏移模式（用于压缩文件）
      if (offset !== undefined) {
        const start = Math.max(0, offset);
        const end = Math.min(source.length, start + (length || 1000));
        const extract = source.substring(start, end);

        const prefix = start > 0 ? '...' : '';
        const suffix = end < source.length ? '...' : '';

        response.appendResponseLine(
          `脚本 ${scriptId} 的源码（字符 ${start}-${end} / ${source.length}）:\n`,
        );
        response.appendResponseLine('```javascript');
        response.appendResponseLine(`${prefix}${extract}${suffix}`);
        response.appendResponseLine('```');
        return;
      }

      // 行范围模式（用于正常文件）
      if (startLine !== undefined || endLine !== undefined) {
        const lines = source.split('\n');
        const start = (startLine ?? 1) - 1; // 转换为 0-based
        const end = endLine ?? lines.length;
        const selectedLines = lines.slice(start, end);

        response.appendResponseLine(
          `脚本 ${scriptId} 的源码（行 ${start + 1}-${Math.min(end, lines.length)}）:\n`,
        );
        response.appendResponseLine('```javascript');
        for (let i = 0; i < selectedLines.length; i++) {
          response.appendResponseLine(`${start + i + 1}: ${selectedLines[i]}`);
        }
        response.appendResponseLine('```');
        return;
      }

      // 完整源码 - 但警告如果太大
      if (source.length > 50000) {
        response.appendResponseLine(
          `脚本 ${scriptId} 很大（${source.length} 字符）。请使用 offset/length 或 startLine/endLine 读取部分。`,
        );
        response.appendResponseLine(`前 1000 个字符:\n`);
        response.appendResponseLine('```javascript');
        response.appendResponseLine(source.substring(0, 1000) + '...');
        response.appendResponseLine('```');
      } else {
        response.appendResponseLine(`脚本 ${scriptId} 的源码:\n`);
        response.appendResponseLine('```javascript');
        response.appendResponseLine(source);
        response.appendResponseLine('```');
      }
    } catch (error) {
      response.appendResponseLine(
        `获取脚本源码失败: ${error instanceof Error ? error.message : String(error)}`,
      );
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
    } = request.params;

    try {
      const debuggerContext = await getDebugger(runtime);
      const result = await debuggerContext.searchInScripts(query, {
        caseSensitive,
        isRegex,
      });

      if (result.matches.length === 0) {
        response.appendResponseLine(`未找到匹配 "${query}"。`);
        return;
      }

      // 过滤匹配
      let filteredMatches = result.matches;

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
        response.appendResponseLine(`未找到匹配 "${query}"。`);
        if (skippedMinified > 0) {
          response.appendResponseLine(
            `（跳过了 ${skippedMinified} 个压缩文件中的匹配。设置 excludeMinified=false 以包含它们。）`,
          );
        }
        return;
      }

      const displayMatches = filteredMatches.slice(0, maxResults);
      const totalMatches = filteredMatches.length;

      response.appendResponseLine(
        `找到 ${totalMatches} 个匹配 "${query}"${totalMatches > maxResults ? ` (显示前 ${maxResults})` : ''}:`,
      );
      if (skippedMinified > 0) {
        response.appendResponseLine(
          `（跳过了 ${skippedMinified} 个压缩文件中的匹配）`,
        );
      }
      response.appendResponseLine('');

      for (const match of displayMatches) {
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

        response.appendResponseLine(`[${scriptId}] ${url}:${lineNum}`);
        response.appendResponseLine(`  ${preview}`);
        response.appendResponseLine('');
      }

      response.appendResponseLine('---');
      response.appendResponseLine(
        '提示: 使用 get_script_source(scriptId, startLine, endLine) 查看匹配周围的完整上下文。',
      );
    } catch (error) {
      response.appendResponseLine(
        `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

/**
 * 设置 XHR 断点。
 */
export const breakOnXhr = defineTool({
  name: 'break_on_xhr',
  description:
    '在 XHR/Fetch 请求 URL 包含指定字符串时触发断点。',
  annotations: {
    title: '设置 XHR 断点',
    category: 'reverse_engineering' as ToolCategory,
    readOnlyHint: false,
  },
  schema: {
    url: zod.string().describe('要断点的 URL 模式（部分匹配）。'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;
    const {url} = request.params;

    try {
      const debuggerContext = await getDebugger(runtime);
      const client = debuggerContext.getClient();

      if (!client) {
        response.appendResponseLine('Debugger 客户端不可用。');
        return;
      }

      await client.send('DOMDebugger.setXHRBreakpoint', {url});
      response.appendResponseLine(`✅ XHR 断点已设置，URL 模式: "${url}"`);
      response.appendResponseLine('匹配的 XHR/Fetch 请求发出时将暂停执行。');
    } catch (error) {
      response.appendResponseLine(
        `设置 XHR 断点失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

/**
 * 移除 XHR 断点。
 */
export const removeXhrBreakpoint = defineTool({
  name: 'remove_xhr_breakpoint',
  description: '移除 XHR/Fetch 断点。',
  annotations: {
    title: '移除 XHR 断点',
    category: 'reverse_engineering' as ToolCategory,
    readOnlyHint: false,
  },
  schema: {
    url: zod.string().describe('要移除断点的 URL 模式。'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;
    const {url} = request.params;

    try {
      const debuggerContext = await getDebugger(runtime);
      const client = debuggerContext.getClient();

      if (!client) {
        response.appendResponseLine('Debugger 客户端不可用。');
        return;
      }

      await client.send('DOMDebugger.removeXHRBreakpoint', {url});
      response.appendResponseLine(`✅ XHR 断点已移除: "${url}"`);
    } catch (error) {
      response.appendResponseLine(
        `移除 XHR 断点失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
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
        response.appendResponseLine(`❌ 未找到函数 "${target}"。`);
        response.appendResponseLine('');
        response.appendResponseLine('搜索过的模式：');
        for (const p of patterns.slice(0, 4)) {
          response.appendResponseLine(`  - "${p}"`);
        }
        response.appendResponseLine('');
        response.appendResponseLine('提示: 使用 search_in_sources 查找确切的函数签名，然后使用 set_breakpoint。');
        return;
      }

      const {match} = foundMatch;
      const script = debugger_.getScriptById(match.scriptId);
      const url = script?.url || match.url;

      if (!url) {
        response.appendResponseLine('无法追踪：脚本没有 URL（内联脚本）。');
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

      response.appendResponseLine(`✅ 函数追踪已安装！`);
      response.appendResponseLine(`- Trace ID: ${hookId || target}`);
      response.appendResponseLine(`- 函数: ${target}`);
      response.appendResponseLine(
        `- 断点 ID: ${breakpointInfo.breakpointId}`,
      );
      response.appendResponseLine(
        `- 位置: ${url}:${match.lineNumber + 1}:${columnNumber}`,
      );
      response.appendResponseLine(
        `- 模式: ${logStack ? '暂停 on call' : 'Log only (no pause)'}`,
      );
      response.appendResponseLine('');
      response.appendResponseLine('调用将被记录到控制台。使用 list_console_messages 查看。');
      response.appendResponseLine(
        `使用 remove_breakpoint(breakpointId: "${breakpointInfo.breakpointId}") 停止追踪。`,
      );
    } catch (error) {
      response.appendResponseLine(
        `错误: ${error instanceof Error ? error.message : String(error)}`,
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

      response.appendResponseLine('已获取调试状态:');
      response.appendResponseLine(`- 暂停状态: ${pausedState.isPaused ? '已暂停' : '未暂停'}`);
      response.appendResponseLine(`- 断点数量: ${breakpoints.length}`);
      response.appendResponseLine(`- 脚本数量: ${scripts.length}`);
      response.appendResponseLine('');
      response.appendResponseLine(`- 最后自动恢复事件: ${debuggerContext.getLastAutoRecoveryEvent() ?? '无'}`);
      response.appendResponseLine('- 调试器状态: 已启用');
    } catch {
      response.appendResponseLine('调试器尚未初始化');
      response.appendResponseLine('- 暂停状态: false');
      response.appendResponseLine('- 断点数量: 0');
      response.appendResponseLine('- 脚本数量: 0');
      response.appendResponseLine('- 最后自动恢复事件: null');
      response.appendResponseLine('- 调试器状态: 未启用');
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
        response.appendResponseLine(`未找到脚本 ${scriptId} 的源码。`);
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
        response.appendResponseLine(
          `"${query}" 未在脚本 ${scriptId} 中找到${occurrence > 1 ? ` (第 ${occurrence} 个匹配)` : ''}。`,
        );
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

      response.appendResponseLine(`在脚本 ${scriptId} 中找到 "${query}":`);
      response.appendResponseLine(`URL: ${url}`);
      response.appendResponseLine(
        `位置: 行 ${lineNumber + 1}, 列 ${columnNumber}`,
      );
      response.appendResponseLine(`字符偏移: ${position}`);
      response.appendResponseLine('');
      response.appendResponseLine('上下文:');
      response.appendResponseLine('```javascript');
      response.appendResponseLine(
        `${prefix}${beforeContext}【${matchText}】${afterContext}${suffix}`,
      );
      response.appendResponseLine('```');
      response.appendResponseLine('');
      response.appendResponseLine(
        `要在此处设置断点: set_breakpoint(url: "${url}", lineNumber: ${lineNumber + 1}, columnNumber: ${columnNumber})`,
      );
    } catch (error) {
      response.appendResponseLine(
        `错误: ${error instanceof Error ? error.message : String(error)}`,
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
        response.appendResponseLine(
          `未找到请求 ${requestId} 的发起者信息。`,
        );
        response.appendResponseLine(
          '这可能是导航请求或发起者未被捕获。',
        );
        return;
      }

      response.appendResponseLine(
        `请求 ${httpRequest.url()} 的发起者:\n`,
      );
      response.appendResponseLine(`类型: ${initiator.type}`);

      if (initiator.url) {
        response.appendResponseLine(`URL: ${initiator.url}`);
      }
      if (initiator.lineNumber !== undefined) {
        response.appendResponseLine(`行号: ${initiator.lineNumber + 1}`);
      }
      if (initiator.columnNumber !== undefined) {
        response.appendResponseLine(`列号: ${initiator.columnNumber}`);
      }

      if (initiator.stack && initiator.stack.callFrames.length > 0) {
        response.appendResponseLine('\n调用栈:');
        for (let i = 0; i < initiator.stack.callFrames.length; i++) {
          const frame = initiator.stack.callFrames[i];
          const functionName = frame.functionName || '(匿名)';
          response.appendResponseLine(
            `  ${i + 1}. ${functionName} @ ${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber}`,
          );
        }
      }

      response.appendResponseLine('\n✅ 请求发起者信息获取完成');
    } catch (error) {
      response.appendResponseLine(
        `获取发起者失败: ${error instanceof Error ? error.message : String(error)}`,
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
      const pausedState = debuggerContext.getPausedState();

      if (!pausedState.isPaused) {
        response.appendResponseLine('执行未暂停。');
        response.appendResponseLine('请先设置断点并触发它来暂停执行。');
        return;
      }

      response.appendResponseLine('🔴 执行已暂停\n');

      if (pausedState.reason) {
        response.appendResponseLine(`原因: ${pausedState.reason}`);
      }

      if (pausedState.hitBreakpoints && pausedState.hitBreakpoints.length > 0) {
        response.appendResponseLine(
          `命中断点: ${pausedState.hitBreakpoints.join(', ')}`,
        );
      }

      response.appendResponseLine('\n📍 调用栈:');

      for (let i = 0; i < pausedState.callFrames.length; i++) {
        const frame = pausedState.callFrames[i];
        const script = debuggerContext.getScriptById(frame.location.scriptId);
        const url =
          script?.url || frame.url || `script:${frame.location.scriptId}`;
        response.appendResponseLine(
          `  ${i + 1}. ${frame.functionName} @ ${url}:${frame.location.lineNumber + 1}:${frame.location.columnNumber}`,
        );
        response.appendResponseLine(`     CallFrameId: ${frame.callFrameId}`);
      }

      // 包含作用域变量
      if (request.params.includeScopes && pausedState.callFrames.length > 0) {
        response.appendResponseLine('\n🔍 作用域变量（顶层帧）:');

        const topFrame = pausedState.callFrames[0];

        for (const scope of topFrame.scopeChain) {
          // 只显示 local 和 closure 作用域，跳过 global
          if (scope.type === 'global') {
            continue;
          }

          const scopeName = scope.name || scope.type;
          response.appendResponseLine(`\n  [${scopeName}]:`);

          if (scope.object.objectId) {
            try {
              const variables = await debuggerContext.getScopeVariables(
                scope.object.objectId,
              );

              if (variables.length === 0) {
                response.appendResponseLine('    (空)');
              } else {
                for (const variable of variables.slice(0, 20)) {
                  const valueStr =
                    typeof variable.value === 'string'
                      ? `"${variable.value}"`
                      : JSON.stringify(variable.value);
                  response.appendResponseLine(
                    `    ${variable.name}: ${valueStr}`,
                  );
                }
                if (variables.length > 20) {
                  response.appendResponseLine(
                    `    ... 还有 ${variables.length - 20} 个`,
                  );
                }
              }
            } catch {
              response.appendResponseLine('    (无法获取变量)');
            }
          }
        }
      }

      response.appendResponseLine(
        '\n💡 使用 resume、step_over、step_into 或 step_out 继续。',
      );
    } catch (error) {
      response.appendResponseLine(
        `获取暂停信息失败: ${error instanceof Error ? error.message : String(error)}`,
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
        response.appendResponseLine('执行未暂停，无法执行表达式。');
        return;
      }

      if (frameIndex >= pausedState.callFrames.length) {
        response.appendResponseLine(
          `无效的帧索引 ${frameIndex}。可用帧: 0-${pausedState.callFrames.length - 1}`,
        );
        return;
      }

      const callFrameId = pausedState.callFrames[frameIndex].callFrameId;

      const result = await debuggerContext.evaluateOnCallFrame(
        callFrameId,
        expression,
        {returnByValue: true, generatePreview: true},
      );

      if (result.exceptionDetails) {
        response.appendResponseLine(`❌ 错误: ${result.exceptionDetails.text}`);
        if (result.exceptionDetails.exception) {
          response.appendResponseLine(
            `   ${result.exceptionDetails.exception.description || ''}`,
          );
        }
      } else {
        response.appendResponseLine('📝 结果:');
        if (result.result.value !== undefined) {
          const valueStr =
            typeof result.result.value === 'string'
              ? `"${result.result.value}"`
              : JSON.stringify(result.result.value, null, 2);
          response.appendResponseLine(valueStr);
        } else {
          response.appendResponseLine(
            result.result.description || `[${result.result.type}]`,
          );
        }
      }
    } catch (error) {
      response.appendResponseLine(
        `执行失败: ${error instanceof Error ? error.message : String(error)}`,
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
        response.appendResponseLine('当前未处于暂停状态');
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
            lineNumber: frame.location.lineNumber,
            locals,
            localCount: locals.length,
          };
        }),
      );

      response.appendResponseLine(
        `当前暂停栈共 ${frames.length} 帧，已读取局部变量摘要`,
      );
      response.appendResponseLine(
        `总局部变量数: ${frames.reduce((sum, f) => sum + f.localCount, 0)}\n`,
      );

      for (const frame of frames) {
        response.appendResponseLine(
          `[${frame.index}] ${frame.functionName} @ ${frame.url}:${frame.lineNumber + 1}`,
        );
        response.appendResponseLine(`  CallFrameId: ${frame.callFrameId}`);
        response.appendResponseLine(`  局部变量数: ${frame.localCount}`);
        if (frame.localCount > 0) {
          response.appendResponseLine('  变量:');
          for (const local of frame.locals.slice(0, 10)) {
            const valueStr =
              typeof local.value === 'string'
                ? `"${local.value}"`
                : JSON.stringify(local.value);
            response.appendResponseLine(`    ${local.name}: ${valueStr}`);
          }
          if (frame.localCount > 10) {
            response.appendResponseLine(`    ... 还有 ${frame.localCount - 10} 个`);
          }
        }
        response.appendResponseLine('');
      }
    } catch (error) {
      response.appendResponseLine(
        `检查局部变量失败: ${error instanceof Error ? error.message : String(error)}`,
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
        response.appendResponseLine(`"${text}" 未在任何已加载脚本中找到。`);
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
          response.appendResponseLine(
            `"${text}" 在未匹配 "${urlFilter}" 的脚本中找到。`,
          );
          return;
        }
      }

      // 获取指定的匹配项
      if (occurrence > matches.length) {
        response.appendResponseLine(
          `只有 ${matches.length} 个匹配项，但请求了第 ${occurrence} 个。`,
        );
        return;
      }

      const match = matches[occurrence - 1];
      const script = debuggerContext.getScriptById(match.scriptId);
      const url = script?.url || match.url;

      if (!url) {
        response.appendResponseLine('无法设置断点：脚本没有 URL（内联脚本）。');
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

      response.appendResponseLine(`✅ 断点设置成功！`);
      response.appendResponseLine(`- ID: ${breakpointInfo.breakpointId}`);
      response.appendResponseLine(`- URL: ${url}`);
      response.appendResponseLine(
        `- 行号: ${match.lineNumber + 1}, 列号: ${columnNumber}`,
      );
      if (condition) {
        response.appendResponseLine(`- 条件: ${condition}`);
      }
      response.appendResponseLine(`- 提示: 如果执行卡住，先运行 resume。如果总是在同一位置暂停，移除断点后改用 trace_function(pause=false) 或 hook_function。`);

      // 显示上下文
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

        response.appendResponseLine('');
        response.appendResponseLine('上下文:');
        response.appendResponseLine('```javascript');
        response.appendResponseLine(`${prefix}${preview}${suffix}`);
        response.appendResponseLine('```');
      }
    } catch (error) {
      response.appendResponseLine(
        `错误: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

/**
 * XHR 到 JS 断点转换。
 */
export const xhrToJsBreakpoint = defineTool({
  name: 'xhr_to_js_breakpoint',
  description:
    '设置 XHR 断点；命中后可结合 get_paused_info / set_breakpoint 完成 JS 断点定位。',
  annotations: {
    title: 'XHR 到 JS 断点',
    category: 'reverse_engineering' as ToolCategory,
    readOnlyHint: false,
  },
  schema: {
    url: zod
      .string()
      .optional()
      .describe('要监控的 URL 模式（部分匹配）。'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as DebuggerRuntime;
    const {url} = request.params;

    try {
      const debuggerContext = await getDebugger(runtime);
      const client = debuggerContext.getClient();

      if (!client) {
        response.appendResponseLine('Debugger 客户端不可用。');
        return;
      }

      await client.send('DOMDebugger.setXHRBreakpoint', {url});
      response.appendResponseLine(
        `✅ XHR 断点已设置: ${url || '*'}`,
      );
      response.appendResponseLine(
        '命中后可结合 get_paused_info / set_breakpoint 完成 JS 断点定位',
      );
    } catch (error) {
      response.appendResponseLine(
        `错误: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
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
    response.appendResponseLine(
      '当前工具层尚未接入 AIContinuousDebugger 运行时，请改用 pause/set_breakpoint/get_paused_info 组合',
    );
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
    response.appendResponseLine('当前没有可停止的连续调试会话');
  },
});
