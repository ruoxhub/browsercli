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
    url: string,
    lineNumber: number,
    columnNumber: number,
    condition?: string,
  ): Promise<BreakpointHarness>;
  setBreakpointByUrlRegex(
    url: string,
    lineNumber: number,
    columnNumber: number,
    condition?: string,
  ): Promise<BreakpointHarness>;
  removeBreakpoint(breakpointId: string): Promise<void>;
  getBreakpoints(): Array<{
    breakpointId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
    condition?: string;
    locations: unknown[];
  }>;
  getPausedState(): {
    isPaused: boolean;
    reason?: string;
    hitBreakpoints?: string[];
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
  };
  isPaused(): boolean;
  resume(): Promise<void>;
  pause(): Promise<void>;
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
    setStructuredContent: (c: unknown) => structuredContents.push(c),
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
  };

  const debuggerContext = {
    isEnabled: () => true,
    getScripts: () => [],
    getScriptsByUrlPattern: () => [],
    getScriptSource: async () => '',
    getScriptSourcePath: async () => '/tmp/browsercli-scripts/test.js',
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
    setBreakpointByUrlRegex: async () => ({breakpointId: 'bp2', locations: []}),
    removeBreakpoint: async () => undefined,
    getBreakpoints: () => [],
    getPausedState: () => ({isPaused: false, callFrames: []}),
    isPaused: () => false,
    resume: async () => undefined,
    pause: async () => undefined,
    stepOver: async () => undefined,
    stepInto: async () => undefined,
    stepOut: async () => undefined,
    evaluateOnCallFrame: async () => ({result: {value: 1}}),
    getScopeVariables: async () => [],
    getClient: () => ({send: async () => undefined}),
  };

  return {
    getSelectedPage: () => page,
    getSelectedFrame: () => page,
    selectFrame: () => undefined,
    resetSelectedFrame: () => undefined,
    getNetworkRequestById: () => ({url: () => 'https://api.example.com'}),
    getRequestInitiator: () => undefined,
    debuggerContext,
    getDebuggerContext: () => debuggerContext,
    ...overrides,
  };
}

