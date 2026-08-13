import assert from 'node:assert';
import {EventEmitter} from 'node:events';
import {describe, it} from 'node:test';

import {BrowserTargetInspector} from '../../../src/modules/browser/BrowserTargetInspector.js';
import {ToolError} from '../../../src/utils/errors.js';

interface FakeOptions {
  never?:
    | 'newSession'
    | 'getTargets'
    | 'attach'
    | 'detachTarget'
    | 'detachRoot';
  scripts?: Array<Record<string, unknown>>;
}

class FakeRootSession extends EventEmitter {
  readonly calls: string[] = [];
  readonly childCalls: string[] = [];
  detachCalls = 0;

  constructor(private readonly options: FakeOptions) {
    super();
  }

  async send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<object> {
    this.calls.push(method);
    if (method === 'Target.getTargets') {
      if (this.options.never === 'getTargets') return new Promise(() => {});
      return {
        targetInfos: [
          {
            targetId: 'worker-1',
            type: 'worker',
            title: 'worker',
            url: 'http://local/worker.js',
            attached: true,
          },
          {
            targetId: 'browser-1',
            type: 'browser',
            title: 'browser',
            url: '',
            attached: false,
          },
        ],
      };
    }
    if (method === 'Target.attachToTarget') {
      if (this.options.never === 'attach') return new Promise(() => {});
      return {sessionId: 'session-1'};
    }
    if (method === 'Target.detachFromTarget') {
      if (this.options.never === 'detachTarget') return new Promise(() => {});
      return {};
    }
    if (method === 'Target.sendMessageToTarget') {
      const message = JSON.parse(params.message as string) as {
        id: number;
        method: string;
        params: Record<string, unknown>;
      };
      this.childCalls.push(message.method);
      queueMicrotask(() => {
        if (message.method === 'Debugger.enable') {
          for (const script of this.options.scripts ?? []) {
            this.emit('Target.receivedMessageFromTarget', {
              sessionId: 'session-1',
              message: JSON.stringify({
                method: 'Debugger.scriptParsed',
                params: script,
              }),
            });
          }
        }
        const scriptId = message.params.scriptId as string;
        const sourceById: Record<string, string> = {
          one: 'self.workerMarker = "one";',
          duplicate: 'self.workerMarker = "one";',
          multibyte: '你你你',
        };
        this.emit('Target.receivedMessageFromTarget', {
          sessionId: 'session-1',
          message: JSON.stringify({
            id: message.id,
            result:
              message.method === 'Debugger.getScriptSource'
                ? {scriptSource: sourceById[scriptId] ?? ''}
                : {},
          }),
        });
      });
      return {};
    }
    return {};
  }

  async detach(): Promise<void> {
    this.detachCalls++;
    if (this.options.never === 'detachRoot') return new Promise(() => {});
  }
}

function fakeBrowser(root: FakeRootSession, neverNewSession = false): object {
  return {
    isConnected: () => true,
    browserType: () => ({name: () => 'chromium'}),
    newBrowserCDPSession: () =>
      neverNewSession ? new Promise(() => {}) : Promise.resolve(root),
  };
}

