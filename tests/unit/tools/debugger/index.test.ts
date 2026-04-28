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
  startContinuousDebugging,
  stepInto,
  stepOut,
  stepOver,
  stopContinuousDebugging,
  traceFunction,
  xhrToJsBreakpoint,
} from '../../../../src/tools/debugger/index.js';

function createRuntime() {
  const clientCalls: Array<{method: string; params: unknown}> = [];
  const frame = {
    evaluate: async () => ({success: true, hookId: 'hook-1'}),
  };
  const debuggerContext = {
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
        locations: [],
      },
    ],
    stepInto: async () => undefined,
    stepOver: async () => undefined,
    stepOut: async () => undefined,
    resume: async () => undefined,
    pause: async () => undefined,
    getPausedState: () => ({
      isPaused: true,
      reason: 'breakpoint',
      callFrames: [{callFrameId: 'cf-1'}],
    }),
    evaluateOnCallFrame: async (callFrameId: string, expression: string) => ({
      result: {value: `${callFrameId}:${expression}`},
    }),
    getClient: () => ({
      send: async (method: string, params?: unknown) => {
        clientCalls.push({method, params});
      },
    }),
    getLastAutoRecoveryEvent: () => ({breakpointId: 'bp-1', hitCount: 3}),
  };

  const runtime = {
    getDebuggerContext: async () => debuggerContext,
    getSelectedPage: () => ({mainFrame: () => frame}),
    getSelectedFrame: () => frame,
    getNetworkRequestById: (id: number) => ({id}),
    getRequestInitiator: (request: {id: number}) => ({
      requestId: request.id,
      type: 'script' as const,
    }),
  } as unknown as Parameters<typeof listScripts>[0];

  return {
    clientCalls,
    runtime,
  };
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
    const {runtime} = createRuntime();

    const scripts = await listScripts(runtime);
    const filtered = await listScripts(runtime, {filter: 'app.js'});
    const source = await getScriptSource(runtime, {scriptId: '1'});
    const breakpoints = await listBreakpoints(runtime);

    assert.equal(scripts.success, true);
    assert.equal(Array.isArray(scripts.data), true);
    assert.equal((scripts.data as unknown[]).length, 2);
    assert.match(filtered.message, /app\.js/);
    assert.equal(
      (source.data as {source: string}).source.includes('function test'),
      true,
    );
    assert.equal(Array.isArray(breakpoints.data), true);
  });

  it('accepts legacy scriptId argument spellings for get_script_source', async () => {
    const {runtime} = createRuntime();

    const snakeCase = await getScriptSource(runtime, {script_id: '1'});
    const flatCase = await getScriptSource(runtime, {scriptid: '1'});

    assert.equal(snakeCase.success, true);
    assert.equal(flatCase.success, true);
    assert.equal(
      (snakeCase.data as {script?: {scriptId?: string}}).script?.scriptId,
      '1',
    );
    assert.equal(
      (flatCase.data as {script?: {scriptId?: string}}).script?.scriptId,
      '1',
    );
  });

  it('resolves get_script_source by URL pattern when scriptId is omitted', async () => {
    const {runtime} = createRuntime();

    const source = await getScriptSource(runtime, {urlPattern: 'app.js'});

    assert.equal(source.success, true);
    assert.equal(
      (source.data as {script?: {scriptId?: string}}).script?.scriptId,
      '1',
    );
    assert.equal(
      (source.data as {resolution?: {mode?: string; pattern?: string}})
        .resolution?.mode,
      'urlPattern',
    );
    assert.equal(
      (source.data as {resolution?: {pattern?: string}}).resolution?.pattern,
      'app.js',
    );
  });

  it('supports searching, finding, and setting breakpoints', async () => {
    const {runtime} = createRuntime();

    const search = await searchInSources(runtime, {
      query: 'token',
      maxResults: 1,
    });
    const find = await findInScript(runtime, {scriptId: '1', query: 'token'});
    const breakpoint = await setBreakpoint(runtime, {
      url: 'https://example.com/app.js',
      lineNumber: 3,
    });
    const regexBreakpoint = await setBreakpoint(runtime, {
      url: '.*app\\.js',
      lineNumber: 3,
      isRegex: true,
    });
    const textBreakpoint = await setBreakpointOnText(runtime, {text: 'needle'});
    const removed = await removeBreakpoint(runtime, {breakpointId: 'bp-1'});

    assert.equal((search.data as {matches: unknown[]}).matches.length, 1);
    assert.equal((find.data as {matches: unknown[]}).matches.length, 4);
    assert.equal(
      (breakpoint.data as {breakpointId: string}).breakpointId,
      'bp-1',
    );
    assert.equal(
      (regexBreakpoint.data as {breakpointId: string}).breakpointId,
      'bp-regex',
    );
    assert.equal(
      (textBreakpoint.data as {match: {lineNumber: number}}).match.lineNumber,
      4,
    );
    assert.equal(removed.success, true);
  });

  it('supports pause-state, xhr, and trace operations', async () => {
    const {runtime, clientCalls} = createRuntime();

    const pausedInfo = await getPausedInfo(runtime);
    const evalResult = await evaluateOnCallframe(runtime, {
      expression: 'token',
    });
    const pauseResult = await pause(runtime);
    const resumeResult = await resume(runtime);
    const stepIntoResult = await stepInto(runtime);
    const stepOverResult = await stepOver(runtime);
    const stepOutResult = await stepOut(runtime);
    const xhrResult = await breakOnXhr(runtime, {url: '/api'});
    const xhrRemoveResult = await removeXhrBreakpoint(runtime, {url: '/api'});
    const xhrToJsResult = await xhrToJsBreakpoint(runtime, {url: '/api'});
    const traceResult = await traceFunction(runtime, {target: 'window.fetch'});
    const statusResult = await getAiDebugStatus(runtime);
    const initiatorResult = await getRequestInitiator(runtime, {requestId: 7});

    assert.equal((pausedInfo.data as {isPaused: boolean}).isPaused, true);
    assert.equal(
      (evalResult.data as {result: {value: string}}).result.value,
      'cf-1:token',
    );
    assert.equal(pauseResult.success, true);
    assert.equal(resumeResult.success, true);
    assert.equal(stepIntoResult.success, true);
    assert.equal(stepOverResult.success, true);
    assert.equal(stepOutResult.success, true);
    assert.equal(xhrResult.success, true);
    assert.equal(xhrRemoveResult.success, true);
    assert.equal(xhrToJsResult.success, true);
    assert.equal(traceResult.success, true);
    assert.equal(
      (statusResult.data as {breakpointCount: number}).breakpointCount,
      1,
    );
    assert.deepEqual(initiatorResult.data, {requestId: 7, type: 'script'});
    assert.deepEqual(clientCalls, [
      {method: 'DOMDebugger.setXHRBreakpoint', params: {url: '/api'}},
      {method: 'DOMDebugger.removeXHRBreakpoint', params: {url: '/api'}},
      {method: 'DOMDebugger.setXHRBreakpoint', params: {url: '/api'}},
    ]);
  });

  it('returns bounded context snippets for source search matches', async () => {
    const {runtime} = createRuntime();

    const search = await searchInSources(runtime, {
      query: 'token',
      maxResults: 1,
      contextLines: 1,
      maxLineLength: 24,
      urlFilter: 'app.js',
    });

    const match = (
      search.data as {
        matches: Array<{
          context?: {
            before: string[];
            line: string;
            after: string[];
            truncated: boolean;
          };
        }>;
      }
    ).matches[0];

    assert.equal(search.success, true);
    assert.deepEqual(match.context?.before, []);
    assert.equal(match.context?.line, 'const token = 1;');
    assert.deepEqual(match.context?.after, ['function test(){ return...']);
    assert.equal(match.context?.truncated, true);
  });

  it('fails explicitly for unsupported continuous debugging entrypoints', async () => {
    const {runtime} = createRuntime();

    const start = await startContinuousDebugging(runtime);
    const stop = await stopContinuousDebugging(runtime);

    assert.equal(start.success, false);
    assert.equal(stop.success, false);
  });
});
