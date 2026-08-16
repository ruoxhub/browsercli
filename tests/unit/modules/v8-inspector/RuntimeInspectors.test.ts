/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {BytecodeExtractor} from '../../../../src/modules/v8-inspector/BytecodeExtractor.js';
import {JITInspector} from '../../../../src/modules/v8-inspector/JITInspector.js';
import {V8InspectorClient} from '../../../../src/modules/v8-inspector/V8InspectorClient.js';
import {VersionDetector} from '../../../../src/modules/v8-inspector/VersionDetector.js';

interface ProtocolCall {
  method: string;
  params?: Record<string, unknown>;
}

type SendHandler = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

function createProtocolHarness(handler: SendHandler) {
  const calls: ProtocolCall[] = [];
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let detachCount = 0;

  const session = {
    async send<T = unknown>(
      method: string,
      params?: Record<string, unknown>,
    ): Promise<T> {
      calls.push({method, params});
      return (await handler(method, params)) as T;
    },
    on(event: string, listener: (...args: unknown[]) => void): void {
      const entries = listeners.get(event) ?? new Set();
      entries.add(listener);
      listeners.set(event, entries);
    },
    off(event: string, listener: (...args: unknown[]) => void): void {
      listeners.get(event)?.delete(listener);
    },
    async detach(): Promise<void> {
      detachCount += 1;
    },
  };

  const page = {
    context() {
      return {
        async newCDPSession(target: unknown) {
          assert.equal(target, page);
          return session;
        },
      };
    },
  };

  return {
    calls,
    emit(event: string, payload: unknown): void {
      for (const listener of listeners.get(event) ?? []) {
        listener(payload);
      }
    },
    get detachCount(): number {
      return detachCount;
    },
    page,
  };
}

describe('VersionDetector', () => {
  it('parses browser V8 versions and detaches the owned session', async () => {
    const harness = createProtocolHarness(async method => {
      assert.equal(method, 'Browser.getVersion');
      return {jsVersion: '12.0.226.10'};
    });
    const detector = new VersionDetector(async () => harness.page);

    assert.deepEqual(await detector.detectV8Version(), {
      major: 12,
      minor: 0,
      patch: 226,
      commit: '10',
    });
    assert.equal(harness.detachCount, 1);
    assert.deepEqual(detector.parseV8Version('not-a-version'), {
      major: 0,
      minor: 0,
      patch: 0,
      commit: '',
    });
  });
});

