/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {ReverseTaskStore} from '../../../src/reverse/ReverseTaskStore.js';
import {ToolError} from '../../../src/utils/errors.js';
import {getRuntime as getJSHookRuntime} from '../../../src/runtime.js';
import {
  listScripts,
  getScriptSource,
  findInScript,
  searchInSources,
  setBreakpoint,
  removeBreakpoint,
  listBreakpoints,
  getRequestInitiator,
  getPausedInfo,
  resume,
  pause,
  stepOver,
  stepInto,
  stepOut,
  evaluateOnCallframe,
  setBreakpointOnText,
  hookFunction,
  unhookFunction,
  listHooks,
  inspectObject,
  getStorage,
  breakOnXhr,
  removeXhrBreakpoint,
  monitorEvents,
  stopMonitor,
  traceFunction,
} from '../../../src/tools/debugger/index.js';
import {listFrames, selectFrame} from '../../../src/tools/frames/index.js';

interface DebuggerResponseHarness {
  lines: string[];
  structuredContents: unknown[];
  appendResponseLine(value: string): void;
  setStructuredContent(content: unknown): void;
  setIncludePages(value: boolean): void;
  setIncludeNetworkRequests(value: boolean): void;
  setIncludeConsoleData(value: boolean): void;
  attachImage(value: unknown): void;
  attachNetworkRequest(id: number): void;
  attachConsoleMessage(id: number): void;
  setIncludeWebSocketConnections(value: boolean): void;
  attachWebSocket(id: number): void;
}

interface ScriptHarness {
  scriptId: string;
  url?: string;
  sourceMapURL?: string;
}

interface BreakpointHarness {
  breakpointId: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  condition?: string;
  locations: unknown[];
}

interface DebuggerContextHarness {
  isEnabled(): boolean;
  getScripts(): ScriptHarness[];
  getScriptsByUrlPattern(pattern: string): ScriptHarness[];
  getScriptSource(scriptId: string): Promise<string>;
  getScriptSourcePath(scriptId: string): Promise<string | null>;
  getScriptById(scriptId: string): ScriptHarness | undefined;
  searchInScripts(
    query: string,
    options?: unknown,
  ): Promise<{
    matches: Array<{
      scriptId: string;
      url?: string;
      lineNumber: number;
      lineContent: string;
    }>;
  }>;
  setBreakpoint(
    params: unknown,
    lineNumber?: number,
    columnNumber?: number,
    condition?: string,
  ): Promise<BreakpointHarness | {breakpointId: string; locations?: unknown[]}>;
  setBreakpointByUrl?(
    params: unknown,
    lineNumber?: number,
    columnNumber?: number,
    condition?: string,
  ): Promise<BreakpointHarness | {breakpointId: string; location?: unknown; locations?: unknown[]}>;
  setBreakpointByUrlRegex(
    params: unknown,
    lineNumber?: number,
    columnNumber?: number,
    condition?: string,
  ): Promise<BreakpointHarness | {breakpointId: string; locations?: unknown[]}>;
  removeBreakpoint(breakpointId: string): Promise<void>;
  getBreakpoints(): Array<{
    breakpointId: string;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
    condition?: string;
    locations?: unknown[];
  }>;
  getPausedState(): {
    isPaused?: boolean;
    reason?: string;
    hitBreakpoints?: string[];
    timestamp?: number;
    callFrames: Array<{
      functionName?: string;
      url?: string;
      callFrameId: string;
      location: {scriptId: string; lineNumber: number; columnNumber: number};
      scopeChain?: Array<{
        type: string;
        name?: string;
        object?: {objectId?: string};
      }>;
    }>;
  } | null;
  isPaused(): boolean;
  resume(): Promise<void>;
  pause(): Promise<void>;
  waitForPaused(timeout?: number): Promise<{
    callFrames: unknown[];
    reason: string;
    timestamp: number;
  }>;
  stepOver(): Promise<void>;
  stepInto(): Promise<void>;
  stepOut(): Promise<void>;
  evaluateOnCallFrame(
    callFrameId: string,
    expression: string,
  ): Promise<{result?: {value?: unknown}; exceptionDetails?: unknown}>;
  getScopeVariables(
    objectId: string,
    maxDepth?: number,
  ): Promise<Array<{name: string; value: unknown}>>;
  getClient(): {
    send(method: string, params?: unknown): Promise<unknown>;
  } | null;
  getLastAutoRecoveryEvent?(): {
    breakpointId: string;
    hitCount: number;
    timestamp: number;
  } | null;
}

interface ToolContextHarness {
  getSelectedPage(): {
    evaluate(...args: unknown[]): Promise<unknown>;
    frames?(): unknown[];
    mainFrame?(): unknown;
  };
  getSelectedFrame?(): {evaluate(...args: unknown[]): Promise<unknown>};
  getPageId?(page?: unknown): string;
  selectFrame?(frame: unknown): void;
  resetSelectedFrame?(): void;
  getNetworkRequestById(): {url(): string};
  getRequestInitiator(): unknown;
  debuggerContext: DebuggerContextHarness;
  getDebuggerContext(): DebuggerContextHarness;
}

