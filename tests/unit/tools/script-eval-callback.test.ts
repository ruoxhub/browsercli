/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {getRuntime} from '../../../src/runtime.js';
import {
  evaluateScript as evaluateScriptTool,
  evaluateScriptFn,
} from '../../../src/tools/script/script.js';
import {ToolError} from '../../../src/utils/errors.js';

async function evaluateScript(runtime: any, params: any): Promise<any> {
  const originalProvider = getRuntime().contextProvider;
  getRuntime().contextProvider = runtime;
  let result: any = null;
  const response = {
    appendResponseLine: (line: string) => {
      if (line.startsWith('```json')) return;
      if (line.startsWith('```')) return;
      try {
        result = JSON.parse(line);
      } catch {
        /* intentionally empty */
      }
    },
    setStructuredContent: (content: unknown) => {
      result = content;
    },
  } as any;
  try {
    await evaluateScriptTool.handler({params} as any, response, runtime);
  } finally {
    getRuntime().contextProvider = originalProvider;
  }
  return result;
}

type EvaluateScriptRuntime = any;
type EvaluateScriptDebuggerContext = any;

interface HandleLike {
  dispose(): Promise<void>;
}

interface PageLike {
  evaluateHandle(): Promise<HandleLike>;
  evaluate(
    callback: (value: unknown) => Promise<string | undefined>,
    passedFn?: unknown,
  ): Promise<string | undefined>;
}

interface FrameLike extends PageLike {
  _id?: string;
  page?: () => {
    frames: () => unknown[];
    context: () => {
      newCDPSession: () => Promise<{
        send: (method: string) => Promise<Record<string, unknown>>;
        detach: () => Promise<void>;
      }>;
    };
  };
}

interface _ExecutionContextLike {
  id: number;
  origin: string;
  name: string;
  world: 'page' | 'content-script' | 'unknown';
  frameId?: string;
  extensionId?: string;
}

