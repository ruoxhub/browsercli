/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {selectExecutionContext} from '../../../../src/tools/debugger/contextSelector.js';
import {createExecutionContextInfo} from '../../../../src/tools/debugger/executionContexts.js';
import {
  breakOnXhr,
  evaluateOnCallframe,
  findInScript,
  getAiDebugStatus,
  getPausedInfo,
  getRequestInitiator,
  getScriptSource,
  listBreakpoints,
  listScripts,
  pause,
  removeBreakpoint,
  removeXhrBreakpoint,
  resume,
  searchInSources,
  setBreakpoint,
  setBreakpointOnText,
  stepInto,
  stepOut,
  stepOver,
  traceFunction,
  xhrToJsBreakpoint,
} from '../../../../src/tools/debugger/index.js';
import type {ToolDefinition} from '../../../../src/tools/ToolDefinition.js';

// ─── 测试辅助函数 ──────────────────────────────────────────

function createRuntime() {
  const clientCalls: Array<{method: string; params: unknown}> = [];
  const frame = {
    evaluate: async () => ({success: true, hookId: 'hook-1'}),
  };
  const debuggerContext = {
    isEnabled: () => true,
    getScripts: () => [
      {scriptId: '1', url: 'https://example.com/app.js'},
      {scriptId: '2', url: 'https://example.com/vendor.js'},
    ],
    getScriptsByUrlPattern: (pattern: string) =>
      [{scriptId: '1', url: 'https://example.com/app.js'}].filter(script =>
        script.url.includes(pattern),
      ),
    getScriptById: (scriptId: string) =>
      scriptId === '1'
        ? {scriptId: '1', url: 'https://example.com/app.js'}
        : undefined,
    getScriptSource: async () =>
      'const token = 1;\nfunction test(){ return token; }\nconst token2 = token;',
    getBeautifiedScriptSource: async (
      _scriptId: string,
      beautify: (source: string) => string,
    ) => {
      const raw =
        'const token = 1;\nfunction test(){ return token; }\nconst token2 = token;';
      return beautify(raw);
    },
    searchInScripts: async (query: string) => ({
      query,
      matches:
        query === 'needle'
          ? [
              {
                scriptId: '1',
                url: 'https://example.com/app.js',
                lineNumber: 4,
                lineContent: 'const needle = 1;',
              },
            ]
          : [
              {
                scriptId: '1',
                url: 'https://example.com/app.js',
                lineNumber: 0,
                lineContent: 'const token = 1;',
              },
            ],
    }),
    setBreakpoint: async (
      url: string,
      lineNumber: number,
      columnNumber: number,
      condition?: string,
    ) => ({
      breakpointId: 'bp-1',
      url,
      lineNumber,
      columnNumber,
      condition,
      locations: [],
    }),
    setBreakpointByUrlRegex: async (
      urlRegex: string,
      lineNumber: number,
      columnNumber: number,
      condition?: string,
    ) => ({
      breakpointId: 'bp-regex',
      url: urlRegex,
      lineNumber,
      columnNumber,
      condition,
      locations: [],
    }),
    removeBreakpoint: async (_breakpointId: string) => undefined,
    getBreakpoints: () => [
      {
        breakpointId: 'bp-1',
        url: 'https://example.com/app.js',
        lineNumber: 3,
        columnNumber: 0,
        condition: undefined,
        locations: [],
      },
    ],
    stepInto: async () => undefined,
    stepOver: async () => undefined,
    stepOut: async () => undefined,
    resume: async () => undefined,
    pause: async () => undefined,
    isPaused: () => true,
    getPausedState: () => ({
      isPaused: true,
      reason: 'breakpoint',
      hitBreakpoints: [],
      callFrames: [
        {
          callFrameId: 'cf-1',
          functionName: 'test',
          location: {scriptId: '1', lineNumber: 0, columnNumber: 0},
          url: 'https://example.com/app.js',
          scopeChain: [],
        },
      ],
    }),
    evaluateOnCallFrame: async (callFrameId: string, expression: string) => ({
      result: {value: `${callFrameId}:${expression}`, type: 'string'},
    }),
    getClient: () => ({
      send: async (method: string, params?: unknown) => {
        clientCalls.push({method, params});
      },
    }),
    getLastAutoRecoveryEvent: () => ({breakpointId: 'bp-1', hitCount: 3}),
    getScopeVariables: async () => [],
  };

  const context = {
    getDebuggerContext: async () => debuggerContext,
    getSelectedPage: () => ({mainFrame: () => frame}),
    getSelectedFrame: () => frame,
    getNetworkRequestById: (id: number) => ({id, url: () => `https://example.com/api/${id}`}),
    getRequestInitiator: (request: {id: number}) => ({
      requestId: request.id,
      type: 'script' as const,
    }),
  };

  return {
    clientCalls,
    context,
  };
}

