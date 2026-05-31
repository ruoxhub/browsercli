/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DebuggerContext} from '../../src/DebuggerContext.js';

type Handler = (payload: any) => void;

class FakeCDPSession {
  readonly calls: Array<{method: string; params?: unknown}> = [];
  #handlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler): void {
    const arr = this.#handlers.get(event) ?? [];
    arr.push(handler);
    this.#handlers.set(event, arr);
  }

  off(event: string, handler: Handler): void {
    const arr = this.#handlers.get(event) ?? [];
    this.#handlers.set(
      event,
      arr.filter((h) => h !== handler),
    );
  }

  async send(method: string, params?: any): Promise<any> {
    this.calls.push({method, params});
    if (method === 'Debugger.setBreakpointByUrl') {
      return {breakpointId: 'bp-1', locations: []};
    }
    return {};
  }

  emit(event: string, payload: any): void {
    for (const handler of this.#handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

describe('DebuggerContext auto recovery', () => {
  it('auto resumes and removes breakpoint when same breakpoint loops', async () => {
    const context = new DebuggerContext();
    const client = new FakeCDPSession();
    await context.enable(client as any);
    await context.setBreakpoint('https://a.js', 1, 0);

    const pausedEvent = {
      reason: 'other',
      hitBreakpoints: ['bp-1'],
      callFrames: [
        {
          callFrameId: 'cf-1',
          functionName: 'fn',
          url: 'https://a.js',
          location: {scriptId: 's1', lineNumber: 1, columnNumber: 0},
          scopeChain: [],
          this: {type: 'object'},
        },
      ],
    };

    client.emit('Debugger.paused', pausedEvent);
    client.emit('Debugger.paused', pausedEvent);
    client.emit('Debugger.paused', pausedEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const resumeCalls = client.calls.filter((x) => x.method === 'Debugger.resume');
    const removeCalls = client.calls.filter((x) => x.method === 'Debugger.removeBreakpoint');
    assert.ok(resumeCalls.length >= 1);
    assert.ok(removeCalls.some((x) => (x.params as {breakpointId?: string})?.breakpointId === 'bp-1'));

    const recovery = context.getLastAutoRecoveryEvent();
    assert.ok(recovery);
    assert.strictEqual(recovery?.breakpointId, 'bp-1');
    assert.ok((recovery?.hitCount ?? 0) >= 3);
  });
});

describe('DebuggerContext.getScriptSource caching', () => {
  it('reuses cached source on subsequent calls without re-sending CDP', async () => {
    const context = new DebuggerContext();
    const client = new FakeCDPSession();
    let getSourceCalls = 0;
    const originalSend = client.send.bind(client);
    client.send = async (method: string, params?: any): Promise<any> => {
      if (method === 'Debugger.getScriptSource') {
        getSourceCalls++;
        return {scriptSource: 'console.log("hi");'};
      }
      return originalSend(method, params);
    };

    await context.enable(client as any);

    const first = await context.getScriptSource('s1');
    const second = await context.getScriptSource('s1');
    const third = await context.getScriptSource('s1');

    assert.strictEqual(first, 'console.log("hi");');
    assert.strictEqual(second, first);
    assert.strictEqual(third, first);
    assert.strictEqual(getSourceCalls, 1);
  });

  it('caches beautified output and only invokes the producer once', async () => {
    const context = new DebuggerContext();
    const client = new FakeCDPSession();
    client.send = async (method: string): Promise<any> => {
      if (method === 'Debugger.getScriptSource') {
        return {scriptSource: 'a;b;'};
      }
      return {};
    };

    await context.enable(client as any);

    let beautifyCalls = 0;
    const beautify = (src: string): string => {
      beautifyCalls++;
      return src.split(';').join(';\n');
    };

    const first = await context.getBeautifiedScriptSource('s1', beautify);
    const second = await context.getBeautifiedScriptSource('s1', beautify);

    assert.strictEqual(first, 'a;\nb;\n');
    assert.strictEqual(second, first);
    assert.strictEqual(beautifyCalls, 1);
  });

  it('falls back to raw source when the beautifier throws and does not memoize', async () => {
    const context = new DebuggerContext();
    const client = new FakeCDPSession();
    client.send = async (method: string): Promise<any> => {
      if (method === 'Debugger.getScriptSource') {
        return {scriptSource: 'raw-source'};
      }
      return {};
    };

    await context.enable(client as any);

    let beautifyCalls = 0;
    const throwOnce = (): string => {
      beautifyCalls++;
      throw new Error('parse failed');
    };

    const first = await context.getBeautifiedScriptSource('s1', throwOnce);
    assert.strictEqual(first, 'raw-source');

    // Second call should retry — failure is not memoized.
    const second = await context.getBeautifiedScriptSource('s1', throwOnce);
    assert.strictEqual(second, 'raw-source');
    assert.strictEqual(beautifyCalls, 2);
  });

  it('clears cached sources after disable', async () => {
    const context = new DebuggerContext();
    const client = new FakeCDPSession();
    let getSourceCalls = 0;
    client.send = async (method: string): Promise<any> => {
      if (method === 'Debugger.getScriptSource') {
        getSourceCalls++;
        return {scriptSource: `payload-${getSourceCalls}`};
      }
      return {};
    };

    await context.enable(client as any);
    const before = await context.getScriptSource('s1');
    assert.strictEqual(before, 'payload-1');

    await context.disable();

    const client2 = new FakeCDPSession();
    let secondGetSourceCalls = 0;
    client2.send = async (method: string): Promise<any> => {
      if (method === 'Debugger.getScriptSource') {
        secondGetSourceCalls++;
        return {scriptSource: 'fresh'};
      }
      return {};
    };
    await context.enable(client2 as any);

    const after = await context.getScriptSource('s1');
    assert.strictEqual(after, 'fresh');
    assert.strictEqual(secondGetSourceCalls, 1);
  });
});
