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
  stepInto,
  stepOut,
  stepOver,
  traceFunction,
} from '../../../../src/tools/debugger/index.js';
import type {ToolDefinition} from '../../../../src/tools/ToolDefinition.js';
import {ToolError} from '../../../../src/utils/errors.js';

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
    getScriptSourcePath: async (_scriptId: string) => '/cache/app.js',
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
    setBreakpointByUrl: async (params: {
      url: string;
      lineNumber: number;
      columnNumber: number;
      condition?: string;
    }) => ({
      breakpointId: 'bp-1',
      location: {
        url: params.url,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
      },
      condition: params.condition,
      enabled: true,
      hitCount: 0,
      createdAt: Date.now(),
    }),
    setBreakpointByUrlRegex: async (params: {
      urlRegex: string;
      lineNumber: number;
      columnNumber: number;
      condition?: string;
    }) => ({
      breakpointId: 'bp-regex',
      location: {
        url: params.urlRegex,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
      },
      condition: params.condition,
      enabled: true,
      hitCount: 0,
      createdAt: Date.now(),
    }),
    setBreakpoint: async (params: {
      scriptId: string;
      lineNumber: number;
      columnNumber: number;
      condition?: string;
    }) => ({
      breakpointId: 'bp-script',
      location: {
        scriptId: params.scriptId,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
      },
      condition: params.condition,
      enabled: true,
      hitCount: 0,
      createdAt: Date.now(),
    }),
    removeBreakpoint: async (_breakpointId: string) => undefined,
    getBreakpoints: () => [
      {
        breakpointId: 'bp-1',
        location: {
          url: 'https://example.com/app.js',
          lineNumber: 3,
          columnNumber: 0,
        },
        condition: undefined,
        enabled: true,
        hitCount: 0,
        createdAt: Date.now(),
      },
    ],
    stepInto: async () => undefined,
    stepOver: async () => undefined,
    stepOut: async () => undefined,
    resume: async () => undefined,
    pause: async () => undefined,
    isPaused: () => true,
    getPausedState: () => ({
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
      timestamp: Date.now(),
    }),
    evaluateOnCallFrame: async (params: {
      callFrameId: string;
      expression: string;
    }) => ({
      result: {
        value: `${params.callFrameId}:${params.expression}`,
        type: 'string',
      },
    }),
    getClient: () => ({
      send: async (method: string, params?: unknown) => {
        clientCalls.push({method, params});
      },
    }),
    getLastAutoRecoveryEvent: () => ({breakpointId: 'bp-1', hitCount: 3}),
    getScopeVariablesForObjectId: async () => [],
  };

  const context = {
    getDebuggerContext: async () => debuggerContext,
    getSelectedPage: () => ({mainFrame: () => frame}),
    getPageId: () => 'page-1',
    resolvePage: (selector: {pageId?: string}) => {
      if (selector.pageId && selector.pageId !== 'page-1') {
        throw new Error(`页面 ${selector.pageId} 已关闭或不存在`);
      }
      return {page: {mainFrame: () => frame}, pageId: 'page-1', pageIdx: 0};
    },
    getSelectedFrame: () => frame,
    getNetworkRequestById: (id: number) => ({
      id,
      url: () => `https://example.com/api/${id}`,
    }),
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
  let _structuredContent: unknown = undefined;
  const response = {
    appendResponseLine: (value: string) => {
      lines.push(value);
    },
    setStructuredContent: (content: unknown) => {
      _structuredContent = content;
      lines.push(JSON.stringify(content));
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludePages: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludeNetworkRequests: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludeConsoleData: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachImage: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachNetworkRequest: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachConsoleMessage: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludeWebSocketConnections: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachWebSocket: () => {},
  };
  const request = {params};
  await tool.handler(request as never, response as never, context as never);
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
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    appendResponseLine: () => {},
    setStructuredContent: (value: unknown) => {
      content = value;
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludePages: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludeNetworkRequests: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludeConsoleData: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachImage: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachNetworkRequest: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachConsoleMessage: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludeWebSocketConnections: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachWebSocket: () => {},
  };
  const request = {params};
  await tool.handler(request as never, response as never, context as never);
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
    const filteredLines = await callTool(
      listScripts,
      {filter: 'app.js'},
      context,
    );
    const sourceLines = await callTool(
      getScriptSource,
      {scriptId: '1'},
      context,
    );
    const breakpointsLines = await callTool(listBreakpoints, {}, context);

    const scriptsText = linesToText(scriptsLines);
    const filteredText = linesToText(filteredLines);
    const sourceText = linesToText(sourceLines);
    const breakpointsText = linesToText(breakpointsLines);

    assert.match(scriptsText, /2 个脚本/);
    assert.match(filteredText, /app\.js/);
    // get_script_source 现在返回源码缓存路径与完整性字段，而非内联源码。
    assert.match(sourceText, /sourcePath/);
    assert.match(breakpointsText, /bp-1/);
  });

  it('supports searching, finding, and setting breakpoints', async () => {
    const {context} = createRuntime();

    const searchLines = await callTool(
      searchInSources,
      {
        query: 'token',
        maxResults: 1,
      },
      context,
    );
    const findLines = await callTool(
      findInScript,
      {
        scriptId: '1',
        query: 'token',
      },
      context,
    );
    const breakpointLines = await callTool(
      setBreakpoint,
      {
        url: 'https://example.com/app.js',
        lineNumber: 3,
      },
      context,
    );
    const regexBreakpointLines = await callTool(
      setBreakpoint,
      {
        url: '.*app\\.js',
        lineNumber: 3,
        isRegex: true,
      },
      context,
    );
    const removedLines = await callTool(
      removeBreakpoint,
      {
        breakpointId: 'bp-1',
      },
      context,
    );

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

  it('set_breakpoint accepts scriptId and resolves to 0-based line', async () => {
    const {context} = createRuntime();

    const scriptBreakpointLines = await callTool(
      setBreakpoint,
      {
        scriptId: '272508',
        lineNumber: 31,
      },
      context,
    );
    const scriptBreakpointText = linesToText(scriptBreakpointLines);
    const parsed = JSON.parse(scriptBreakpointText) as {
      success: boolean;
      data: {
        breakpointId: string;
        scriptId: string | null;
        url: string | null;
        lineNumber: number;
      };
    };

    assert.equal(parsed.success, true);
    assert.equal(parsed.data.breakpointId, 'bp-script');
    assert.equal(parsed.data.scriptId, '272508');
    assert.equal(parsed.data.url, null);
    // 工具层 1-based -> CDP 0-based 的转换由底层 setBreakpoint 接收。
    assert.equal(parsed.data.lineNumber, 31);
  });

  it('set_breakpoint requires url or scriptId', async () => {
    const {context} = createRuntime();

    await assert.rejects(
      () =>
        callTool(
          setBreakpoint,
          {
            lineNumber: 31,
          },
          context,
        ),
      (error: unknown) =>
        error instanceof ToolError && error.code === 'VALIDATION',
    );
  });

  it('supports pause-state, xhr, and trace operations', async () => {
    const {context, clientCalls} = createRuntime();

    const pausedInfoLines = await callTool(
      getPausedInfo,
      {includeScopes: false},
      context,
    );
    const evalLines = await callTool(
      evaluateOnCallframe,
      {
        expression: 'token',
      },
      context,
    );
    const pauseLines = await callTool(pause, {}, context);
    const resumeLines = await callTool(resume, {}, context);
    const stepIntoLines = await callTool(stepInto, {}, context);
    const stepOverLines = await callTool(stepOver, {}, context);
    const stepOutLines = await callTool(stepOut, {}, context);
    const xhrLines = await callTool(breakOnXhr, {url: '/api'}, context);
    const xhrRemoveLines = await callTool(
      removeXhrBreakpoint,
      {url: '/api'},
      context,
    );
    const initiatorLines = await callTool(
      getRequestInitiator,
      {requestId: 7},
      context,
    );

    const pausedInfoText = linesToText(pausedInfoLines);
    const evalText = linesToText(evalLines);
    const pauseText = linesToText(pauseLines);
    const resumeText = linesToText(resumeLines);
    const stepIntoText = linesToText(stepIntoLines);
    const stepOverText = linesToText(stepOverLines);
    const stepOutText = linesToText(stepOutLines);
    const xhrText = linesToText(xhrLines);
    const xhrRemoveText = linesToText(xhrRemoveLines);
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
    assert.match(initiatorText, /script/);
    assert.deepEqual(clientCalls, [
      {method: 'DOMDebugger.setXHRBreakpoint', params: {url: '/api'}},
      {method: 'DOMDebugger.removeXHRBreakpoint', params: {url: '/api'}},
    ]);
  });

  it('trace_function uses setStructuredContent for empty target validation', async () => {
    const {context} = createRuntime();
    const response = {
      appendResponseLine: () => {},
      setStructuredContent: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      setIncludePages: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      setIncludeNetworkRequests: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      setIncludeConsoleData: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      attachImage: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      attachNetworkRequest: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      attachConsoleMessage: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      setIncludeWebSocketConnections: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      attachWebSocket: () => {},
    };
    const request = {params: {target: ''}};
    await assert.rejects(
      () =>
        traceFunction.handler(
          request as never,
          response as never,
          context as never,
        ),
      (error: unknown) =>
        error instanceof ToolError && error.code === 'VALIDATION',
    );
  });

  it('trace_function uses setStructuredContent when debugger is not enabled', async () => {
    const {context} = createRuntime();

    // Override the debugger context to return isEnabled = false
    const originalGetDebuggerContext = context.getDebuggerContext;
    context.getDebuggerContext = async () => {
      const dc = await originalGetDebuggerContext();
      return {...dc, isEnabled: () => false};
    };

    const response = {
      appendResponseLine: () => {},
      setStructuredContent: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      setIncludePages: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      setIncludeNetworkRequests: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      setIncludeConsoleData: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      attachImage: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      attachNetworkRequest: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      attachConsoleMessage: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      setIncludeWebSocketConnections: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      attachWebSocket: () => {},
    };
    const request = {params: {target: 'someFunction'}};
    await assert.rejects(
      () =>
        traceFunction.handler(
          request as never,
          response as never,
          context as never,
        ),
      (error: unknown) =>
        error instanceof ToolError && error.code === 'PREREQUISITE',
    );
  });

  it('get_script_source keeps url and emits pageId in the returned locator', async () => {
    const {context} = createRuntime();

    const content = await callToolContent<{
      success: boolean;
      data: {
        scriptId: string;
        url: string | null;
        sha256: string;
        locator: {
          pageId?: string;
          url: string | null;
          sourceLength: number;
          contentHash: string;
        };
      };
    }>(getScriptSource, {scriptId: '1'}, context);

    assert.equal(content.success, true);
    assert.equal(content.data.scriptId, '1');
    assert.equal(content.data.url, 'https://example.com/app.js');
    assert.equal(content.data.locator.url, 'https://example.com/app.js');
    assert.equal(content.data.locator.pageId, 'page-1');
    assert.equal(content.data.locator.contentHash, content.data.sha256);
    assert.equal(typeof content.data.locator.sourceLength, 'number');
  });

  it('get_script_source recovers a stale scriptId via locator and reports staleScriptIdRecovered', async () => {
    const {context} = createRuntime();

    const content = await callToolContent<{
      success: boolean;
      data: {
        scriptId: string;
        staleScriptIdRecovered?: boolean;
        locator: {pageId?: string; url: string | null};
      };
    }>(
      getScriptSource,
      {
        scriptId: 'stale-1',
        locator: {url: 'https://example.com/app.js'},
      },
      context,
    );

    assert.equal(content.success, true);
    assert.equal(content.data.scriptId, '1');
    assert.equal(content.data.staleScriptIdRecovered, true);
    assert.equal(content.data.locator.pageId, 'page-1');
  });

  it('get_script_source reports ambiguity when locator matches multiple scripts', async () => {
    const {context} = createRuntime();
    const dc = await context.getDebuggerContext();
    dc.getScripts = () => [
      {scriptId: '1', url: 'https://example.com/dup.js'},
      {scriptId: '2', url: 'https://example.com/dup.js'},
    ];

    await assert.rejects(
      () =>
        callToolContent(
          getScriptSource,
          {
            locator: {url: 'https://example.com/dup.js'},
          },
          context,
        ),
      (error: unknown) =>
        error instanceof ToolError &&
        error.code === 'SCRIPT_LOCATOR_AMBIGUOUS' &&
        /定位器匹配到 2 个候选/.test(error.message),
    );
  });

  it('get_script_source reports PAGE_NOT_FOUND for a closed pageId', async () => {
    const {context} = createRuntime();

    await assert.rejects(
      () =>
        callToolContent(
          getScriptSource,
          {
            locator: {pageId: 'page-closed', url: 'https://example.com/app.js'},
          },
          context,
        ),
      (error: unknown) =>
        error instanceof ToolError &&
        error.code === 'PAGE_NOT_FOUND' &&
        /已关闭或不存在/.test(error.message),
    );
  });

  it('get_script_source keeps an empty inline URL in the locator (round-trip exact)', async () => {
    const {context} = createRuntime();
    const dc = await context.getDebuggerContext();
    dc.getScripts = () => [{scriptId: '5', url: ''}];
    dc.getScriptSource = async () => 'console.log(1);';

    const content = await callToolContent<{
      success: boolean;
      data: {url: string | null; locator: {url: string}};
    }>(getScriptSource, {scriptId: '5'}, context);

    assert.equal(content.success, true);
    // 顶层 url 字段为展示用，空字符串归一化为 null。
    assert.equal(content.data.url, null);
    // locator.url 保留原始空字符串，保证 locator 可往返精确匹配（见 Finding 2）。
    assert.equal(content.data.locator.url, '');
  });

  it('does NOT export or register stub tools startContinuousDebugging / stopContinuousDebugging', async () => {
    // Regression: these stub tools were never implemented and must not
    // appear as exports or in the generated tool registry.
    const debuggerModule =
      await import('../../../../src/tools/debugger/index.js');
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

    const {GENERATED_TOOL_REGISTRY} =
      await import('../../../../src/tools/generated-tools-index.js');
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
