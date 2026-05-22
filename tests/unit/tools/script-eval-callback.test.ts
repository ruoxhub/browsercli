/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  evaluateScript as evaluateScriptTool,
  evaluateScriptFn,
  injectPreloadScript as injectPreloadScriptTool,
} from '../../../src/tools/script/script.js';
import { getRuntime } from '../../../src/runtime.js';

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
      } catch (e) {}
    },
    setStructuredContent: (content: unknown) => {
      result = content;
    },
  } as any;
  try {
    await evaluateScriptTool.handler({ params } as any, response, runtime);
  } finally {
    getRuntime().contextProvider = originalProvider;
  }
  return result;
}

async function injectPreloadScript(runtime: any, params: any): Promise<any> {
  const originalProvider = getRuntime().contextProvider;
  getRuntime().contextProvider = runtime;
  let result: any = null;
  const response = {
    appendResponseLine: (line: string) => {
      if (line.startsWith('```json')) return;
      if (line.startsWith('```')) return;
      try {
        result = JSON.parse(line);
      } catch (e) {}
    },
    setStructuredContent: (content: unknown) => {
      result = content;
    },
  } as any;
  try {
    await injectPreloadScriptTool.handler({ params } as any, response, runtime);
  } finally {
    getRuntime().contextProvider = originalProvider;
  }
  return result;
}

type EvaluateScriptRuntime = any;
type InjectPreloadRuntime = any;
type EvaluateScriptDebuggerContext = any;

interface HandleLike {
  dispose(): Promise<void>;
}

interface PageLike {
  evaluateHandle(): Promise<HandleLike>;
  evaluate(
    callback: (fn: () => Promise<unknown>) => Promise<string | undefined>,
    passedFn?: unknown,
  ): Promise<string | undefined>;
}

interface FrameLike extends PageLike {}

interface ExecutionContextLike {
  id: number;
  origin: string;
  name: string;
  world: 'page' | 'content-script' | 'unknown';
  frameId?: string;
  extensionId?: string;
}

describe('evaluate_script callback path', () => {
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
    assert.strictEqual(disposed, 1);
    assert.match(result.message, /returned/);
  });

  it('registers a preload script on future documents', async () => {
    let injected: string | undefined;

    const result = await injectPreloadScript(
      {
        getSelectedFrame: () => null,
        getSelectedPage: () => ({
          addInitScript: async (script: string) => {
            injected = script;
          },
        }),
        getContext: () => null,
      } as InjectPreloadRuntime,
      {script: 'window.__preload = 1;'},
    );

    assert.equal(result.success, true);
    assert.strictEqual(injected, 'window.__preload = 1;');
    assert.match(result.message, /registered/);
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
    assert.deepEqual(calls, [
      {
        method: 'Runtime.evaluate',
        params: {
          expression:
            '(async () => JSON.stringify(await (() => ({ ok: true, world: "content-script" }))()))()',
          contextId: 2,
          returnByValue: true,
          awaitPromise: true,
        },
      },
    ]);
  });

  it('selects the execution context bound to the current frame', async () => {
    const calls: Array<{method: string; params?: Record<string, unknown>}> = [];
    const selectedFrame = {
      _id: 'frame-2',
      evaluateHandle: async () => {
        throw new Error('frame fallback should not be used');
      },
      evaluate: async () => {
        throw new Error('frame fallback should not be used');
      },
    } as unknown as FrameLike;

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

    const result = await evaluateScript(
      {
        getSelectedFrame: () => frame,
        getSelectedPage: () => null,
        getDebuggerContext: async () => {
          throw new Error('cdp unavailable');
        },
      } as EvaluateScriptRuntime,
      {function: '() => ({ ok: true })'},
    );

    assert.equal(result.success, false);
    assert.match(result.message, /cdp unavailable/);
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
        getSelectedFrame: () =>
          ({_id: 'frame-1'} as unknown as FrameLike),
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

    const result = await evaluateScript(
      {
        getSelectedFrame: () => null,
        getSelectedPage: () => null,
        getDebuggerContext: async () => debuggerContext,
      } as EvaluateScriptRuntime,
      {
        function: '() => window.__zhihu.get_zse_96()',
        context: 'page',
      },
    );

    assert.equal(result.success, false);
    assert.match(result.message, /content script/i);
  });

  it('registers runtime preload script on the page context', async () => {
    let injected: string | undefined;

    const result = await injectPreloadScript(
      {
        getSelectedFrame: () => null,
        getSelectedPage: () => ({
          addInitScript: async (script: string) => {
            injected = script;
          },
        }),
        getContext: () => null,
      } as InjectPreloadRuntime,
      {script: 'window.__preload = 1;'},
    );

    assert.equal(result.success, true);
    assert.equal(injected, 'window.__preload = 1;');
  });
});