describe('V8InspectorClient', () => {
  it('combines heap-usage protocol fallbacks and releases its retained session', async () => {
    const harness = createProtocolHarness(async method => {
      switch (method) {
        case 'HeapProfiler.enable':
          return {};
        case 'Runtime.getHeapUsage':
          return {usedSize: 128, totalSize: 256};
        case 'HeapProfiler.getHeapUsage':
        case 'Performance.getMetrics':
          throw new Error(`${method} unavailable`);
        case 'Runtime.evaluate':
          return {result: {value: {jsHeapSizeLimit: 512}}};
        default:
          throw new Error(`Unexpected method: ${method}`);
      }
    });
    const client = new V8InspectorClient(async () => harness.page);

    assert.deepEqual(await client.getHeapUsage(), {
      jsHeapSizeUsed: 128,
      jsHeapSizeTotal: 256,
      jsHeapSizeLimit: 512,
    });
    assert.equal(harness.detachCount, 0);

    await client.dispose();
    assert.equal(harness.detachCount, 1);
  });

  it('counts UTF-8 heap snapshot chunks and removes its listener', async () => {
    const harness = createProtocolHarness(async method => {
      if (method === 'HeapProfiler.enable') return {};
      if (method === 'HeapProfiler.takeHeapSnapshot') {
        harness.emit('HeapProfiler.addHeapSnapshotChunk', {chunk: 'α'});
        harness.emit('HeapProfiler.addHeapSnapshotChunk', {chunk: 'bc'});
        return {};
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const chunks: string[] = [];
    const client = new V8InspectorClient(async () => harness.page);

    assert.equal(await client.takeHeapSnapshot(chunk => chunks.push(chunk)), 4);
    assert.deepEqual(chunks, ['α', 'bc']);

    harness.emit('HeapProfiler.addHeapSnapshotChunk', {chunk: 'ignored'});
    assert.deepEqual(chunks, ['α', 'bc']);
  });

  it('falls back from runtime object inspection to heap object lookup', async () => {
    const harness = createProtocolHarness(async method => {
      if (method === 'Runtime.getProperties') {
        throw new Error('not a runtime object id');
      }
      if (method === 'HeapProfiler.getObjectByHeapObjectId') {
        return {result: {type: 'object', description: 'HeapObject'}};
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const client = new V8InspectorClient(async () => harness.page);

    assert.deepEqual(await client.getObjectByObjectId('1:42'), {
      result: {type: 'object', description: 'HeapObject'},
    });
  });
});

describe('BytecodeExtractor', () => {
  it('extracts pseudo bytecode, hidden classes, and disassembles supported text', async () => {
    const source = [
      'function named(value) {',
      '  const object = {a: 1, b: 2, a: 3};',
      '  return value + 1;',
      '}',
    ].join('\n');
    const harness = createProtocolHarness(async method => {
      switch (method) {
        case 'Debugger.enable':
        case 'Debugger.disable':
        case 'Profiler.enable':
        case 'Profiler.startPreciseCoverage':
        case 'Profiler.stopPreciseCoverage':
        case 'Profiler.disable':
          return {};
        case 'Debugger.getScriptSource':
          return {scriptSource: source};
        case 'Profiler.takePreciseCoverage':
          return {
            result: [
              {
                scriptId: 'script-1',
                functions: [
                  {
                    functionName: 'named',
                    ranges: [{startOffset: 0, endOffset: source.length}],
                  },
                ],
              },
            ],
          };
        default:
          throw new Error(`Unexpected method: ${method}`);
      }
    });
    const extractor = new BytecodeExtractor(async () => harness.page);

    const extracted = await extractor.extractBytecode('script-1');
    assert.equal(extracted?.functionName, 'named');
    assert.match(extracted?.bytecode ?? '', /FunctionDeclaration/u);
    assert.match(extracted?.bytecode ?? '', /Return value \+ 1;/u);
    assert.deepEqual(await extractor.findHiddenClasses('script-1'), [
      {
        address: 'hidden-class-0',
        properties: ['a', 'b'],
        transitionMap: 'a -> b',
      },
    ]);
    assert.deepEqual(
      extractor.disassembleBytecode(
        '0 LoadLiteral value\n1 @ Return result\njunk',
      ),
      [
        {offset: 0, opcode: 'LoadLiteral', operands: ['value']},
        {offset: 1, opcode: 'Return', operands: ['result']},
      ],
    );
  });

  it('covers pseudo-bytecode inference and anonymous function-name fallback', async () => {
    const source = [
      'const handler = async (value) => value;',
      'return value;',
      'value => value + 1',
      'runTask(foo, bar)',
      'answer = compute()',
      'if (ready) proceed()',
      'while (keepGoing) spin()',
      '{ inline: true }',
      'value + 1',
    ].join('\n');
    const functionOffset = source.indexOf('handler');
    const harness = createProtocolHarness(async method => {
      if (
        method === 'Debugger.enable' ||
        method === 'Debugger.disable' ||
        method === 'Profiler.enable' ||
        method === 'Profiler.startPreciseCoverage' ||
        method === 'Profiler.stopPreciseCoverage' ||
        method === 'Profiler.disable'
      ) {
        return {};
      }
      if (method === 'Debugger.getScriptSource') {
        return {scriptSource: source};
      }
      if (method === 'Profiler.takePreciseCoverage') {
        return {
          result: [
            {
              scriptId: 'script-anonymous',
              functions: [
                {
                  functionName: 'anonymous',
                  ranges: [{startOffset: 0, endOffset: source.length}],
                },
              ],
            },
          ],
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const extractor = new BytecodeExtractor(async () => harness.page);

    const extracted = await extractor.extractBytecode(
      'script-anonymous',
      functionOffset,
    );

    assert.equal(extracted?.functionName, 'handler');
    assert.equal(extracted?.sourcePosition, functionOffset);
    assert.match(extracted?.bytecode ?? '', /CreateClosure/u);
    assert.match(extracted?.bytecode ?? '', /Return value;/u);
    assert.match(extracted?.bytecode ?? '', /Call runTask/u);
    assert.match(extracted?.bytecode ?? '', /Store answer, compute\(\)/u);
    assert.match(extracted?.bytecode ?? '', /JumpIfTrue/u);
    assert.match(extracted?.bytecode ?? '', /Loop/u);
    assert.match(extracted?.bytecode ?? '', /LoadLiteral/u);
    assert.match(extracted?.bytecode ?? '', /Evaluate value \+ 1/u);
  });

  it('returns null when the page cannot create a CDP session', async () => {
    const extractor = new BytecodeExtractor(async () => ({}));

    assert.equal(await extractor.extractBytecode('script-1'), null);
    assert.equal(
      await extractor.attemptNativeBytecodeExtraction('script-1'),
      null,
    );
    assert.deepEqual(await extractor.findHiddenClasses('script-1'), []);
  });

  it('reports native bytecode as unavailable without natives syntax', async () => {
    const source = 'function named() { return 1; }';
    const harness = createProtocolHarness(async method => {
      switch (method) {
        case 'Debugger.enable':
        case 'Debugger.disable':
        case 'Profiler.enable':
        case 'Profiler.startPreciseCoverage':
        case 'Profiler.stopPreciseCoverage':
        case 'Profiler.disable':
          return {};
        case 'Debugger.getScriptSource':
          return {scriptSource: source};
        case 'Profiler.takePreciseCoverage':
          return {
            result: [
              {
                scriptId: 'script-native-disabled',
                functions: [
                  {
                    functionName: 'named',
                    ranges: [{startOffset: 0, endOffset: source.length}],
                  },
                ],
              },
            ],
          };
        case 'Runtime.evaluate':
          return {result: {value: false}};
        default:
          throw new Error(`Unexpected method: ${method}`);
      }
    });
    const extractor = new BytecodeExtractor(async () => harness.page);

    const result = await extractor.attemptNativeBytecodeExtraction(
      'script-native-disabled',
    );

    assert.equal(result?.available, false);
    assert.equal(result?.supportsNativesSyntax, false);
    assert.match(result?.reason ?? '', /natives syntax/u);
  });

  it('returns native V8 disassembly when the runtime exposes it', async () => {
    const source = 'function named() { return 1; }';
    let runtimeEvaluateCount = 0;
    const harness = createProtocolHarness(async method => {
      switch (method) {
        case 'Debugger.enable':
        case 'Debugger.disable':
        case 'Profiler.enable':
        case 'Profiler.startPreciseCoverage':
        case 'Profiler.stopPreciseCoverage':
        case 'Profiler.disable':
          return {};
        case 'Debugger.getScriptSource':
          return {scriptSource: source};
        case 'Profiler.takePreciseCoverage':
          return {
            result: [
              {
                scriptId: 'script-native',
                functions: [
                  {
                    functionName: 'named',
                    ranges: [{startOffset: 0, endOffset: source.length}],
                  },
                ],
              },
            ],
          };
        case 'Runtime.evaluate':
          runtimeEvaluateCount += 1;
          return runtimeEvaluateCount === 1
            ? {result: {value: true}}
            : {
                result: {
                  value: {
                    disassembly: '0 @ LdaZero\n1 @ Return',
                    nativeSourcePosition: 0,
                  },
                },
              };
        default:
          throw new Error(`Unexpected method: ${method}`);
      }
    });
    const extractor = new BytecodeExtractor(async () => harness.page);

    assert.deepEqual(
      await extractor.attemptNativeBytecodeExtraction('script-native'),
      {
        available: true,
        bytecode: '0 @ LdaZero\n1 @ Return',
        format: 'v8-disassembly',
        functionName: 'named',
        rawIgnitionBytecodeAvailable: false,
        reason: 'Native V8 disassembly text returned via %DisassembleFunction',
        sourcePosition: 0,
        supportsNativesSyntax: true,
      },
    );
  });
});

describe('JITInspector', () => {
  it('maps native optimization status and caches the inspection result', async () => {
    const source = 'function hot(value) { return value + 1; }';
    let optimizationStatus: unknown = 81;
    const harness = createProtocolHarness(async (method, params) => {
      const expression =
        typeof params?.['expression'] === 'string' ? params['expression'] : '';
      switch (method) {
        case 'Debugger.enable':
        case 'Debugger.disable':
        case 'Profiler.enable':
        case 'Profiler.startPreciseCoverage':
        case 'Profiler.stopPreciseCoverage':
        case 'Profiler.disable':
          return {};
        case 'Debugger.getScriptSource':
          return {scriptSource: source};
        case 'Profiler.takePreciseCoverage':
          return {
            result: [
              {
                scriptId: 'script-hot',
                functions: [
                  {
                    functionName: 'hot',
                    ranges: [{startOffset: 0, endOffset: source.length}],
                  },
                ],
              },
            ],
          };
        case 'Runtime.evaluate':
          if (expression.includes('%HaveSameMap')) {
            return {result: {value: true}};
          }
          if (expression.includes('%GetOptimizationStatus')) {
            return {result: {value: optimizationStatus}};
          }
          if (expression.includes('%DeoptimizeFunction')) {
            return {result: {value: null}};
          }
          throw new Error(`Unexpected expression: ${expression}`);
        default:
          throw new Error(`Unexpected method: ${method}`);
      }
    });
    const inspector = new JITInspector(async () => harness.page);

    const result = await inspector.inspectJIT('script-hot');
    assert.deepEqual(result, {
      functions: [{functionName: 'hot', optimized: true, tier: 'turbofan'}],
      supportsNativesSyntax: true,
      inspectionMode: 'native-status',
    });
    assert.deepEqual(await inspector.getOptimizedFunctions(), result.functions);

    optimizationStatus = {status: 16, activeTier: 'maglev'};
    const activeTierResult = await new JITInspector(
      async () => harness.page,
    ).inspectJIT('script-hot');
    assert.equal(activeTierResult.functions[0]?.tier, 'maglev');

    await inspector.forceDeoptimization('hot');
    assert.ok(
      harness.calls.some(
        call =>
          call.method === 'Runtime.evaluate' &&
          String(call.params?.['expression']).includes('%DeoptimizeFunction'),
      ),
    );
  });
});
