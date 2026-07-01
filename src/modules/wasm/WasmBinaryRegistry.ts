/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {createHash} from 'node:crypto';

import type {WasmAnalyzer} from './WasmAnalyzer.js';
import type {
  WasmLoadMethod,
  WasmModuleRecord,
  WasmRuntimeEvent,
} from './WasmTypes.js';

export interface RegisterBinaryOptions {
  sourceUrl?: string;
  contentType?: string;
  loadMethod: WasmLoadMethod;
  timestamp: number;
  runtimeModuleId?: string;
  source: 'network' | 'runtime';
  captureBase64?: boolean;
}

function uniqueValues<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function createWasmHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function createModuleId(hash: string): string {
  return `wasm_${hash.slice(0, 12)}`;
}

function mergeOrigin(
  current: WasmModuleRecord['origin'],
  incoming: WasmModuleRecord['origin'],
): WasmModuleRecord['origin'] {
  if (current === incoming) {
    return current;
  }
  return 'hybrid';
}

function sortModules(modules: WasmModuleRecord[]): WasmModuleRecord[] {
  return [...modules].sort(
    (a, b) => b.lastSeenAt - a.lastSeenAt || a.id.localeCompare(b.id),
  );
}

function cloneModuleRecord(record: WasmModuleRecord): WasmModuleRecord {
  return {
    ...record,
    loadMethods: [...record.loadMethods],
    imports: record.imports.map(entry => ({...entry})),
    exports: record.exports.map(entry => ({...entry})),
    memories: record.memories.map(entry => ({...entry})),
    sections: record.sections.map(entry => ({...entry})),
    runtimeModuleIds: [...record.runtimeModuleIds],
    fingerprints: record.fingerprints.map(entry => ({...entry})),
    styleHints: [...record.styleHints],
    riskTags: [...record.riskTags],
    purposeHints: [...record.purposeHints],
  };
}

/**
 * Wasm binary registry — 模块 ID、二进制数据和哈希值之间的映射管理。
 *
 * 提取自 WasmCollector.ts。持有 modulesById / moduleIdsByHash / bytesByModuleId
 * 三张映射表，并负责：
 *  - registerBinary: 注册新模块或合并已存在模块
 *  - applyExportCallCounts: 根据 runtime events 更新导出调用计数
 *  - 公共 getter: 返回克隆后的模块记录，避免外部修改内部状态
 */
export class WasmBinaryRegistry {
  readonly modulesById = new Map<string, WasmModuleRecord>();
  readonly moduleIdsByHash = new Map<string, string>();
  readonly bytesByModuleId = new Map<string, Uint8Array>();

  constructor(private readonly analyzer: WasmAnalyzer) {}

  registerBinary(
    bytes: Uint8Array,
    options: RegisterBinaryOptions,
  ): WasmModuleRecord {
    const hash = createWasmHash(bytes);
    const existingId = this.moduleIdsByHash.get(hash);
    const base64 = options.captureBase64
      ? Buffer.from(bytes).toString('base64')
      : undefined;

    if (existingId) {
      const existing = this.modulesById.get(existingId);
      if (!existing) {
        throw new Error(`Wasm module index is inconsistent for ${existingId}`);
      }
      const nextRuntimeIds = options.runtimeModuleId
        ? uniqueValues([...existing.runtimeModuleIds, options.runtimeModuleId])
        : existing.runtimeModuleIds;
      const updated: WasmModuleRecord = {
        ...existing,
        lastSeenAt: Math.max(existing.lastSeenAt, options.timestamp),
        loadMethods: uniqueValues([
          ...existing.loadMethods,
          options.loadMethod,
        ]),
        origin: mergeOrigin(existing.origin, options.source),
        sourceUrl: existing.sourceUrl ?? options.sourceUrl,
        contentType: existing.contentType ?? options.contentType,
        runtimeModuleIds: nextRuntimeIds,
        base64: existing.base64 ?? base64,
      };
      this.modulesById.set(updated.id, updated);
      return updated;
    }

    const id = createModuleId(hash);
    const analysis = this.analyzer.analyzeRecord(
      {
        id,
        hash,
        size: bytes.byteLength,
      },
      bytes,
      {
        includeFunctionSignatures: true,
      },
    );

    const record: WasmModuleRecord = {
      id,
      hash,
      size: bytes.byteLength,
      sourceUrl: options.sourceUrl,
      contentType: options.contentType,
      loadMethods: [options.loadMethod],
      firstSeenAt: options.timestamp,
      lastSeenAt: options.timestamp,
      imports: analysis.imports,
      exports: analysis.exports,
      memories: analysis.memories,
      sections: analysis.sections,
      runtimeModuleIds: options.runtimeModuleId
        ? [options.runtimeModuleId]
        : [],
      origin: options.source,
      base64,
      artifactPath: undefined,
      fingerprints: analysis.fingerprints,
      styleHints: analysis.styleHints,
      riskTags: analysis.riskTags,
      purposeHints: analysis.purposeHints,
    };

    this.modulesById.set(id, record);
    this.moduleIdsByHash.set(hash, id);
    this.bytesByModuleId.set(id, Uint8Array.from(bytes));
    return record;
  }

  /**
   * 根据 runtime events 中的 export_call 事件回填每个模块导出的 callCount。
   * 直接修改 modulesById 中的记录。
   */
  applyExportCallCounts(runtimeEvents: WasmRuntimeEvent[]): void {
    const counts = new Map<string, number>();
    for (const event of runtimeEvents) {
      if (
        event.type !== 'export_call' ||
        !event.moduleId ||
        !event.exportName
      ) {
        continue;
      }
      const key = `${event.moduleId}::${event.exportName}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    for (const record of this.modulesById.values()) {
      const updatedExports = record.exports.map(entry => ({
        ...entry,
        callCount:
          counts.get(`${record.id}::${entry.name}`) ?? entry.callCount ?? 0,
      }));
      this.modulesById.set(record.id, {...record, exports: updatedExports});
    }
  }

  /**
   * 返回按 lastSeenAt 倒序的所有模块记录的克隆。外部修改不会影响内部状态。
   */
  getModules(): WasmModuleRecord[] {
    return sortModules(Array.from(this.modulesById.values())).map(module =>
      cloneModuleRecord(module),
    );
  }

  getModuleById(moduleId: string): WasmModuleRecord | undefined {
    const record = this.modulesById.get(moduleId);
    return record ? cloneModuleRecord(record) : undefined;
  }

  getModuleBytes(moduleId: string): Uint8Array | undefined {
    const bytes = this.bytesByModuleId.get(moduleId);
    return bytes ? Uint8Array.from(bytes) : undefined;
  }
}