/** 执行 defineTool 工具并返回所有输出行 */
async function callTool(
  tool: ToolDefinition,
  params: Record<string, unknown>,
  context: unknown,
): Promise<string[]> {
  const lines: string[] = [];
  let structuredContent: unknown = undefined;
  const response = {
    appendResponseLine: (value: string) => {
      lines.push(value);
    },
    setStructuredContent: (content: unknown) => {
      structuredContent = content;
      lines.push(JSON.stringify(content));
    },
    setIncludePages: () => {},
    setIncludeNetworkRequests: () => {},
    setIncludeConsoleData: () => {},
    attachImage: () => {},
    attachNetworkRequest: () => {},
    attachConsoleMessage: () => {},
    setIncludeWebSocketConnections: () => {},
    attachWebSocket: () => {},
  };
  const request = {params};
  await tool.handler(
    request as never,
    response as never,
    context as never,
  );
  return lines;
}

/** 将输出行合并为文本 */
function linesToText(lines: string[]): string {
  return lines.join('\n');
}

/** 执行 defineTool 工具并返回结构化内容对象 */
async function callToolContent<T = Record<string, unknown>>(
  tool: ToolDefinition,
  params: Record<string, unknown>,
  context: unknown,
): Promise<T> {
  let content: unknown = undefined;
  const response = {
    appendResponseLine: () => {},
    setStructuredContent: (value: unknown) => {
      content = value;
    },
    setIncludePages: () => {},
    setIncludeNetworkRequests: () => {},
    setIncludeConsoleData: () => {},
    attachImage: () => {},
    attachNetworkRequest: () => {},
    attachConsoleMessage: () => {},
    setIncludeWebSocketConnections: () => {},
    attachWebSocket: () => {},
  };
  const request = {params};
  await tool.handler(
    request as never,
    response as never,
    context as never,
  );
  return content as T;
}