describe('evaluate_script callback path', () => {
  it('suggests shell-safe input modes for truncated functions', async () => {
    await assert.rejects(
      () =>
        evaluateScript({} as EvaluateScriptRuntime, {
          function: '() => {',
        }),
      (error: unknown) =>
        error instanceof ToolError &&
        /--file/.test(error.message) &&
        /--stdin/.test(error.message),
    );
  });

  it('executes page.evaluate callback body and disposes handle', async () => {
    let disposed = 0;

    const fn = async () => ({ok: true});

    const handle = {
      dispose: async () => {
        disposed += 1;
      },
    } satisfies HandleLike;

    const page: PageLike = {
      evaluateHandle: async () => handle,
      evaluate: async callback => callback(fn),
    };

    const result = await evaluateScriptFn(
      page as unknown as Parameters<typeof evaluateScriptFn>[0],
      '() => ({ ok: true })',
    );

    assert.equal(result.success, true);
    assert.equal(result.result, '{"ok":true}');
    assert.deepEqual(result.data.value, {ok: true});
    assert.strictEqual(disposed, 1);
    assert.match(result.message, /returned/);
  });

  it('returns an ordinary expression result without calling it', async () => {
    const handle = {
      dispose: async () => undefined,
    } satisfies HandleLike;

    const page: PageLike = {
      evaluateHandle: async () => handle,
      evaluate: async callback => callback('page title'),
    };

    const result = await evaluateScriptFn(
      page as unknown as Parameters<typeof evaluateScriptFn>[0],
      'document.title',
    );

    assert.equal(result.success, true);
    assert.equal(result.result, '"page title"');
    assert.equal(result.data.value, 'page title');
  });

  it('returns an IIFE result without calling it again', async () => {
    const handle = {
      dispose: async () => undefined,
    } satisfies HandleLike;

    const page: PageLike = {
      evaluateHandle: async () => handle,
      evaluate: async callback => callback({ok: true}),
    };

    const result = await evaluateScriptFn(
      page as unknown as Parameters<typeof evaluateScriptFn>[0],
      '(() => ({ok: true}))()',
    );

    assert.equal(result.success, true);
    assert.equal(result.result, '{"ok":true}');
  });

  it('runs evaluate_script in the selected frame execution context', async () => {
    let pageUsed = false;
    let frameUsed = false;

    const frameHandle = {
      dispose: async () => undefined,
    } satisfies HandleLike;

    const page: PageLike = {
      evaluateHandle: async () => {
        pageUsed = true;
        throw new Error('page should not be used when a frame is selected');
      },
      evaluate: async () => {
        pageUsed = true;
        throw new Error('page should not be used when a frame is selected');
      },
    };

    const frame: FrameLike = {
      evaluateHandle: async () => {
        frameUsed = true;
        return frameHandle;
      },
      evaluate: async callback => {
        frameUsed = true;
        if (typeof callback !== 'function') {
          throw new Error('expected callback evaluate path');
        }
        return callback(async () => ({ok: true}));
      },
    };

    const result = await evaluateScript(
      {
        getSelectedPage: () => page,
        getSelectedFrame: () => frame,
      } as unknown as EvaluateScriptRuntime,
      {function: '() => ({ ok: true })'},
    );

    assert.equal(result.success, true);
    assert.strictEqual(pageUsed, false);
    assert.strictEqual(frameUsed, true);
    assert.equal(result.result, '{"ok":true}');
  });

  it('runs runtime evaluate_script against the selected frame', async () => {
    let frameUsed = false;

    const frame: FrameLike = {
      evaluateHandle: async () => {
        frameUsed = true;
        return {dispose: async () => undefined};
      },
      evaluate: async callback => {
        frameUsed = true;
        if (typeof callback !== 'function') {
          throw new Error('expected callback evaluate path');
        }
        return callback(async () => ({ok: true}));
      },
    };

    const result = await evaluateScript(
      {
        getSelectedFrame: () => frame,
        getSelectedPage: () => null,
      } as unknown as EvaluateScriptRuntime,
      {function: '() => ({ ok: true })'},
    );

    assert.equal(result.success, true);
    assert.equal(frameUsed, true);
    assert.equal(result.result, '{"ok":true}');
  });

  it('runs runtime evaluate_script in content-script context when requested', async () => {
    const calls: Array<{method: string; params?: Record<string, unknown>}> = [];
    const debuggerContext = {
      getExecutionContexts: () => [
        {
          id: 1,
          origin: 'https://example.com',
          name: '',
          world: 'page',
          frameId: 'frame-1',
        },
        {
          id: 2,
          origin: 'chrome-extension://abcdef/content.js',
          name: 'content-script',
          world: 'content-script',
          frameId: 'frame-1',
          extensionId: 'abcdef',
        },
      ],
      getClient: () => ({
        send: async (method: string, params?: Record<string, unknown>) => {
          calls.push({method, params});
          return {
            result: {
              value: '{"ok":true,"world":"content-script"}',
            },
          };
        },
      }),
    } as unknown as EvaluateScriptDebuggerContext;

    const result = await evaluateScript(
      {
        getSelectedFrame: () => null,
        getSelectedPage: () => null,
        getDebuggerContext: async () => debuggerContext,
      } as EvaluateScriptRuntime,
      {
        function: '() => ({ ok: true, world: "content-script" })',
        context: 'content-script',
      },
    );

    assert.equal(result.success, true);
    assert.equal(result.result, '{"ok":true,"world":"content-script"}');
    assert.deepEqual(result.data.value, {
      ok: true,
      world: 'content-script',
    });
    assert.deepEqual(calls, [
      {
        method: 'Runtime.evaluate',
        params: {
          expression:
            '(async () => { const value = await (() => ({ ok: true, world: "content-script" })); return JSON.stringify(typeof value === \'function\' ? await value() : value); })()',
          contextId: 2,
          returnByValue: true,
          awaitPromise: true,
        },
      },
    ]);
  });

  it('selects the execution context bound to the current frame', async () => {
    const calls: Array<{method: string; params?: Record<string, unknown>}> = [];
    const pageMock = {
      frames: () => [{}, selectedFrame],
      context: () => ({
        newCDPSession: async () => ({
          send: async (method: string) => {
            if (method === 'Page.getFrameTree') {
              return {
                frameTree: {
                  frame: {id: 'frame-1'},
                  childFrames: [{frame: {id: 'frame-2'}}],
                },
              };
            }
            return {};
          },
          detach: async () => undefined,
        }),
      }),
    };
    const selectedFrame: FrameLike = {
      _id: 'frame-2',
      page: () => pageMock,
      evaluateHandle: async () => {
        throw new Error('frame fallback should not be used');
      },
      evaluate: async () => {
        throw new Error('frame fallback should not be used');
      },
    };

    const debuggerContext = {
      getExecutionContexts: () => [
        {
          id: 11,
          origin: 'https://example.com',
          name: '',
          world: 'page',
          frameId: 'frame-1',
        },
        {
          id: 22,
          origin: 'https://example.com',
          name: '',
          world: 'page',
          frameId: 'frame-2',
        },
      ],
      getClient: () => ({
        send: async (method: string, params?: Record<string, unknown>) => {
          calls.push({method, params});
          return {
            result: {
              value: '{"frame":"two"}',
            },
          };
        },
      }),
    } as unknown as EvaluateScriptDebuggerContext;

    const result = await evaluateScript(
      {
        getSelectedFrame: () => selectedFrame,
        getSelectedPage: () => null,
        getDebuggerContext: async () => debuggerContext,
      } as EvaluateScriptRuntime,
      {function: '() => ({ frame: "two" })'},
    );

    assert.equal(result.success, true);
    assert.equal(result.result, '{"frame":"two"}');
    assert.equal(calls[0]?.params?.contextId, 22);
  });

  it('fails instead of falling back when debugger context lookup throws', async () => {
    let frameUsed = false;
    const frame: FrameLike = {
      evaluateHandle: async () => {
        frameUsed = true;
        return {dispose: async () => undefined};
      },
      evaluate: async callback => {
        frameUsed = true;
        return callback(async () => ({ok: true}));
      },
    };

    await assert.rejects(
      () =>
        evaluateScript(
          {
            getSelectedFrame: () => frame,
            getSelectedPage: () => null,
            getDebuggerContext: async () => {
              throw new Error('cdp unavailable');
            },
          } as EvaluateScriptRuntime,
          {function: '() => ({ ok: true })'},
        ),
      (error: unknown) =>
        error instanceof ToolError && /cdp unavailable/.test(error.message),
    );

    assert.equal(frameUsed, false);
  });

  it('keeps undefined results consistent across frame and CDP paths', async () => {
    const frame: FrameLike = {
      evaluateHandle: async () => ({dispose: async () => undefined}),
      evaluate: async callback => callback(async () => undefined),
    };
    const frameResult = await evaluateScript(
      {
        getSelectedFrame: () => frame,
        getSelectedPage: () => null,
      } as unknown as EvaluateScriptRuntime,
      {function: '() => undefined'},
    );

    const debuggerContext = {
      getExecutionContexts: () => [
        {
          id: 1,
          origin: 'https://example.com',
          name: '',
          world: 'page',
          frameId: 'frame-1',
        },
      ],
      getClient: () => ({
        send: async () => ({
          result: {
            value: undefined,
          },
        }),
      }),
    } as unknown as EvaluateScriptDebuggerContext;
    const cdpResult = await evaluateScript(
      {
        getSelectedFrame: () => ({_id: 'frame-1'}) as unknown as FrameLike,
        getSelectedPage: () => null,
        getDebuggerContext: async () => debuggerContext,
      } as EvaluateScriptRuntime,
      {function: '() => undefined'},
    );

    assert.equal(frameResult.success, true);
    assert.equal(cdpResult.success, true);
    assert.equal(frameResult.result, undefined);
    assert.equal(cdpResult.result, undefined);
  });

  it('honors a caller-provided execution timeout', async () => {
    const startedAt = Date.now();
    await assert.rejects(
      () =>
        evaluateScript(
          {
            getSelectedFrame: () => ({
              evaluateHandle: async () =>
                await new Promise<never>(() => undefined),
            }),
            getSelectedPage: () => null,
          } as unknown as EvaluateScriptRuntime,
          {function: 'document.title', timeoutMs: 10},
        ),
      (error: unknown) =>
        error instanceof ToolError && /timed out/i.test(error.message),
    );

    assert.ok(Date.now() - startedAt < 1_000);
  });

  it('returns isolation hint when page context accesses extension object', async () => {
    const debuggerContext = {
      getExecutionContexts: () => [
        {
          id: 1,
          origin: 'https://example.com',
          name: '',
          world: 'page',
          frameId: 'frame-1',
        },
      ],
      getClient: () => ({
        send: async () => ({
          result: {},
          exceptionDetails: {
            text: 'TypeError: Cannot read properties of undefined',
            exception: {
              description:
                "TypeError: Cannot read properties of undefined (reading 'get_zse_96')",
            },
          },
        }),
      }),
    } as unknown as EvaluateScriptDebuggerContext;

    await assert.rejects(
      () =>
        evaluateScript(
          {
            getSelectedFrame: () => null,
            getSelectedPage: () => null,
            getDebuggerContext: async () => debuggerContext,
          } as EvaluateScriptRuntime,
          {
            function: '() => window.__zhihu.get_zse_96()',
            context: 'page',
          },
        ),
      (error: unknown) =>
        error instanceof ToolError && /content script/i.test(error.message),
    );
  });
});