describe('BrowserTargetInspector', () => {
  it('validates browser state and platform', async () => {
    await assert.rejects(
      new BrowserTargetInspector(() => null).listTargets(),
      (error: ToolError) => error.code === 'PREREQUISITE',
    );
    const firefox = {
      isConnected: () => true,
      browserType: () => ({name: () => 'firefox'}),
    };
    await assert.rejects(
      new BrowserTargetInspector(() => firefox as never).listTargets(),
      (error: ToolError) => error.code === 'VALIDATION',
    );
  });

  it('lists targets in protocol order and always detaches the root session', async () => {
    const root = new FakeRootSession({});
    const inspector = new BrowserTargetInspector(
      () => fakeBrowser(root) as never,
    );
    const targets = await inspector.listTargets();
    assert.deepEqual(
      targets.map(target => [target.targetId, target.canDumpScripts]),
      [
        ['worker-1', true],
        ['browser-1', false],
      ],
    );
    assert.equal(root.detachCalls, 1);
  });

  it('bounds every root command including never-settling session creation and cleanup', async () => {
    for (const never of ['newSession', 'getTargets', 'attach'] as const) {
      const root = new FakeRootSession({never});
      const inspector = new BrowserTargetInspector(
        () => fakeBrowser(root, never === 'newSession') as never,
        {commandTimeoutMs: 5},
      );
      await assert.rejects(inspector.dumpScripts('worker-1'), /超时/);
      if (never === 'newSession') assert.equal(root.detachCalls, 0);
    }

    for (const never of ['detachTarget', 'detachRoot'] as const) {
      const root = new FakeRootSession({
        never,
        scripts: [{scriptId: 'one', url: 'http://local/worker.js', hash: 'h1'}],
      });
      const result = await new BrowserTargetInspector(
        () => fakeBrowser(root) as never,
        {commandTimeoutMs: 5, idleWindowMs: 1, maxObservationMs: 5},
      ).dumpScripts('worker-1');
      assert.match(result.warnings.join('\n'), /cleanup failed/);
    }
  });

  it('shares only concurrent dumps and releases in-flight state afterward', async () => {
    const root = new FakeRootSession({
      scripts: [{scriptId: 'one', url: 'http://local/worker.js', hash: 'h1'}],
    });
    const inspector = new BrowserTargetInspector(
      () => fakeBrowser(root) as never,
      {idleWindowMs: 1, maxObservationMs: 5},
    );
    const first = inspector.dumpScripts('worker-1');
    const second = inspector.dumpScripts('worker-1');
    assert.equal(first, second);
    assert.equal((await first).scripts.length, 1);
    await inspector.dumpScripts('worker-1');
    assert.equal(
      root.calls.filter(call => call === 'Target.attachToTarget').length,
      2,
    );
  });

  it('skips Wasm, deduplicates, truncates UTF-8, and reports precise stats', async () => {
    const root = new FakeRootSession({
      scripts: [
        {scriptId: 'one', url: 'same.js', hash: 'same'},
        {scriptId: 'duplicate', url: 'same.js', hash: 'same'},
        {scriptId: 'wasm', url: 'module.wasm', scriptLanguage: 'WebAssembly'},
        {scriptId: 'multibyte', url: '', hash: 'multi'},
      ],
    });
    const result = await new BrowserTargetInspector(
      () => fakeBrowser(root) as never,
      {
        idleWindowMs: 1,
        maxObservationMs: 5,
        maxSingleFileBytes: 7,
        maxResponseBytes: 100,
      },
    ).dumpScripts('worker-1');
    assert.equal(result.stats.observed, 4);
    assert.equal(result.stats.returned, 2);
    assert.equal(result.stats.duplicates, 1);
    assert.equal(result.stats.omitted, 1);
    assert.equal(result.stats.truncated, 2);
    assert.equal(result.scripts[1]?.content, '你你');
    assert.equal(result.scripts[1]?.size, 6);
    assert.equal(result.partial, true);
    assert.match(result.warnings.join('\n'), /WebAssembly/);
  });

  it('returns a successful empty snapshot when no scripts are observed', async () => {
    const root = new FakeRootSession({scripts: []});
    const result = await new BrowserTargetInspector(
      () => fakeBrowser(root) as never,
      {idleWindowMs: 1, maxObservationMs: 5},
    ).dumpScripts('worker-1');
    assert.equal(result.scripts.length, 0);
    assert.equal(result.partial, false);
    assert.deepEqual(result.stats, {
      observed: 0,
      returned: 0,
      duplicates: 0,
      failed: 0,
      truncated: 0,
      omitted: 0,
      originalBytes: 0,
      returnedBytes: 0,
    });
  });
});
