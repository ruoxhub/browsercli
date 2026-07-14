/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import type {ReverseTaskHandle} from '../../types/index.js';

import type {WasmAnalyzer} from './WasmAnalyzer.js';
import type {WasmRuntimeInspector} from './WasmRuntimeInspector.js';
import type {
  WasmDetectionResult,
  WasmModuleRecord,
  WasmRuntimeEvent,
} from './WasmTypes.js';

/**
 * Wasm artifact persistence — 将收集的 Wasm 模块写入文件系统。
 *
 * 提取自 WasmCollector.ts。负责：
 *  - 在 task.taskDir/wasm/ 下创建 bins/ 和 analysis/ 子目录
 *  - 写入每个模块的 .wasm 二进制和对应的分析 JSON
 *  - 写入 modules.json / runtime-events.jsonl / imports-exports.json
 *  - 写入 boundary-report.md / boundary-report.json
 *  - 通过 onArtifactPath 回调将每个模块的产物路径回传给调用方
 */
export class WasmArtifactStore {
  constructor(
    private readonly analyzer: WasmAnalyzer,
    private readonly runtimeInspector: WasmRuntimeInspector,
  ) {}

  async persistArtifacts(
    task: ReverseTaskHandle,
    modules: WasmModuleRecord[],
    runtimeEvents: WasmRuntimeEvent[],
    bytesByModuleId: Map<string, Uint8Array>,
    onArtifactPath: (moduleId: string, artifactPath: string) => void,
  ): Promise<WasmDetectionResult['artifacts']> {
    const rootDir = path.join(task.taskDir, 'wasm');
    const binsDir = path.join(rootDir, 'bins');
    const analysisDir = path.join(rootDir, 'analysis');
    const moduleIndexPath = path.join(rootDir, 'modules.json');
    const runtimeEventsPath = path.join(rootDir, 'runtime-events.jsonl');
    const importsExportsPath = path.join(rootDir, 'imports-exports.json');
    const boundaryReportPath = path.join(rootDir, 'boundary-report.md');
    const boundaryJsonPath = path.join(rootDir, 'boundary-report.json');

    await mkdir(binsDir, {recursive: true});
    await mkdir(analysisDir, {recursive: true});

    for (const module of modules) {
      const bytes = bytesByModuleId.get(module.id);
      if (!bytes) {
        continue;
      }

      const binPath = path.join(binsDir, `${module.hash}.wasm`);
      const analysisPath = path.join(analysisDir, `${module.hash}.json`);
      const analysis = this.analyzer.analyzeRecord(
        {
          id: module.id,
          hash: module.hash,
          size: module.size,
        },
        bytes,
        {
          includeFunctionSignatures: true,
        },
      );

      await writeFile(binPath, Buffer.from(bytes));
      await writeFile(
        analysisPath,
        `${JSON.stringify(analysis, null, 2)}\n`,
        'utf8',
      );
      onArtifactPath(module.id, binPath);
    }

    const boundaryReport = this.runtimeInspector.buildBoundaryReport(
      modules,
      runtimeEvents,
    );
    const boundaryJson = this.runtimeInspector.buildStructuredBoundaryArtifact(
      modules,
      runtimeEvents,
    );
    await writeFile(
      moduleIndexPath,
      `${JSON.stringify(
        modules.map(module => ({...module, base64: undefined})),
        null,
        2,
      )}\n`,
      'utf8',
    );
    await writeFile(
      runtimeEventsPath,
      runtimeEvents.map(event => JSON.stringify(event)).join('\n') +
        (runtimeEvents.length > 0 ? '\n' : ''),
      'utf8',
    );
    await writeFile(
      importsExportsPath,
      `${JSON.stringify(
        modules.map(module => ({
          id: module.id,
          hash: module.hash,
          imports: module.imports,
          exports: module.exports,
          memories: module.memories,
        })),
        null,
        2,
      )}\n`,
      'utf8',
    );
    await writeFile(boundaryReportPath, `${boundaryReport}\n`, 'utf8');
    await writeFile(
      boundaryJsonPath,
      `${JSON.stringify(boundaryJson, null, 2)}\n`,
      'utf8',
    );

    return {
      rootDir,
      moduleIndexPath,
      runtimeEventsPath,
      importsExportsPath,
      boundaryReportPath,
      boundaryJsonPath,
      binsDir,
      analysisDir,
    };
  }
}
