/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {WasmArtifactStore} from '../../../../src/modules/wasm/WasmArtifactStore.js';
import type {WasmAnalyzer} from '../../../../src/modules/wasm/WasmAnalyzer.js';
import type {WasmRuntimeInspector} from '../../../../src/modules/wasm/WasmRuntimeInspector.js';
import type {ReverseTaskHandle} from '../../../../src/types/index.js';
import type {
  WasmAnalysisResult,
  WasmModuleRecord,
} from '../../../../src/modules/wasm/WasmTypes.js';

function makeTaskHandle(taskDir: string): ReverseTaskHandle {
  // Only taskDir is read by WasmArtifactStore; the rest are stubbed for type
  // compliance. Cast through unknown so the stub doesn't need to be exhaustive.
  return {taskDir} as unknown as ReverseTaskHandle;
}

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
      exports: [],
      memories: [],
      functionCount: 0,
      importFunctionCount: 0,
      exportFunctionCount: 0,
      tableCount: 0,
      globalCount: 0,
      dataSegmentCount: 0,
      typeCount: 0,
      codeBodyCount: 0,
      dataSegments: [],
      stringSlots: [],
      headerCandidates: [],
      keyMaterialCandidates: [],
      styleHints: [],
      purposeHints: [],
      riskTags: [],
      fingerprints: [],
      summaryLines: [],
    }),
  };
  return stub as WasmAnalyzer;
}

function makeRuntimeInspectorStub(): WasmRuntimeInspector {
  const stub = {
    buildBoundaryReport: () => '# Boundary Report\n\n(no content)',
    buildStructuredBoundaryArtifact: () => ({modules: [], chains: []}),
  };
  return stub as unknown as WasmRuntimeInspector;
}

function makeModule(id: string, hash: string): WasmModuleRecord {
  return {
    id,
    hash,
    size: 8,
    loadMethods: ['network'],
    firstSeenAt: 1,
    lastSeenAt: 2,
    imports: [],
    exports: [],
    memories: [],
    sections: [],
    runtimeModuleIds: [],
    origin: 'network',
    fingerprints: [],
    styleHints: [],
    riskTags: [],
    purposeHints: [],
  };
}

