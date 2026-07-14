/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {WasmAnalyzer} from '../../../../src/modules/wasm/WasmAnalyzer.js';
import {WasmBinaryRegistry} from '../../../../src/modules/wasm/WasmBinaryRegistry.js';
import type {
  WasmAnalysisResult,
  WasmModuleRecord,
  WasmRuntimeEvent,
} from '../../../../src/modules/wasm/WasmTypes.js';

function makeAnalyzerStub(): WasmAnalyzer {
  const stub: Pick<WasmAnalyzer, 'analyzeRecord'> = {
    analyzeRecord: (
      record: Pick<WasmModuleRecord, 'id' | 'hash' | 'size'>,
    ): WasmAnalysisResult => ({
      moduleId: record.id,
      hash: record.hash,
      size: record.size,
      sections: [],
      imports: [],
      exports: [
        {
          name: 'add',
          kind: 'function',
          index: 0,
          params: ['i32', 'i32'],
          results: ['i32'],
        },
        {name: 'memory', kind: 'memory', index: 0},
      ],
      memories: [{minPages: 1, exportedName: 'memory'}],
      functionCount: 1,
      importFunctionCount: 0,
      exportFunctionCount: 1,
      tableCount: 0,
      globalCount: 0,
      dataSegmentCount: 0,
      typeCount: 1,
      codeBodyCount: 1,
      dataSegments: [],
      stringSlots: [],
      headerCandidates: [],
      keyMaterialCandidates: [],
      styleHints: ['test-style'],
      purposeHints: [],
      riskTags: [],
      fingerprints: [],
      summaryLines: [],
    }),
  };
  return stub as WasmAnalyzer;
}

function makeWasmBytes(): Uint8Array {
  // magic \0asm + version 1.0.0.0 — enough to be a recognisable wasm header.
  return Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
}