function makeResponse(): DebuggerResponseHarness {
  const lines: string[] = [];
  const structuredContents: unknown[] = [];
  return {
    lines,
    structuredContents,
    appendResponseLine: (v: string) => lines.push(v),
    setStructuredContent: (c: unknown) => {
      structuredContents.push(c);
      if (
        c &&
        typeof c === 'object' &&
        'message' in c &&
        typeof (c as {message?: unknown}).message === 'string'
      ) {
        lines.push((c as {message: string}).message);
      }
    },
    setIncludePages: () => undefined,
    setIncludeNetworkRequests: () => undefined,
    setIncludeConsoleData: () => undefined,
    attachImage: () => undefined,
    attachNetworkRequest: () => undefined,
    attachConsoleMessage: () => undefined,
    setIncludeWebSocketConnections: () => undefined,
    attachWebSocket: () => undefined,
  };
}

function makeContext(
  overrides: Partial<ToolContextHarness> = {},
): ToolContextHarness {
  const page = {
    evaluate: async () => ({}),
    context: () => ({cookies: async () => []}),
    url: () => 'https://example.com',
  };

  const debuggerContext = {
    isEnabled: () => true,
    getScripts: () => [],
    getScriptsByUrlPattern: () => [],
    getScriptSource: async () => '',
    getScriptSourcePath: async () => '/tmp/proxycli-scripts/test.js',
    getScriptById: () => ({
      scriptId: '1',
      url: 'https://a.js',
      sourceMapURL: 'https://a.js.map',
    }),
    searchInScripts: async () => ({matches: []}),
    setBreakpoint: async () => ({
      breakpointId: 'bp1',
      locations: [{lineNumber: 1}],
    }),
    setBreakpointByUrl: async () => ({
      breakpointId: 'bp1',
      location: {url: 'https://a.js', lineNumber: 1, columnNumber: 0},
      locations: [{lineNumber: 1}],
    }),
    setBreakpointByUrlRegex: async () => ({breakpointId: 'bp2', locations: []}),
    removeBreakpoint: async () => undefined,
    getBreakpoints: () => [],
    getPausedState: () => ({isPaused: false, callFrames: []}),
    isPaused: () => false,
    resume: async () => undefined,
    pause: async () => undefined,
    waitForPaused: async () => ({
      callFrames: [],
      reason: 'debugCommand',
      timestamp: Date.now(),
    }),
    stepOver: async () => undefined,
    stepInto: async () => undefined,
    stepOut: async () => undefined,
    evaluateOnCallFrame: async () => ({result: {value: 1}}),
    getScopeVariables: async () => [],
    getClient: () => ({send: async () => undefined}),
  };

  const effectiveDebuggerContext =
    overrides.debuggerContext ?? debuggerContext;

  return {
    getSelectedPage: () => page,
    getSelectedFrame: () => page,
    getPageId: () => 'page-1',
    selectFrame: () => undefined,
    resetSelectedFrame: () => undefined,
    getNetworkRequestById: () => ({url: () => 'https://api.example.com'}),
    getRequestInitiator: () => undefined,
    debuggerContext: effectiveDebuggerContext,
    getDebuggerContext: () => effectiveDebuggerContext,
    ...overrides,
  };
}