describe('src/tools/debugger/index.ts', () => {
  it('classifies and selects execution contexts by world', () => {
    const pageContext = createExecutionContextInfo({
      id: 1,
      origin: 'https://example.com',
      name: '',
      auxData: {
        frameId: 'frame-1',
        type: 'default',
        isDefault: true,
      },
    });
    const contentScriptContext = createExecutionContextInfo({
      id: 2,
      origin: 'chrome-extension://abcdef/content.js',
      name: 'content-script',
      auxData: {
        frameId: 'frame-1',
        type: 'isolated',
      },
    });
    const isolatedUnnamedContext = createExecutionContextInfo({
      id: 3,
      origin: 'https://example.com',
      name: '',
      auxData: {
        frameId: 'frame-2',
        type: 'isolated',
      },
    });

    assert.equal(pageContext.world, 'page');
    assert.equal(contentScriptContext.world, 'content-script');
    assert.equal(isolatedUnnamedContext.world, 'content-script');
    assert.equal(contentScriptContext.extensionId, 'abcdef');
    assert.deepEqual(
      selectExecutionContext([pageContext, contentScriptContext], {
        context: 'page',
      }),
      pageContext,
    );
    assert.deepEqual(
      selectExecutionContext([pageContext, contentScriptContext], {
        context: 'content-script',
      }),
      contentScriptContext,
    );
    assert.equal(
      selectExecutionContext(
        [pageContext, contentScriptContext, isolatedUnnamedContext],
        {
          context: 'content-script',
          frameId: 'frame-2',
        },
      )?.id,
      3,
    );
    assert.equal(
      selectExecutionContext([pageContext, contentScriptContext], {
        context: 'content-script',
        frameId: 'frame-missing',
      }),
      null,
    );
  });

  it('returns real script and breakpoint data', async () => {
    const {context} = createRuntime();

    const scriptsLines = await callTool(listScripts, {}, context);
    const filteredLines = await callTool(listScripts, {filter: 'app.js'}, context);
    const sourceLines = await callTool(getScriptSource, {scriptId: '1'}, context);
    const breakpointsLines = await callTool(listBreakpoints, {}, context);

    const scriptsText = linesToText(scriptsLines);
    const filteredText = linesToText(filteredLines);
    const sourceText = linesToText(sourceLines);
    const breakpointsText = linesToText(breakpointsLines);

    assert.match(scriptsText, /2 个脚本/);
    assert.match(filteredText, /app\.js/);
    assert.match(sourceText, /function test/);
    assert.match(breakpointsText, /bp-1/);
  });

  it('supports searching, finding, and setting breakpoints', async () => {
    const {context} = createRuntime();

    const searchLines = await callTool(searchInSources, {
      query: 'token',
      maxResults: 1,
    }, context);
    const findLines = await callTool(findInScript, {
      scriptId: '1',
      query: 'token',
    }, context);
    const breakpointLines = await callTool(setBreakpoint, {
      url: 'https://example.com/app.js',
      lineNumber: 3,
    }, context);
    const regexBreakpointLines = await callTool(setBreakpoint, {
      url: '.*app\\.js',
      lineNumber: 3,
      isRegex: true,
    }, context);
    const removedLines = await callTool(removeBreakpoint, {
      breakpointId: 'bp-1',
    }, context);

    const searchText = linesToText(searchLines);
    const findText = linesToText(findLines);
    const breakpointText = linesToText(breakpointLines);
    const regexBreakpointText = linesToText(regexBreakpointLines);
    const removedText = linesToText(removedLines);

    assert.match(searchText, /1.*匹配.*token/);
    assert.match(findText, /token/);
    assert.match(breakpointText, /bp-1/);
    assert.match(regexBreakpointText, /bp-regex/);
    assert.match(removedText, /已移除/);
  });

  it('supports pause-state, xhr, and trace operations', async () => {
    const {context, clientCalls} = createRuntime();

    const pausedInfoLines = await callTool(getPausedInfo, {includeScopes: false}, context);
    const evalLines = await callTool(evaluateOnCallframe, {
      expression: 'token',
    }, context);
    const pauseLines = await callTool(pause, {}, context);
    const resumeLines = await callTool(resume, {}, context);
    const stepIntoLines = await callTool(stepInto, {}, context);
    const stepOverLines = await callTool(stepOver, {}, context);
    const stepOutLines = await callTool(stepOut, {}, context);
    const xhrLines = await callTool(breakOnXhr, {url: '/api'}, context);
    const xhrRemoveLines = await callTool(removeXhrBreakpoint, {url: '/api'}, context);
    const xhrToJsLines = await callTool(xhrToJsBreakpoint, {url: '/api'}, context);
    const statusLines = await callTool(getAiDebugStatus, {}, context);
    const initiatorLines = await callTool(getRequestInitiator, {requestId: 7}, context);

    const pausedInfoText = linesToText(pausedInfoLines);
    const evalText = linesToText(evalLines);
    const pauseText = linesToText(pauseLines);
    const resumeText = linesToText(resumeLines);
    const stepIntoText = linesToText(stepIntoLines);
    const stepOverText = linesToText(stepOverLines);
    const stepOutText = linesToText(stepOutLines);
    const xhrText = linesToText(xhrLines);
    const xhrRemoveText = linesToText(xhrRemoveLines);
    const xhrToJsText = linesToText(xhrToJsLines);
    const statusText = linesToText(statusLines);
    const initiatorText = linesToText(initiatorLines);

    assert.match(pausedInfoText, /已暂停/);
    assert.match(evalText, /cf-1:token/);
    assert.match(pauseText, /暂停/);
    assert.match(resumeText, /恢复/);
    assert.match(stepIntoText, /单步进入/);
    assert.match(stepOverText, /单步跳过/);
    assert.match(stepOutText, /单步跳出/);
    assert.match(xhrText, /XHR/);
    assert.match(xhrRemoveText, /XHR/);
    assert.match(xhrToJsText, /XHR/);
    assert.match(statusText, /调试状态/);
    assert.match(initiatorText, /script/);
    assert.deepEqual(clientCalls, [
      {method: 'DOMDebugger.setXHRBreakpoint', params: {url: '/api'}},
      {method: 'DOMDebugger.removeXHRBreakpoint', params: {url: '/api'}},
      {method: 'DOMDebugger.setXHRBreakpoint', params: {url: '/api'}},
    ]);
  });

  it('trace_function uses setStructuredContent for empty target validation', async () => {
    const {context} = createRuntime();
    let structuredContent: unknown = undefined;
    let appendCalled = false;
    const response = {
      appendResponseLine: () => {
        appendCalled = true;
      },
      setStructuredContent: (value: unknown) => {
        structuredContent = value;
      },
      setIncludePages: () => {},
      setIncludeNetworkRequests: () => {},
      setIncludeConsoleData: () => {},
      attachImage: () => {},
      attachNetworkRequest: () => {},
      attachConsoleMessage: () => {},
      setIncludeWebSocketConnections: () => {},
      attachWebSocket: () => {},
    };
    const request = {params: {target: ''}};
    await traceFunction.handler(
      request as never,
      response as never,
      context as never,
    );

    assert.equal(appendCalled, false, 'appendResponseLine should NOT be called');
    assert.notEqual(structuredContent, undefined, 'setStructuredContent should be called');
    const content = structuredContent as {
      success: boolean;
      tooltype: string;
      message: string;
    };
    assert.equal(content.success, false);
    assert.equal(content.tooltype, 'trace_function');
    assert.match(content.message, /target/);
  });

  it('trace_function uses setStructuredContent when debugger is not enabled', async () => {
    const {context} = createRuntime();

    // Override the debugger context to return isEnabled = false
    const originalGetDebuggerContext = context.getDebuggerContext;
    context.getDebuggerContext = async () => {
      const dc = await originalGetDebuggerContext();
      return {...dc, isEnabled: () => false};
    };

    let structuredContent: unknown = undefined;
    let appendCalled = false;
    const response = {
      appendResponseLine: () => {
        appendCalled = true;
      },
      setStructuredContent: (value: unknown) => {
        structuredContent = value;
      },
      setIncludePages: () => {},
      setIncludeNetworkRequests: () => {},
      setIncludeConsoleData: () => {},
      attachImage: () => {},
      attachNetworkRequest: () => {},
      attachConsoleMessage: () => {},
      setIncludeWebSocketConnections: () => {},
      attachWebSocket: () => {},
    };
    const request = {params: {target: 'someFunction'}};
    await traceFunction.handler(
      request as never,
      response as never,
      context as never,
    );

    assert.equal(appendCalled, false, 'appendResponseLine should NOT be called');
    assert.notEqual(structuredContent, undefined, 'setStructuredContent should be called');
    const content = structuredContent as {
      success: boolean;
      tooltype: string;
      message: string;
    };
    assert.equal(content.success, false);
    assert.equal(content.tooltype, 'trace_function');
    assert.match(content.message, /调试器未启用/);
  });

  it('getScriptSource with prettyPrint beautifies only once, not twice', async () => {
    const {PackerDeobfuscator} = await import(
      '../../../../src/modules/deobfuscator/PackerDeobfuscator.js'
    );
    const rawSource = 'var a=1;var b=2;';

    // Spy on the prototype to intercept calls from ANY instance
    // (the handler creates its own PackerDeobfuscator internally)
    let beautifyCallCount = 0;
    const originalBeautify = PackerDeobfuscator.prototype.beautify;
    PackerDeobfuscator.prototype.beautify = function (code: string) {
      beautifyCallCount++;
      return originalBeautify.call(this, code);
    };

    try {
      const {context} = createRuntime();
      const dc = await (
        context as never as {
          getDebuggerContext: () => Promise<Record<string, unknown>>;
        }
      ).getDebuggerContext();

      dc.getScriptSource = async () => rawSource;
      dc.getBeautifiedScriptSource = async (
        _scriptId: string,
        beautify: (source: string) => string,
      ) => beautify(rawSource);
      dc.getScriptById = () => ({
        scriptId: '1',
        url: 'https://example.com/app.js',
      });

      const result = await callToolContent<{
        success: boolean;
        data: {source: string};
      }>(getScriptSource, {scriptId: '1', prettyPrint: true}, context);

      assert.equal(result.success, true);
      // Core regression check: beautify must be called exactly once
      assert.equal(
        beautifyCallCount,
        1,
        `beautify should be called exactly once, but was called ${beautifyCallCount} times`,
      );
      // Verify the returned source differs from raw (beautify actually ran)
      assert.notEqual(result.data.source, rawSource);
    } finally {
      PackerDeobfuscator.prototype.beautify = originalBeautify;
    }
  });

  it('does NOT export or register stub tools startContinuousDebugging / stopContinuousDebugging', async () => {
    // Regression: these stub tools were never implemented and must not
    // appear as exports or in the generated tool registry.
    const debuggerModule = await import(
      '../../../../src/tools/debugger/index.js'
    );
    assert.equal(
      'startContinuousDebugging' in debuggerModule,
      false,
      'startContinuousDebugging must not be exported from debugger/index',
    );
    assert.equal(
      'stopContinuousDebugging' in debuggerModule,
      false,
      'stopContinuousDebugging must not be exported from debugger/index',
    );

    const {GENERATED_TOOL_REGISTRY} = await import(
      '../../../../src/tools/generated-tools-index.js'
    );
    const stubEntries = GENERATED_TOOL_REGISTRY.filter(
      entry =>
        (entry.handlerName as string) === 'startContinuousDebugging' ||
        (entry.handlerName as string) === 'stopContinuousDebugging',
    );
    assert.equal(
      stubEntries.length,
      0,
      'generated tool registry must not contain start/stopContinuousDebugging stubs',
    );
  });
});