describe('WasmBinaryRegistry', () => {
  it('registers a new binary and exposes it via getters', () => {
    const registry = new WasmBinaryRegistry(makeAnalyzerStub());
    const bytes = makeWasmBytes();
    const now = Date.now();

    const record = registry.registerBinary(bytes, {
      loadMethod: 'network',
      timestamp: now,
      source: 'network',
      sourceUrl: 'https://example.com/m.wasm',
      contentType: 'application/wasm',
    });

    assert.ok(record.id.startsWith('wasm_'));
    assert.strictEqual(record.size, bytes.byteLength);
    assert.strictEqual(record.origin, 'network');
    assert.strictEqual(record.loadMethods.length, 1);
    assert.strictEqual(record.loadMethods[0], 'network');
    assert.strictEqual(record.firstSeenAt, now);
    assert.strictEqual(record.lastSeenAt, now);

    const modules = registry.getModules();
    assert.strictEqual(modules.length, 1);
    assert.strictEqual(modules[0].id, record.id);

    const byId = registry.getModuleById(record.id);
    assert.ok(byId, 'getModuleById should return the record');
    assert.strictEqual(byId!.id, record.id);

    const fetched = registry.getModuleBytes(record.id);
    assert.ok(fetched, 'getModuleBytes should return bytes');
    assert.strictEqual(fetched!.byteLength, bytes.byteLength);
  });

  it('deduplicates binaries by hash and merges metadata', () => {
    const registry = new WasmBinaryRegistry(makeAnalyzerStub());
    const bytes = makeWasmBytes();
    const t1 = 1000;
    const t2 = 2000;

    const first = registry.registerBinary(bytes, {
      loadMethod: 'network',
      timestamp: t1,
      source: 'network',
      sourceUrl: 'https://example.com/a.wasm',
    });
    const second = registry.registerBinary(bytes, {
      loadMethod: 'instantiate',
      timestamp: t2,
      source: 'runtime',
      runtimeModuleId: 'rt-1',
    });

    assert.strictEqual(first.id, second.id, 'same hash → same module id');
    assert.strictEqual(registry.getModules().length, 1);

    const merged = registry.getModuleById(second.id)!;
    assert.strictEqual(merged.origin, 'hybrid');
    assert.deepStrictEqual(merged.loadMethods.sort(), [
      'instantiate',
      'network',
    ]);
    assert.strictEqual(merged.lastSeenAt, t2);
    assert.strictEqual(merged.firstSeenAt, t1);
    assert.deepStrictEqual(merged.runtimeModuleIds, ['rt-1']);
  });

  it('returns defensive copies from getters', () => {
    const registry = new WasmBinaryRegistry(makeAnalyzerStub());
    const bytes = makeWasmBytes();

    const record = registry.registerBinary(bytes, {
      loadMethod: 'network',
      timestamp: 1,
      source: 'network',
    });

    const a = registry.getModuleById(record.id)!;
    const b = registry.getModuleById(record.id)!;
    assert.notStrictEqual(a, b, 'getModuleById should return fresh clones');
    a.loadMethods.push('instantiate' as never);
    assert.strictEqual(
      registry.getModuleById(record.id)!.loadMethods.length,
      1,
      'mutation of returned record should not affect registry state',
    );

    const bytesA = registry.getModuleBytes(record.id)!;
    const bytesB = registry.getModuleBytes(record.id)!;
    assert.notStrictEqual(bytesA, bytesB, 'getModuleBytes should copy');
    bytesA[0] = 0xff;
    assert.strictEqual(
      registry.getModuleBytes(record.id)![0],
      0x00,
      'mutation of returned bytes should not affect registry state',
    );
  });

  it('applyExportCallCounts updates export callCount from runtime events', () => {
    const registry = new WasmBinaryRegistry(makeAnalyzerStub());
    const bytes = makeWasmBytes();

    const record = registry.registerBinary(bytes, {
      loadMethod: 'instantiate',
      timestamp: 1,
      source: 'runtime',
      runtimeModuleId: 'rt-1',
    });

    const events: WasmRuntimeEvent[] = [
      {
        id: 'e1',
        type: 'export_call',
        timestamp: 1,
        moduleId: record.id,
        runtimeModuleId: 'rt-1',
        exportName: 'add',
      },
      {
        id: 'e2',
        type: 'export_call',
        timestamp: 2,
        moduleId: record.id,
        runtimeModuleId: 'rt-1',
        exportName: 'add',
      },
      {
        id: 'e3',
        type: 'export_call',
        timestamp: 3,
        moduleId: record.id,
        runtimeModuleId: 'rt-1',
        exportName: 'memory',
      },
      {
        id: 'e4',
        type: 'instantiate',
        timestamp: 4,
        runtimeModuleId: 'rt-1',
      },
    ];

    registry.applyExportCallCounts(events);

    const updated = registry.getModuleById(record.id)!;
    const addExport = updated.exports.find(e => e.name === 'add');
    const memoryExport = updated.exports.find(e => e.name === 'memory');
    assert.strictEqual(addExport?.callCount, 2);
    assert.strictEqual(memoryExport?.callCount, 1);
  });

  it('applyExportCallCounts ignores events for unknown modules', () => {
    const registry = new WasmBinaryRegistry(makeAnalyzerStub());
    registry.registerBinary(makeWasmBytes(), {
      loadMethod: 'network',
      timestamp: 1,
      source: 'network',
    });

    const events: WasmRuntimeEvent[] = [
      {
        id: 'e1',
        type: 'export_call',
        timestamp: 1,
        moduleId: 'wasm_unknown',
        exportName: 'add',
      },
    ];

    registry.applyExportCallCounts(events);
    const modules = registry.getModules();
    assert.strictEqual(modules.length, 1);
    // callCount falls back to existing value (undefined → 0)
    const addExport = modules[0].exports.find(e => e.name === 'add');
    assert.strictEqual(addExport?.callCount, 0);
  });

  it('returns undefined for unknown module lookups', () => {
    const registry = new WasmBinaryRegistry(makeAnalyzerStub());
    assert.strictEqual(registry.getModuleById('nope'), undefined);
    assert.strictEqual(registry.getModuleBytes('nope'), undefined);
    assert.deepStrictEqual(registry.getModules(), []);
  });
});