describe('debugger tools extended', () => {
  it('covers script listing and source operations', async () => {
    const response = makeResponse();
    const _runtime = getJSHookRuntime();
    const context = makeContext();
    context.debuggerContext.getScripts = () => [
      {scriptId: '1', url: 'https://a.js'},
    ];
    context.debuggerContext.getScriptsByUrlPattern = () => [
      {scriptId: '2', url: 'https://b.js'},
    ];
    context.debuggerContext.getScriptSourcePath = async () =>
      '/tmp/browsercli-scripts/test.js';

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

    assert.ok(response.lines.some(x => x.includes('Found')));
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
    await findInScript.handler(
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

    assert.ok(response.lines.some(x => x.includes('Found "abc"')));
    assert.ok(response.lines.some(x => x.includes('not found')));
    assert.ok(
      response.lines.some(x => x.includes('Tip: Use get_script_source')),
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
      response.lines.some(x => x.includes('Breakpoint set successfully')),
    );
    assert.ok(
      response.lines.some(x => x.includes('If execution appears stuck')),
    );
    assert.ok(response.lines.some(x => x.includes('Active breakpoints')));
    assert.ok(response.lines.some(x => x.includes('Call Stack')));
    assert.ok(
      response.lines.some(x =>
        x.includes('URL: https://a.js [SourceMap: https://a.js.map]'),
      ),
    );
    assert.ok(response.lines.some(x => x.includes('SourceMap')));
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

    assert.ok(response.lines.some(x => x.includes('Execution Paused')));
    assert.ok(response.lines.some(x => x.includes('Auto-recovery detected')));
    assert.ok(response.lines.some(x => x.includes('SourceMap')));
    assert.ok(response.lines.some(x => x.includes('Result')));
    assert.ok(
      response.lines.some(
        x => x.includes('Execution resumed') || x.includes('Pause requested'),
      ),
    );
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
      response.lines.some(x => x.includes('Breakpoint set successfully')),
    );
    assert.ok(response.lines.some(x => x.includes('Function trace installed')));
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

      const taskParams = {
        taskId: 'task-debugger-evidence',
        taskSlug: 'debugger-evidence',
        targetUrl: 'https://example.com',
        goal: 'capture fallback evidence',
      };

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
            return {success: true, hookId: 'h1'};
          case 2:
            return [{id: 'h1', target: 'Window.fetch'}];
          case 3:
            return {success: true};
          case 4:
            return {type: 'object', constructor: 'Object', value: {a: 1}};
          case 5:
            return {localStorage: {token: 'x'}};
          case 6:
            return {success: true, monitorId: 'm1', eventCount: 2};
          default:
            return {success: true};
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
              return {success: true, hookId: 'h1'};
            case 2:
              return [{id: 'h1', target: 'Window.fetch'}];
            case 3:
              return {success: true};
            case 4:
              return {type: 'object', constructor: 'Object', value: {a: 1}};
            case 5:
              return {localStorage: {token: 'x'}};
            case 6:
              return {success: true, monitorId: 'm1', eventCount: 2};
            default:
              return {success: true};
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
      response.lines.some(x => x.includes('Hook installed successfully')),
    );
    assert.ok(response.lines.some(x => x.includes('Active hooks')));
    assert.ok(response.lines.some(x => x.includes('Storage data')));
    assert.ok(response.lines.some(x => x.includes('Event monitor started')));
    assert.ok(response.lines.some(x => x.includes('Monitor "m1" stopped')));
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
    assert.ok(
      response.lines.some(line => line.includes('0: https://root.example.com')),
    );
    assert.ok(
      response.lines.some(line =>
        line.includes(
          '1: https://child.example.com name="auth-frame" [selected]',
        ),
      ),
    );
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
    assert.ok(response.lines.some(x => x.includes('XHR breakpoint set')));
    assert.ok(response.lines.some(x => x.includes('XHR breakpoint removed')));
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
        getScriptSourcePath: async () => '/tmp/browsercli-scripts/test.js',
        getScriptById: () => ({scriptId: '1', url: 'https://app.js'}),
        searchInScripts: async () => ({matches: []}),
        setBreakpoint: async () => {
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
    assert.ok(jsBreakpointSet, 'JS breakpoint should be set');
    assert.ok(xhrBreakpointRemoved, 'XHR breakpoint should be removed');
    assert.ok(resumeCalled, 'resume should be called');
    assert.ok(response.lines.some(x => x.includes('阶段 1')));
    assert.ok(response.lines.some(x => x.includes('阶段 2')));
    assert.ok(response.lines.some(x => x.includes('顶层用户代码位置')));
  });

  it('search_in_sources 截断超长 URL 并保留诊断字段', async () => {
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
      {params: {query: 'RsaPubAes', maxUrlLength: 200}},
      response as unknown as Parameters<typeof searchInSources.handler>[1],
      context as unknown as Parameters<typeof searchInSources.handler>[2],
    );

    const last = response.structuredContents.at(-1) as {
      success: boolean;
      data: {
        matches: Array<{
          url: string;
          urlLength: number;
          urlTruncated: boolean;
          sourcePath: string | null;
          preview?: unknown;
          lineContentLength?: unknown;
        }>;
      };
    };
    assert.ok(last.success, 'search 应成功');
    const match = last.data.matches[0];
    assert.ok(match, '应至少有一条匹配');
    assert.strictEqual(match.urlLength, longUrl.length);
    assert.strictEqual(match.urlTruncated, true);
    // maxUrlLength=200，中间截断后含 '...' 总长应 ≤ 200
    assert.ok(
      match.url.length <= 200,
      `截断后 URL 长度 ${match.url.length} 应 ≤ 200`,
    );
    assert.ok(match.url.includes('...'), '截断 URL 应包含省略号');
    // 头部应保留 origin
    assert.ok(
      match.url.startsWith('https://combo.example.com'),
      '截断 URL 头部应保留 origin',
    );
    // 改进：返回 sourcePath 而非源码片段，避免上下文臃肿
    assert.strictEqual(
      match.sourcePath,
      '/tmp/browsercli-scripts/test.js',
      '应返回 sourcePath',
    );
    assert.ok(!('preview' in match), '不应再返回 preview 字段');
    assert.ok(
      !('lineContentLength' in match),
      '不应再返回 lineContentLength 字段',
    );
  });

  it('search_in_sources maxUrlLength=0 关闭截断', async () => {
    const response = makeResponse();
    const context = makeContext();
    const longUrl = `https://combo.example.com/c?files=${'y'.repeat(5000)}`;
    context.debuggerContext.searchInScripts = async () => ({
      matches: [
        {
          scriptId: '1',
          url: longUrl,
          lineNumber: 1,
          lineContent: 'RsaPubAes()',
        },
      ],
    });

    await searchInSources.handler(
      {params: {query: 'RsaPubAes', maxUrlLength: 0}},
      response as unknown as Parameters<typeof searchInSources.handler>[1],
      context as unknown as Parameters<typeof searchInSources.handler>[2],
    );

    const last = response.structuredContents.at(-1) as {
      data: {matches: Array<{url: string; urlTruncated: boolean}>};
    };
    const match = last.data.matches[0];
    assert.strictEqual(match.url, longUrl);
    assert.strictEqual(match.urlTruncated, false);
  });

  it('search_in_sources 体积超阈值时自动收窄 displayMatches', async () => {
    const response = makeResponse();
    const context = makeContext();
    // 60 条匹配，每条 URL 10KB（总约 600KB，超过 200KB 安全阈值）
    const bigUrl = `https://combo.example.com/c?files=${'z'.repeat(10_000)}`;
    const matches = Array.from({length: 60}, (_, i) => ({
      scriptId: String(i),
      url: bigUrl,
      lineNumber: i + 1,
      lineContent: `RsaPubAes_${i}()`,
    }));
    context.debuggerContext.searchInScripts = async () => ({matches});

    await searchInSources.handler(
      // maxResults 设大以保证不被 maxResults 截断，只被体积收窄
      {params: {query: 'RsaPubAes', maxResults: 60, maxUrlLength: 0}},
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