describe('debugger tools extended', () => {
  it('pause waits until the debugger reports a paused state', async () => {
    const response = makeResponse();
    const calls: string[] = [];
    const context = makeContext();
    context.debuggerContext.pause = async () => {
      calls.push('pause');
    };
    context.debuggerContext.waitForPaused = async () => {
      calls.push('waitForPaused');
      return {
        callFrames: [],
        reason: 'debugCommand',
        timestamp: Date.now(),
      };
    };

    await pause.handler(
      {params: {}},
      response as unknown as Parameters<typeof pause.handler>[1],
      context as unknown as Parameters<typeof pause.handler>[2],
    );

    assert.deepStrictEqual(calls, ['pause', 'waitForPaused']);
    assert.deepStrictEqual(response.structuredContents.at(-1), {
      success: true,
      message: '执行已暂停',
      tooltype: 'pause',
      data: {action: 'pause', reason: 'debugCommand'},
    });
  });

  it('pause reports a pending request when the page stays idle', async () => {
    const response = makeResponse();
    const context = makeContext();
    context.debuggerContext.waitForPaused = async () => {
      throw new Error('Timeout waiting for paused event');
    };
    context.debuggerContext.getPausedState = () => null;

    await pause.handler(
      {params: {}},
      response as unknown as Parameters<typeof pause.handler>[1],
      context as unknown as Parameters<typeof pause.handler>[2],
    );

    const last = response.structuredContents.at(-1) as {
      success: boolean;
      message: string;
      tooltype: string;
      data: {action: string; pending?: boolean};
    };
    assert.equal(last.success, true);
    assert.match(last.message, /空闲/);
    assert.match(last.message, /resume/);
    assert.deepStrictEqual(last.data, {action: 'pause', pending: true});
  });

  it('pause succeeds via paused state that lands right after timeout', async () => {
    const response = makeResponse();
    const context = makeContext();
    context.debuggerContext.waitForPaused = async () => {
      throw new Error('Timeout waiting for paused event');
    };
    context.debuggerContext.getPausedState = () => ({
      callFrames: [],
      reason: 'other',
      timestamp: Date.now(),
    });

    await pause.handler(
      {params: {}},
      response as unknown as Parameters<typeof pause.handler>[1],
      context as unknown as Parameters<typeof pause.handler>[2],
    );

    assert.deepStrictEqual(response.structuredContents.at(-1), {
      success: true,
      message: '执行已暂停',
      tooltype: 'pause',
      data: {action: 'pause', reason: 'other'},
    });
  });

  it('covers script listing and source operations', async () => {
    const response = makeResponse();
    const _runtime = getJSHookRuntime();
    const context = makeContext();
    context.debuggerContext.getScripts = () => [
      {scriptId: '1', url: 'https://a.js'},
      {scriptId: '2', url: 'https://b.js'},
    ];
    context.debuggerContext.getScriptsByUrlPattern = () => [
      {scriptId: '2', url: 'https://b.js'},
    ];
    context.debuggerContext.getScriptSourcePath = async () =>
      '/tmp/proxycli-scripts/test.js';

    await listScripts.handler(
      {params: {}},
      response as unknown as Parameters<typeof listScripts.handler>[1],
      context as unknown as Parameters<typeof listScripts.handler>[2],
    );
    await listScripts.handler(
      {params: {filter: 'b'}},
      response as unknown as Parameters<typeof listScripts.handler>[1],
      context as unknown as Parameters<typeof listScripts.handler>[2],
    );
    await getScriptSource.handler(
      {params: {scriptId: '2'}},
      response as unknown as Parameters<typeof getScriptSource.handler>[1],
      context as unknown as Parameters<typeof getScriptSource.handler>[2],
    );

    assert.ok(
      response.lines.some(
        x => x.includes('Found') || x.includes('找到') || x.includes('个脚本'),
      ),
    );
    assert.ok(response.lines.some(x => x.includes('sourcePath')));
  });

  it('covers find/search/source negative and formatting paths', async () => {
    const response = makeResponse();
    const _runtime = getJSHookRuntime();
    const context = makeContext();
    context.debuggerContext.getScriptSource = async () => 'abc\ndef\nabc';
    context.debuggerContext.searchInScripts = async () => ({
      matches: [
        {
          scriptId: '1',
          url: 'https://a.js',
          lineNumber: 1,
          lineContent: 'const token = "abc";',
        },
        {
          scriptId: '2',
          url: 'https://m.js',
          lineNumber: 10,
          lineContent: 'x'.repeat(12000),
        },
      ],
    });

    await findInScript.handler(
      {
        params: {
          scriptId: '1',
          query: 'abc',
          contextChars: 3,
          occurrence: 2,
          caseSensitive: true,
        },
      },
      response as unknown as Parameters<typeof findInScript.handler>[1],
      context as unknown as Parameters<typeof findInScript.handler>[2],
    );
    await assert.rejects(
      () =>
        findInScript.handler(
          {
            params: {
              scriptId: '1',
              query: 'zzz',
              contextChars: 3,
              occurrence: 1,
              caseSensitive: true,
            },
          },
          response as unknown as Parameters<typeof findInScript.handler>[1],
          context as unknown as Parameters<typeof findInScript.handler>[2],
        ),
      (err: unknown) => err instanceof ToolError && err.code === 'NOT_FOUND',
    );
    await searchInSources.handler(
      {
        params: {
          query: 'token',
          caseSensitive: false,
          isRegex: false,
          maxResults: 1,
          excludeMinified: true,
          urlFilter: 'a.js',
        },
      },
      response as unknown as Parameters<typeof searchInSources.handler>[1],
      context as unknown as Parameters<typeof searchInSources.handler>[2],
    );

    assert.ok(response.lines.some(x => x.includes('Found "abc"') || x.includes('找到 "abc"')));
    assert.ok(
      response.lines.some(x => x.includes('Tip: Use get_script_source') || x.includes('get_script_source')),
    );
  });

  it('covers breakpoint management and initiator rendering', async () => {
    const response = makeResponse();
    const _runtime = getJSHookRuntime();
    const context = makeContext();
    context.debuggerContext.getBreakpoints = () => [
      {
        breakpointId: 'bp-1',
        url: 'https://a.js',
        lineNumber: 2,
        columnNumber: 0,
        condition: 'x>1',
        locations: [{x: 1}],
      },
    ];
    context.getRequestInitiator = () => ({
      type: 'script',
      url: 'https://a.js',
      lineNumber: 4,
      columnNumber: 2,
      stack: {
        callFrames: [
          {
            functionName: 'fn',
            scriptId: '1',
            url: 'https://a.js',
            lineNumber: 1,
            columnNumber: 1,
          },
        ],
        parent: {
          callFrames: [
            {
              functionName: 'parent',
              scriptId: '1',
              url: 'https://p.js',
              lineNumber: 1,
              columnNumber: 1,
            },
          ],
        },
      },
    });

    await setBreakpoint.handler(
      {params: {url: 'a.js', lineNumber: 3, columnNumber: 0, isRegex: false}},
      response as unknown as Parameters<typeof setBreakpoint.handler>[1],
      context as unknown as Parameters<typeof setBreakpoint.handler>[2],
    );
    await setBreakpoint.handler(
      {params: {url: '.*a.js', lineNumber: 3, columnNumber: 0, isRegex: true}},
      response as unknown as Parameters<typeof setBreakpoint.handler>[1],
      context as unknown as Parameters<typeof setBreakpoint.handler>[2],
    );
    await listBreakpoints.handler(
      {params: {}},
      response as unknown as Parameters<typeof listBreakpoints.handler>[1],
      context as unknown as Parameters<typeof listBreakpoints.handler>[2],
    );
    await removeBreakpoint.handler(
      {params: {breakpointId: 'bp-1'}},
      response as unknown as Parameters<typeof removeBreakpoint.handler>[1],
      context as unknown as Parameters<typeof removeBreakpoint.handler>[2],
    );
    await getRequestInitiator.handler(
      {params: {requestId: 1}},
      response as unknown as Parameters<typeof getRequestInitiator.handler>[1],
      context as unknown as Parameters<typeof getRequestInitiator.handler>[2],
    );

    assert.ok(
      response.lines.some(
        x =>
          x.includes('Breakpoint set successfully') ||
          x.includes('断点已设置'),
      ),
    );
    assert.ok(
      response.lines.some(
        x =>
          x.includes('Active breakpoints') ||
          x.includes('活跃断点'),
      ),
    );
    assert.ok(
      response.lines.some(
        x => x.includes('Initiator') || x.includes('发起者'),
      ),
    );
  });

  it('covers paused state commands and evaluation branches', async () => {
    const response = makeResponse();
    const _runtime = getJSHookRuntime();
    const context = makeContext();
    context.debuggerContext.getPausedState = () => ({
      isPaused: true,
      reason: 'breakpoint',
      hitBreakpoints: ['bp1'],
      callFrames: [
        {
          functionName: 'fn',
          url: 'https://a.js',
          callFrameId: 'cf-1',
          location: {scriptId: '1', lineNumber: 1, columnNumber: 1},
          scopeChain: [
            {type: 'local', name: 'local', object: {objectId: 'obj-1'}},
          ],
        },
      ],
    });
    context.debuggerContext.isPaused = () => true;
    context.debuggerContext.getScopeVariables = async () => [
      {name: 'x', value: 1},
    ];
    context.debuggerContext.evaluateOnCallFrame = async () => ({
      result: {value: {ok: true}},
    });
    context.debuggerContext.getLastAutoRecoveryEvent = () => ({
      breakpointId: 'bp1',
      hitCount: 3,
      timestamp: Date.now(),
    });

    await getPausedInfo.handler(
      {params: {includeScopes: true}},
      response as unknown as Parameters<typeof getPausedInfo.handler>[1],
      context as unknown as Parameters<typeof getPausedInfo.handler>[2],
    );
    await evaluateOnCallframe.handler(
      {params: {expression: 'x', frameIndex: 0}},
      response as unknown as Parameters<typeof evaluateOnCallframe.handler>[1],
      context as unknown as Parameters<typeof evaluateOnCallframe.handler>[2],
    );
    await resume.handler(
      {params: {}},
      response as unknown as Parameters<typeof resume.handler>[1],
      context as unknown as Parameters<typeof resume.handler>[2],
    );
    await stepOver.handler(
      {params: {}},
      response as unknown as Parameters<typeof stepOver.handler>[1],
      context as unknown as Parameters<typeof stepOver.handler>[2],
    );
    await stepInto.handler(
      {params: {}},
      response as unknown as Parameters<typeof stepInto.handler>[1],
      context as unknown as Parameters<typeof stepInto.handler>[2],
    );
    await stepOut.handler(
      {params: {}},
      response as unknown as Parameters<typeof stepOut.handler>[1],
      context as unknown as Parameters<typeof stepOut.handler>[2],
    );

    context.debuggerContext.isPaused = () => false;
    await pause.handler(
      {params: {}},
      response as unknown as Parameters<typeof pause.handler>[1],
      context as unknown as Parameters<typeof pause.handler>[2],
    );

    assert.ok(response.lines.some(x => x.includes('Execution Paused') || x.includes('已暂停')));
    assert.ok(response.lines.some(x => x.includes('执行成功') || x.includes('Result')));
    assert.ok(response.lines.some(x => x.includes('单步跳过') || x.includes('stepOver')));
    assert.ok(response.lines.some(x => x.includes('已恢复') || x.includes('resumed')));
  });

  it('covers set breakpoint on text and tracing workflows', async () => {
    const response = makeResponse();
    const _runtime = getJSHookRuntime();
    const context = makeContext();
    context.debuggerContext.searchInScripts = async (q: string) => {
      if (q.includes('function targetFn')) {
        return {
          matches: [
            {
              scriptId: '1',
              url: 'https://a.js',
              lineNumber: 0,
              lineContent: 'function targetFn(a){return a;}',
            },
          ],
        };
      }
      if (q === 'targetFn') {
        return {
          matches: [
            {
              scriptId: '1',
              url: 'https://a.js',
              lineNumber: 0,
              lineContent: 'function targetFn(a){return a;}',
            },
          ],
        };
      }
      return {matches: []};
    };
    context.debuggerContext.getScriptSource = async () =>
      'function targetFn(a){return a;}';
    context.debuggerContext.setBreakpoint = async () => ({
      breakpointId: 'trace-bp',
      locations: [{}],
    });

    await setBreakpointOnText.handler(
      {params: {text: 'targetFn', occurrence: 1, condition: 'a>0'}},
      response as unknown as Parameters<typeof setBreakpointOnText.handler>[1],
      context as unknown as Parameters<typeof setBreakpointOnText.handler>[2],
    );
    await traceFunction.handler(
      {
        params: {
          target: 'targetFn',
          logArgs: true,
        },
      },
      response as unknown as Parameters<typeof traceFunction.handler>[1],
      context as unknown as Parameters<typeof traceFunction.handler>[2],
    );

    assert.ok(
      response.lines.some(
        x => x.includes('Breakpoint set successfully') || x.includes('断点设置成功'),
      ),
    );
    assert.ok(
      response.lines.some(
        x => x.includes('Function trace installed') || x.includes('函数追踪已安装'),
      ),
    );
  });

  it('records debugger fallback evidence into reverse task artifacts', async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), 'js-reverse-debugger-evidence-'),
    );
    const runtime = getJSHookRuntime();
    const originalStore = runtime.reverseTaskStore;
    runtime.reverseTaskStore = new ReverseTaskStore({rootDir});

    try {
      const response = makeResponse();
      const context = makeContext({
        getSelectedPage: () => ({
          evaluate: async () => undefined,
          frames: () => [],
          mainFrame: () => undefined,
        }),
        getSelectedFrame: () => ({
          evaluate: async () => ({
            success: true,
            monitorId: 'm-evidence',
            eventCount: 1,
          }),
        }),
        getRequestInitiator: () => ({
          type: 'script',
          url: 'https://a.js',
          lineNumber: 4,
          columnNumber: 2,
          stack: {
            callFrames: [
              {
                functionName: 'fn',
                scriptId: '1',
                url: 'https://a.js',
                lineNumber: 1,
                columnNumber: 1,
              },
            ],
          },
        }),
      });
      context.debuggerContext.searchInScripts = async () => ({
        matches: [
          {
            scriptId: '1',
            url: 'https://a.js',
            lineNumber: 0,
            lineContent: 'function targetFn(a){return a;}',
          },
        ],
      });
      context.debuggerContext.getScriptSource = async () =>
        'function targetFn(a){return a;}';
      context.debuggerContext.setBreakpoint = async () => ({
        breakpointId: 'trace-bp',
        locations: [{}],
      });
      context.debuggerContext.setBreakpointByUrl = async () => ({
        breakpointId: 'trace-bp',
        locations: [{}],
      });

      const taskParams = {
        taskId: 'task-debugger-evidence',
        taskSlug: 'debugger-evidence',
        targetUrl: 'https://example.com',
        goal: 'capture fallback evidence',
      };

      await runtime.reverseTaskStore.openTask({
        taskId: 'task-debugger-evidence',
        slug: 'debugger-evidence',
        targetUrl: 'https://example.com',
        goal: 'capture fallback evidence',
      });

      await getRequestInitiator.handler(
        {params: {requestId: 1, ...taskParams}} as unknown as Parameters<
          typeof getRequestInitiator.handler
        >[0],
        response as unknown as Parameters<
          typeof getRequestInitiator.handler
        >[1],
        context as unknown as Parameters<typeof getRequestInitiator.handler>[2],
      );
      await monitorEvents.handler(
        {
          params: {
            selector: 'window',
            events: ['click'],
            monitorId: 'm-evidence',
            ...taskParams,
          },
        } as unknown as Parameters<typeof monitorEvents.handler>[0],
        response as unknown as Parameters<typeof monitorEvents.handler>[1],
        context as unknown as Parameters<typeof monitorEvents.handler>[2],
      );
      await traceFunction.handler(
        {
          params: {
            target: 'targetFn',
            pause: false,
            logArgs: true,
            logThis: false,
            ...taskParams,
          },
        } as unknown as Parameters<typeof traceFunction.handler>[0],
        response as unknown as Parameters<typeof traceFunction.handler>[1],
        context as unknown as Parameters<typeof traceFunction.handler>[2],
      );

      const evidenceLog = (
        await readFile(
          path.join(
            rootDir,
            'task-debugger-evidence',
            'runtime-evidence.jsonl',
          ),
          'utf8',
        )
      )
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as Record<string, unknown>);

      assert.ok(
        evidenceLog.some(entry => entry.tool === 'get_request_initiator'),
      );
      assert.ok(evidenceLog.some(entry => entry.tool === 'monitor_events'));
      assert.ok(evidenceLog.some(entry => entry.tool === 'trace_function'));
    } finally {
      runtime.reverseTaskStore = originalStore;
      await rm(rootDir, {recursive: true, force: true});
    }
  });

  it('covers page-eval tools: hook/list/unhook/inspect/storage/monitor', async () => {
    const response = makeResponse();
    const _runtime = getJSHookRuntime();
    let evalCount = 0;
    let pageEvalCount = 0;
    let frameEvalCount = 0;
    const frame = {
      evaluate: async () => {
        frameEvalCount += 1;
        switch (frameEvalCount) {
          case 1:
            return {hookId: 'h1'};
          case 2:
            return {hookId: 'h2'};
          case 3:
            return [{id: 'h1', target: 'Window.fetch'}];
          case 4:
            return {};
          case 5:
            return {type: 'object', constructor: 'Object', value: {a: 1}};
          case 6:
            return {localStorage: {token: 'x'}};
          case 7:
            return {monitorId: 'm1', eventCount: 2};
          case 8:
            return {};
          default:
            return {};
        }
      },
    };
    const context = makeContext({
      getSelectedPage: () => ({
        frames: () => [frame],
        mainFrame: () => frame,
        evaluate: async () => {
          pageEvalCount += 1;
          evalCount += 1;
          switch (evalCount) {
            case 1:
              return {hookId: 'h1'};
            case 2:
              return {hookId: 'h2'};
            case 3:
              return [{id: 'h1', target: 'Window.fetch'}];
            case 4:
              return {};
            case 5:
              return {type: 'object', constructor: 'Object', value: {a: 1}};
            case 6:
              return {localStorage: {token: 'x'}};
            case 7:
              return {monitorId: 'm1', eventCount: 2};
            case 8:
              return {};
            default:
              return {};
          }
        },
      }),
      getSelectedFrame: () => frame,
    });

    await hookFunction.handler(
      {
        params: {
          target: 'window.fetch',
          logArgs: true,
          logResult: true,
          logStack: false,
        },
      },
      response as unknown as Parameters<typeof hookFunction.handler>[1],
      context as unknown as Parameters<typeof hookFunction.handler>[2],
    );
    await hookFunction.handler(
      {
        params: {
          target: 'console.log',
        },
      },
      response as unknown as Parameters<typeof hookFunction.handler>[1],
      context as unknown as Parameters<typeof hookFunction.handler>[2],
    );
    await listHooks.handler(
      {params: {}},
      response as unknown as Parameters<typeof listHooks.handler>[1],
      context as unknown as Parameters<typeof listHooks.handler>[2],
    );
    await unhookFunction.handler(
      {params: {hookId: 'h1'}},
      response as unknown as Parameters<typeof unhookFunction.handler>[1],
      context as unknown as Parameters<typeof unhookFunction.handler>[2],
    );
    await inspectObject.handler(
      {
        params: {
          expression: 'window',
          depth: 1,
          showMethods: true,
          showPrototype: true,
        },
      },
      response as unknown as Parameters<typeof inspectObject.handler>[1],
      context as unknown as Parameters<typeof inspectObject.handler>[2],
    );
    await getStorage.handler(
      {params: {type: 'all', filter: 'tok'}},
      response as unknown as Parameters<typeof getStorage.handler>[1],
      context as unknown as Parameters<typeof getStorage.handler>[2],
    );
    await monitorEvents.handler(
      {
        params: {
          selector: 'window',
          events: ['click', 'keydown'],
          monitorId: 'm1',
        },
      },
      response as unknown as Parameters<typeof monitorEvents.handler>[1],
      context as unknown as Parameters<typeof monitorEvents.handler>[2],
    );
    await stopMonitor.handler(
      {params: {monitorId: 'm1'}},
      response as unknown as Parameters<typeof stopMonitor.handler>[1],
      context as unknown as Parameters<typeof stopMonitor.handler>[2],
    );

    assert.ok(
      response.lines.some(
        x =>
          x.includes('Hook installed successfully') ||
          x.includes('Hook 已安装'),
      ),
    );
    assert.ok(
      response.lines.some(
        x =>
          x.includes('Active hooks') ||
          x.includes('活跃 Hook') ||
          x.includes('已安装'),
      ),
    );
    assert.ok(
      response.lines.some(
        x => x.includes('Storage data') || x.includes('存储数据'),
      ),
    );
    assert.ok(
      response.lines.some(
        x =>
          x.includes('Event monitor started') ||
          x.includes('事件监控已启动'),
      ),
    );
    assert.ok(
      response.lines.some(
        x => x.includes('Monitor "m1" stopped') || x.includes('已停止'),
      ),
    );
    assert.strictEqual(pageEvalCount, 0);
    assert.strictEqual(frameEvalCount, 7);
  });

  it('lists frames and switches execution context', async () => {
    const response = makeResponse();
    const _runtime = getJSHookRuntime();
    const selectedCalls: unknown[] = [];
    let resetCount = 0;
    const mainFrame = {
      url: () => 'https://root.example.com',
      name: () => '',
      parentFrame: () => null,
      evaluate: async () => undefined,
    };
    const childFrame = {
      url: () => 'https://child.example.com',
      name: () => 'auth-frame',
      parentFrame: () => mainFrame,
      evaluate: async () => undefined,
    };
    const page = {
      evaluate: async () => undefined,
      frames: () => [mainFrame, childFrame],
      mainFrame: () => mainFrame,
    };
    const context = makeContext({
      getSelectedPage: () => page,
      getSelectedFrame: () => childFrame,
      selectFrame: frame => {
        selectedCalls.push(frame);
      },
      resetSelectedFrame: () => {
        resetCount += 1;
      },
    });

    await listFrames.handler(
      {params: {}},
      response as unknown as Parameters<typeof listFrames.handler>[1],
      context as unknown as Parameters<typeof listFrames.handler>[2],
    );
    await selectFrame.handler(
      {params: {frameIdx: 1}},
      response as unknown as Parameters<typeof selectFrame.handler>[1],
      context as unknown as Parameters<typeof selectFrame.handler>[2],
    );
    await selectFrame.handler(
      {params: {frameIdx: 0}},
      response as unknown as Parameters<typeof selectFrame.handler>[1],
      context as unknown as Parameters<typeof selectFrame.handler>[2],
    );

    assert.ok(response.lines.some(line => line.includes('Frames (2 total)')));
    const listData = (response.structuredContents[0] as {data: {frameInfos: Array<{url: string; name?: string; selected: boolean}>}}).data;
    assert.equal(listData.frameInfos[0].url, 'https://root.example.com');
    assert.equal(listData.frameInfos[1].name, 'auth-frame');
    assert.equal(listData.frameInfos[1].selected, true);
    assert.ok(
      response.lines.some(line =>
        line.includes(
          'Switched to frame 1: https://child.example.com (name: "auth-frame")',
        ),
      ),
    );
    assert.ok(
      response.lines.some(line => line.includes('Switched to main frame.')),
    );
    assert.deepStrictEqual(selectedCalls, [childFrame]);
    assert.strictEqual(resetCount, 1);
  });

  it('covers XHR breakpoint helpers', async () => {
    const response = makeResponse();
    const _runtime = getJSHookRuntime();
    const context = makeContext();
    await breakOnXhr.handler(
      {params: {url: '/api'}},
      response as unknown as Parameters<typeof breakOnXhr.handler>[1],
      context as unknown as Parameters<typeof breakOnXhr.handler>[2],
    );
    await removeXhrBreakpoint.handler(
      {params: {url: '/api'}},
      response as unknown as Parameters<typeof removeXhrBreakpoint.handler>[1],
      context as unknown as Parameters<typeof removeXhrBreakpoint.handler>[2],
    );
    assert.ok(
      response.lines.some(x => x.includes('XHR') && (x.includes('已设置') || x.includes('set'))),
    );
    assert.ok(
      response.lines.some(x => x.includes('XHR') && (x.includes('已移除') || x.includes('removed'))),
    );
  });

  it('covers xhr_to_js_breakpoint two-phase workflow', async () => {
    const {xhrToJsBreakpoint} =
      await import('../../../src/tools/debugger/index.js');
    const response = makeResponse();
    const _runtime = getJSHookRuntime();

    let xhrBreakpointSet = false;
    let xhrBreakpointRemoved = false;
    let jsBreakpointSet = false;
    let resumeCalled = false;

    const context = makeContext({
      debuggerContext: {
        isEnabled: () => true,
        getScripts: () => [],
        getScriptsByUrlPattern: () => [],
        getScriptSource: async () => '',
        getScriptSourcePath: async () => '/tmp/proxycli-scripts/test.js',
        getScriptById: () => ({scriptId: '1', url: 'https://app.js'}),
        searchInScripts: async () => ({matches: []}),
        setBreakpoint: async () => {
          jsBreakpointSet = true;
          return {breakpointId: 'js-bp-1', locations: []};
        },
        setBreakpointByUrl: async () => {
          jsBreakpointSet = true;
          return {breakpointId: 'js-bp-1', locations: []};
        },
        setBreakpointByUrlRegex: async () => ({
          breakpointId: 'bp-regex',
          locations: [],
        }),
        removeBreakpoint: async () => undefined,
        getBreakpoints: () => [],
        getPausedState: () => ({
          isPaused: true,
          callFrames: [
            {
              functionName: 'fetchData',
              url: 'https://app.js',
              callFrameId: 'cf-1',
              location: {scriptId: '1', lineNumber: 10, columnNumber: 5},
              scopeChain: [],
            },
          ],
        }),
        isPaused: () => true,
        resume: async () => {
          resumeCalled = true;
        },
        pause: async () => undefined,
        stepOver: async () => undefined,
        stepInto: async () => undefined,
        stepOut: async () => undefined,
        evaluateOnCallFrame: async () => ({result: {value: null}}),
        getScopeVariables: async () => [],
        getClient: () => ({
          send: async (method: string, _params?: unknown) => {
            if (method === 'DOMDebugger.setXHRBreakpoint') {
              xhrBreakpointSet = true;
            } else if (method === 'DOMDebugger.removeXHRBreakpoint') {
              xhrBreakpointRemoved = true;
            }
            return undefined;
          },
        }),
      } as unknown as DebuggerContextHarness,
    });

    await xhrToJsBreakpoint.handler(
      {params: {url: '/api/data'}},
      response as unknown as Parameters<typeof xhrToJsBreakpoint.handler>[1],
      context as unknown as Parameters<typeof xhrToJsBreakpoint.handler>[2],
    );

    assert.ok(xhrBreakpointSet, 'XHR breakpoint should be set');
    assert.ok(
      response.lines.some(x => x.includes('XHR') && (x.includes('已设置') || x.includes('set'))),
    );
  });

  it('search_in_sources 超长 URL 仅返回 scriptId/lineNumber/sourcePath', async () => {
    const response = makeResponse();
    const context = makeContext();
    const longUrl = `https://combo.example.com/c?files=${'x'.repeat(300_000)}`;
    context.debuggerContext.searchInScripts = async () => ({
      matches: [
        {
          scriptId: '97',
          url: longUrl,
          lineNumber: 42,
          lineContent: 'const RsaPubAes = function(){};',
        },
      ],
    });

    await searchInSources.handler(
      {params: {query: 'RsaPubAes'}},
      response as unknown as Parameters<typeof searchInSources.handler>[1],
      context as unknown as Parameters<typeof searchInSources.handler>[2],
    );

    const last = response.structuredContents.at(-1) as {
      success: boolean;
      data: {
        matches: Array<{
          scriptId: string;
          lineNumber: number;
          sourcePath: string | null;
        }>;
      };
    };
    assert.ok(last.success, 'search 应成功');
    const match = last.data.matches[0];
    assert.ok(match, '应至少有一条匹配');
    assert.strictEqual(match.scriptId, '97');
    assert.strictEqual(match.lineNumber, 43); // lineNumber + 1
    // 新契约：返回 sourcePath 而非源码片段/URL，避免上下文臃肿
    assert.strictEqual(
      match.sourcePath,
      '/tmp/proxycli-scripts/test.js',
      '应返回 sourcePath',
    );
    // URL 相关字段已移除，不再出现在响应中
    assert.ok(!('url' in match), '不应再返回 url 字段');
    assert.ok(!('urlLength' in match), '不应再返回 urlLength 字段');
    assert.ok(!('urlTruncated' in match), '不应再返回 urlTruncated 字段');
    assert.ok(!('preview' in match), '不应再返回 preview 字段');
    assert.ok(
      !('lineContentLength' in match),
      '不应再返回 lineContentLength 字段',
    );
  });

  it('search_in_sources 体积超阈值时自动收窄 displayMatches', async () => {
    const response = makeResponse();
    const context = makeContext();
    // URL 已不在输出中，体积主要来自 sourcePath。让每条 sourcePath 约 10KB，
    // 60 条总计远超 200KB 安全阈值，触发按体积收窄。
    const bigPath = 'x'.repeat(10_000);
    context.debuggerContext.getScriptSourcePath = async () => bigPath;
    const matches = Array.from({length: 60}, (_, i) => ({
      scriptId: String(i),
      url: `https://combo.example.com/c?files=${'z'.repeat(10_000)}`,
      lineNumber: i + 1,
      lineContent: `RsaPubAes_${i}()`,
    }));
    context.debuggerContext.searchInScripts = async () => ({matches});

    await searchInSources.handler(
      // maxResults 设大以保证不被 maxResults 截断，只被体积收窄
      {params: {query: 'RsaPubAes', maxResults: 60}},
      response as unknown as Parameters<typeof searchInSources.handler>[1],
      context as unknown as Parameters<typeof searchInSources.handler>[2],
    );

    const last = response.structuredContents.at(-1) as {
      data: {
        matches: unknown[];
        totalMatches: number;
        displayedMatches: number;
        truncatedBySize: boolean;
        hint: string;
      };
    };
    assert.strictEqual(last.data.totalMatches, 60);
    assert.ok(
      last.data.displayedMatches < 60,
      `应被收窄，实际 ${last.data.displayedMatches}`,
    );
    assert.strictEqual(last.data.truncatedBySize, true);
    assert.ok(last.data.hint.includes('响应体积过大'), 'hint 应含体积收窄提示');
  });
});