describe('WasmArtifactStore', () => {
  it('writes all expected artifacts to the task dir', async () => {
    const store = new WasmArtifactStore(
      makeAnalyzerStub(),
      makeRuntimeInspectorStub(),
    );
    const taskDir = await mkdtemp(path.join(tmpdir(), 'wasm-artifact-store-'));
    const task = makeTaskHandle(taskDir);
    const modules = [
      makeModule('wasm_aaaaaaaaaaaa', 'aaaa'),
      makeModule('wasm_bbbbbbbbbbbb', 'bbbb'),
    ];
    const bytesByModuleId = new Map<string, Uint8Array>([
      ['wasm_aaaaaaaaaaaa', Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0])],
      ['wasm_bbbbbbbbbbbb', Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0])],
    ]);

    try {
      const artifacts = await store.persistArtifacts(
        task,
        modules,
        [],
        bytesByModuleId,
        () => {},
      );

      assert.ok(artifacts);
      assert.strictEqual(artifacts.rootDir, path.join(taskDir, 'wasm'));
      assert.strictEqual(artifacts.binsDir, path.join(taskDir, 'wasm', 'bins'));
      assert.strictEqual(
        artifacts.analysisDir,
        path.join(taskDir, 'wasm', 'analysis'),
      );
      assert.strictEqual(
        artifacts.moduleIndexPath,
        path.join(taskDir, 'wasm', 'modules.json'),
      );
      assert.strictEqual(
        artifacts.runtimeEventsPath,
        path.join(taskDir, 'wasm', 'runtime-events.jsonl'),
      );
      assert.strictEqual(
        artifacts.importsExportsPath,
        path.join(taskDir, 'wasm', 'imports-exports.json'),
      );
      assert.strictEqual(
        artifacts.boundaryReportPath,
        path.join(taskDir, 'wasm', 'boundary-report.md'),
      );
      assert.strictEqual(
        artifacts.boundaryJsonPath,
        path.join(taskDir, 'wasm', 'boundary-report.json'),
      );

      const bins = await readdir(artifacts.binsDir!);
      assert.deepStrictEqual(bins.sort(), ['aaaa.wasm', 'bbbb.wasm']);

      const analysis = await readdir(artifacts.analysisDir!);
      assert.deepStrictEqual(analysis.sort(), ['aaaa.json', 'bbbb.json']);

      const moduleIndex = JSON.parse(
        await readFile(artifacts.moduleIndexPath!, 'utf8'),
      ) as Array<WasmModuleRecord>;
      assert.strictEqual(moduleIndex.length, 2);
      assert.ok(moduleIndex.every(m => m.base64 === undefined));

      const importsExports = JSON.parse(
        await readFile(artifacts.importsExportsPath!, 'utf8'),
      ) as Array<{id: string}>;
      assert.strictEqual(importsExports.length, 2);

      const boundaryReport = await readFile(
        artifacts.boundaryReportPath!,
        'utf8',
      );
      assert.ok(boundaryReport.includes('Boundary Report'));

      const boundaryJson = JSON.parse(
        await readFile(artifacts.boundaryJsonPath!, 'utf8'),
      );
      assert.ok(boundaryJson.chains);
    } finally {
      await rm(taskDir, {recursive: true, force: true});
    }
  });

  it('invokes onArtifactPath for each persisted binary', async () => {
    const store = new WasmArtifactStore(
      makeAnalyzerStub(),
      makeRuntimeInspectorStub(),
    );
    const taskDir = await mkdtemp(
      path.join(tmpdir(), 'wasm-artifact-store-cb-'),
    );
    const task = makeTaskHandle(taskDir);
    const modules = [makeModule('wasm_cccccccccccc', 'cccc')];
    const bytesByModuleId = new Map<string, Uint8Array>([
      ['wasm_cccccccccccc', Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0])],
    ]);
    const updates: Array<{moduleId: string; path: string}> = [];

    try {
      await store.persistArtifacts(
        task,
        modules,
        [],
        bytesByModuleId,
        (moduleId, p) => updates.push({moduleId, path: p}),
      );

      assert.strictEqual(updates.length, 1);
      assert.strictEqual(updates[0].moduleId, 'wasm_cccccccccccc');
      assert.ok(
        updates[0].path.endsWith('cccc.wasm'),
        `expected path to end with cccc.wasm, got ${updates[0].path}`,
      );
    } finally {
      await rm(taskDir, {recursive: true, force: true});
    }
  });

  it('skips modules without bytes in the bytesByModuleId map', async () => {
    const store = new WasmArtifactStore(
      makeAnalyzerStub(),
      makeRuntimeInspectorStub(),
    );
    const taskDir = await mkdtemp(path.join(tmpdir(), 'wasm-artifact-skip-'));
    const task = makeTaskHandle(taskDir);
    const modules = [
      makeModule('wasm_dddddddddddd', 'dddd'),
      makeModule('wasm_eeeeeeeeeeee', 'eeee'),
    ];
    const bytesByModuleId = new Map<string, Uint8Array>([
      ['wasm_dddddddddddd', Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0])],
    ]);
    const updates: string[] = [];

    try {
      await store.persistArtifacts(
        task,
        modules,
        [],
        bytesByModuleId,
        moduleId => updates.push(moduleId),
      );

      assert.deepStrictEqual(updates, ['wasm_dddddddddddd']);
      const bins = await readdir(path.join(taskDir, 'wasm', 'bins'));
      assert.deepStrictEqual(bins, ['dddd.wasm']);
    } finally {
      await rm(taskDir, {recursive: true, force: true});
    }
  });

  it('serializes runtime events as JSONL', async () => {
    const store = new WasmArtifactStore(
      makeAnalyzerStub(),
      makeRuntimeInspectorStub(),
    );
    const taskDir = await mkdtemp(path.join(tmpdir(), 'wasm-artifact-jsonl-'));
    const task = makeTaskHandle(taskDir);
    const modules: WasmModuleRecord[] = [];
    const bytesByModuleId = new Map<string, Uint8Array>();
    const events = [
      {
        id: 'e1',
        type: 'instantiate' as const,
        timestamp: 1,
        runtimeModuleId: 'r1',
      },
      {
        id: 'e2',
        type: 'export_call' as const,
        timestamp: 2,
        runtimeModuleId: 'r1',
        exportName: 'add',
      },
    ];

    try {
      const artifacts = await store.persistArtifacts(
        task,
        modules,
        events,
        bytesByModuleId,
        () => {},
      );

      const contents = await readFile(artifacts.runtimeEventsPath!, 'utf8');
      const lines = contents.trimEnd().split('\n');
      assert.strictEqual(lines.length, 2);
      const first = JSON.parse(lines[0]) as {id: string};
      assert.strictEqual(first.id, 'e1');
    } finally {
      await rm(taskDir, {recursive: true, force: true});
    }
  });
});
