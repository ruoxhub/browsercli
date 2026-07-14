/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ByteReader,
  decodeExternalKind,
  decodeValueType,
  extractPrintableRuns,
  type ParsedModule,
  type ParsedTypeEntry,
  readInitExpr,
  readLimits,
  sectionName,
  uniqueStrings,
} from './WasmAnalysisUtils.js';
import type {
  WasmAnalysisOptions,
  WasmAnalysisResult,
  WasmDataSegmentSummary,
  WasmExportEntry,
  WasmFunctionFingerprint,
  WasmImportEntry,
  WasmMemoryInfo,
  WasmModuleRecord,
  WasmSectionSummary,
  WasmValueType,
} from './WasmTypes.js';

export class WasmAnalyzer {
  analyzeRecord(
    record: Pick<WasmModuleRecord, 'id' | 'hash' | 'size'>,
    bytes: Uint8Array,
    options: WasmAnalysisOptions = {},
  ): WasmAnalysisResult {
    const parsed = this.parseModule(bytes, options);
    const styleHints = this.detectStyleHints(parsed);
    const purposeHints = this.detectPurposeHints(parsed);
    const riskTags = this.detectRiskTags(parsed);
    const fingerprints = this.buildFingerprints(
      styleHints,
      purposeHints,
      parsed,
    );

    return {
      moduleId: record.id,
      hash: record.hash,
      size: record.size,
      sections: parsed.sections,
      imports: parsed.imports,
      exports: parsed.exports,
      memories: parsed.memories,
      functionCount: parsed.functionCount,
      importFunctionCount: parsed.importFunctionCount,
      exportFunctionCount: parsed.exportFunctionCount,
      tableCount: parsed.tableCount,
      globalCount: parsed.globalCount,
      dataSegmentCount: parsed.dataSegmentCount,
      typeCount: parsed.typeCount,
      codeBodyCount: parsed.codeBodyCount,
      startFunctionIndex: parsed.startFunctionIndex,
      dataSegments: parsed.dataSegments,
      stringSlots: parsed.stringSlots,
      headerCandidates: parsed.headerCandidates,
      keyMaterialCandidates: parsed.keyMaterialCandidates,
      styleHints,
      purposeHints,
      riskTags,
      fingerprints,
      summaryLines: this.buildSummaryLines(
        parsed,
        styleHints,
        purposeHints,
        riskTags,
        options,
      ),
    };
  }

  analyzeBinary(
    bytes: Uint8Array,
    options: WasmAnalysisOptions = {},
  ): Omit<WasmAnalysisResult, 'moduleId' | 'hash' | 'size'> {
    const {
      moduleId: _moduleId,
      hash: _hash,
      size: _size,
      ...rest
    } = this.analyzeRecord(
      {
        id: 'inline-wasm',
        hash: 'inline-wasm',
        size: bytes.byteLength,
      },
      bytes,
      options,
    );
    return rest;
  }

  private parseModule(
    bytes: Uint8Array,
    options: WasmAnalysisOptions,
  ): ParsedModule {
    if (bytes.byteLength < 8) {
      throw new Error('Wasm binary is too small');
    }
    const header = Array.from(bytes.slice(0, 4));
    if (header.join(',') !== '0,97,115,109') {
      throw new Error('Invalid Wasm magic header');
    }
    const version = Array.from(bytes.slice(4, 8));
    if (version.join(',') !== '1,0,0,0') {
      throw new Error('Unsupported Wasm binary version');
    }

    const reader = new ByteReader(bytes.slice(8));
    const sections: WasmSectionSummary[] = [];
    const types: ParsedTypeEntry[] = [];
    const functionTypeIndexes: number[] = [];
    const imports: WasmImportEntry[] = [];
    const exports: WasmExportEntry[] = [];
    const memories: WasmMemoryInfo[] = [];
    const dataSegments: WasmDataSegmentSummary[] = [];

    let importFunctionCount = 0;
    let tableCount = 0;
    let globalCount = 0;
    let dataSegmentCount = 0;
    let codeBodyCount = 0;
    let startFunctionIndex: number | undefined;

    while (reader.remaining > 0) {
      const sectionId = reader.readByte();
      const payloadSize = reader.readVarUint32();
      const payloadOffset = reader.position;
      const payload = new ByteReader(reader.readBytes(payloadSize));

      let count: number | undefined;
      let customName: string | undefined;

      switch (sectionId) {
        case 0: {
          if (payload.remaining > 0) {
            customName = payload.readUtf8String();
          }
          break;
        }
        case 1: {
          count = payload.readVarUint32();
          for (let i = 0; i < count; i += 1) {
            const form = payload.readByte();
            if (form !== 0x60) {
              throw new Error(
                `Unsupported Wasm type form: 0x${form.toString(16)}`,
              );
            }
            const paramCount = payload.readVarUint32();
            const params = Array.from({length: paramCount}, () =>
              decodeValueType(payload.readByte()),
            );
            const resultCount = payload.readVarUint32();
            const results = Array.from({length: resultCount}, () =>
              decodeValueType(payload.readByte()),
            );
            types.push({params, results});
          }
          break;
        }
        case 2: {
          count = payload.readVarUint32();
          for (let i = 0; i < count; i += 1) {
            const moduleName = payload.readUtf8String();
            const name = payload.readUtf8String();
            const kind = decodeExternalKind(payload.readByte());
            if (kind === 'function') {
              const typeIndex = payload.readVarUint32();
              const signature = types[typeIndex];
              imports.push({
                module: moduleName,
                name,
                kind,
                typeIndex,
                params:
                  options.includeFunctionSignatures === false
                    ? undefined
                    : (signature?.params ?? []),
                results:
                  options.includeFunctionSignatures === false
                    ? undefined
                    : (signature?.results ?? []),
              });
              importFunctionCount += 1;
            } else if (kind === 'table') {
              payload.readByte();
              const limits = readLimits(payload);
              imports.push({module: moduleName, name, kind, limits});
              tableCount += 1;
            } else if (kind === 'memory') {
              const limits = readLimits(payload);
              imports.push({module: moduleName, name, kind, limits});
              memories.push({
                minPages: limits.min,
                maxPages: limits.max,
                shared: limits.shared,
                exportedName: name,
              });
            } else if (kind === 'global') {
              const valueType = decodeValueType(payload.readByte());
              const mutable = payload.readByte() === 0x01;
              imports.push({
                module: moduleName,
                name,
                kind,
                valueType,
                mutable,
              });
              globalCount += 1;
            } else if (kind === 'tag') {
              payload.readByte();
              const typeIndex = payload.readVarUint32();
              imports.push({module: moduleName, name, kind, typeIndex});
            }
          }
          break;
        }
        case 3: {
          count = payload.readVarUint32();
          for (let i = 0; i < count; i += 1) {
            functionTypeIndexes.push(payload.readVarUint32());
          }
          break;
        }
        case 4: {
          count = payload.readVarUint32();
          tableCount += count;
          break;
        }
        case 5: {
          count = payload.readVarUint32();
          for (let i = 0; i < count; i += 1) {
            const limits = readLimits(payload);
            memories.push({
              minPages: limits.min,
              maxPages: limits.max,
              shared: limits.shared,
            });
          }
          break;
        }
        case 6: {
          count = payload.readVarUint32();
          globalCount += count;
          break;
        }
        case 7: {
          count = payload.readVarUint32();
          for (let i = 0; i < count; i += 1) {
            const name = payload.readUtf8String();
            const kind = decodeExternalKind(payload.readByte());
            const index = payload.readVarUint32();
            if (kind === 'memory') {
              const memory = memories[index] ?? {minPages: 0};
              memory.exportedName = name;
              memories[index] = memory;
            }
            let params: WasmValueType[] | undefined;
            let results: WasmValueType[] | undefined;
            if (
              kind === 'function' &&
              options.includeFunctionSignatures !== false
            ) {
              const localIndex = index - importFunctionCount;
              const typeIndex =
                localIndex >= 0
                  ? functionTypeIndexes[localIndex]
                  : imports[index]?.typeIndex;
              const signature =
                typeof typeIndex === 'number' ? types[typeIndex] : undefined;
              params = signature?.params ?? [];
              results = signature?.results ?? [];
            }
            exports.push({name, kind, index, params, results});
          }
          break;
        }
        case 8: {
          startFunctionIndex = payload.readVarUint32();
          count = 1;
          break;
        }
        case 9: {
          count = payload.readVarUint32();
          break;
        }
        case 10: {
          count = payload.readVarUint32();
          codeBodyCount = count;
          break;
        }
        case 11: {
          count = payload.readVarUint32();
          dataSegmentCount = count;
          for (let index = 0; index < count; index += 1) {
            const flag = payload.readVarUint32();
            let mode:
              | 'active'
              | 'passive'
              | 'active-with-memory-index'
              | 'unknown' = 'unknown';
            let offset: number | undefined;
            if (flag === 0) {
              mode = 'active';
              offset = readInitExpr(payload).offset;
            } else if (flag === 1) {
              mode = 'passive';
            } else if (flag === 2) {
              mode = 'active-with-memory-index';
              payload.readVarUint32();
              offset = readInitExpr(payload).offset;
            }
            const size = payload.readVarUint32();
            const segmentBytes = payload.readBytes(size);
            const stringSlots =
              options.includeStringScan === false
                ? []
                : extractPrintableRuns(segmentBytes, {
                    source: 'data-segment',
                    segmentIndex: index,
                    startOffset: offset ?? 0,
                    maskSensitiveStrings:
                      options.maskSensitiveStrings !== false,
                    maxStringSlots: options.maxStringSlots,
                  });
            dataSegments.push({
              index,
              mode,
              size,
              offset,
              stringSlots,
            });
          }
          break;
        }
        case 12: {
          count = payload.readVarUint32();
          dataSegmentCount = count;
          break;
        }
        case 13: {
          count = payload.readVarUint32();
          break;
        }
        default:
          break;
      }

      sections.push({
        id: sectionId,
        name: sectionName(sectionId, customName),
        size: payloadSize,
        count,
        offset: payloadOffset + 8,
      });
    }

    const exportFunctionCount = exports.filter(
      entry => entry.kind === 'function',
    ).length;
    const dataStringSlots = dataSegments.flatMap(
      segment => segment.stringSlots,
    );
    const binaryStringSlots =
      options.includeStringScan === false
        ? []
        : extractPrintableRuns(bytes, {
            source: 'binary-run',
            startOffset: 0,
            maskSensitiveStrings: options.maskSensitiveStrings !== false,
            maxStringSlots:
              typeof options.maxStringSlots === 'number'
                ? options.maxStringSlots * 2
                : undefined,
          }).filter(
            slot =>
              !dataStringSlots.some(
                existing =>
                  existing.value === slot.value &&
                  existing.offset === slot.offset,
              ),
          );
    const stringSlots = [...dataStringSlots, ...binaryStringSlots]
      .sort((a, b) => a.offset - b.offset)
      .slice(
        0,
        options.maxStringSlots && options.maxStringSlots > 0
          ? options.maxStringSlots
          : undefined,
      );
    const headerCandidates = stringSlots.filter(
      slot => slot.category === 'header-like' || slot.category === 'url-like',
    );
    const keyMaterialCandidates = stringSlots.filter(
      slot =>
        slot.category === 'key-material' ||
        slot.category === 'base64-like' ||
        slot.category === 'hex-like',
    );
    return {
      sections,
      imports,
      exports,
      memories,
      typeCount: types.length,
      functionCount: importFunctionCount + functionTypeIndexes.length,
      importFunctionCount,
      exportFunctionCount,
      tableCount,
      globalCount,
      dataSegmentCount,
      codeBodyCount,
      dataSegments,
      stringSlots,
      headerCandidates,
      keyMaterialCandidates,
      startFunctionIndex,
    };
  }

  private detectStyleHints(parsed: ParsedModule): string[] {
    const importNames = parsed.imports.map(
      item => `${item.module}.${item.name}`,
    );
    const exportNames = parsed.exports.map(item => item.name);

    const hints: string[] = [];
    if (
      importNames.some(value => value.startsWith('wbg.')) ||
      exportNames.some(value => value.startsWith('__wbindgen_'))
    ) {
      hints.push('Rust + wasm-bindgen glue');
    }
    if (
      exportNames.some(value =>
        [
          '_malloc',
          '_free',
          'stackSave',
          'stackAlloc',
          'stackRestore',
        ].includes(value),
      ) ||
      importNames.some(
        value =>
          value.includes('__memory_base') || value.includes('__table_base'),
      )
    ) {
      hints.push('Emscripten-style runtime');
    }
    if (exportNames.some(value => ['run', 'resume', 'getsp'].includes(value))) {
      hints.push('TinyGo-style runtime');
    }
    if (
      exportNames.some(value =>
        ['__new', '__pin', '__unpin', '__collect'].includes(value),
      )
    ) {
      hints.push('AssemblyScript-style runtime');
    }
    if (parsed.imports.length >= 8) {
      hints.push('Host bridge is relatively heavy');
    }
    return uniqueStrings(hints);
  }

  private detectPurposeHints(parsed: ParsedModule): string[] {
    const names = [
      ...parsed.imports.map(item => `${item.module}.${item.name}`),
      ...parsed.exports.map(item => item.name),
      ...parsed.headerCandidates.map(slot => slot.value),
      ...parsed.keyMaterialCandidates.map(slot => slot.value),
    ].map(value => value.toLowerCase());

    const hints: string[] = [];
    if (
      names.some(value =>
        /(md5|sha|sm3|sm4|aes|des|hmac|sign|encrypt|decrypt|nonce|token)/.test(
          value,
        ),
      )
    ) {
      hints.push('Looks crypto/signature related');
    }
    if (
      names.some(value =>
        /(gzip|brotli|deflate|inflate|lz|compress|decode|encode)/.test(value),
      )
    ) {
      hints.push('Looks compression/encoding related');
    }
    if (
      names.some(value =>
        /(image|pixel|rgba|opus|aac|mp4|video|audio)/.test(value),
      )
    ) {
      hints.push('Looks media processing related');
    }
    if (
      names.some(value =>
        /(vm|dispatch|opcode|interpreter|bytecode|eval)/.test(value),
      )
    ) {
      hints.push('Looks virtual-machine / interpreter related');
    }
    if (
      parsed.memories.length > 0 &&
      parsed.exports.filter(item => item.kind === 'function').length <= 3
    ) {
      hints.push('Few public entry points with explicit memory bridge');
    }
    if (
      parsed.headerCandidates.some(slot =>
        /(signature|authorization|token)/i.test(slot.value),
      )
    ) {
      hints.push('Embedded request/header constants detected');
    }
    return uniqueStrings(hints);
  }

  private detectRiskTags(parsed: ParsedModule): string[] {
    const tags: string[] = [];
    if (parsed.memories.length > 0) {
      tags.push('memory-bridge');
    }
    if (parsed.imports.length >= 10) {
      tags.push('host-coupling');
    }
    if (
      parsed.exports.filter(entry => entry.kind === 'function').length >= 20
    ) {
      tags.push('dense-export-surface');
    }
    if (parsed.startFunctionIndex !== undefined) {
      tags.push('has-start-function');
    }
    if (parsed.tableCount > 0) {
      tags.push('indirect-calls');
    }
    if (parsed.keyMaterialCandidates.length > 0) {
      tags.push('embedded-key-material');
    }
    return uniqueStrings(tags);
  }

  private buildFingerprints(
    styleHints: string[],
    purposeHints: string[],
    parsed: ParsedModule,
  ): WasmFunctionFingerprint[] {
    const styleHas = (label: string) => styleHints.includes(label);
    const purposeHas = (label: string) => purposeHints.includes(label);

    const fingerprintRules: Array<{
      condition: boolean;
      family: WasmFunctionFingerprint['family'];
      confidence: number;
      reason: string;
    }> = [
      {
        condition: styleHas('Rust + wasm-bindgen glue'),
        family: 'rust-wasm-bindgen',
        confidence: 0.95,
        reason: 'Detected wbg imports / __wbindgen_* exports',
      },
      {
        condition: styleHas('Emscripten-style runtime'),
        family: 'emscripten',
        confidence: 0.92,
        reason: 'Detected Emscripten allocator / stack exports or env bases',
      },
      {
        condition: styleHas('TinyGo-style runtime'),
        family: 'tinygo',
        confidence: 0.8,
        reason: 'Detected TinyGo run/resume/getsp export pattern',
      },
      {
        condition: styleHas('AssemblyScript-style runtime'),
        family: 'assemblyscript',
        confidence: 0.86,
        reason: 'Detected AssemblyScript runtime helper exports',
      },
      {
        condition: purposeHas('Looks crypto/signature related'),
        family: 'crypto-likely',
        confidence: 0.78,
        reason: 'Import/export naming suggests hashing, signing, or encryption',
      },
      {
        condition: purposeHas('Looks compression/encoding related'),
        family: 'compression-likely',
        confidence: 0.72,
        reason: 'Import/export naming suggests compression or encoding work',
      },
      {
        condition:
          purposeHas('Looks virtual-machine / interpreter related') ||
          parsed.tableCount > 0,
        family: 'vm-likely',
        confidence: purposeHas('Looks virtual-machine / interpreter related')
          ? 0.74
          : 0.56,
        reason: 'Indirect-call table or dispatcher-like symbol names detected',
      },
      {
        condition: styleHas('Host bridge is relatively heavy'),
        family: 'host-bridge-heavy',
        confidence: 0.68,
        reason: 'Module depends on many host imports and likely thin JS glue',
      },
    ];

    const fingerprints = fingerprintRules
      .filter(rule => rule.condition)
      .map(rule => ({
        family: rule.family,
        confidence: rule.confidence,
        reason: rule.reason,
      }));

    if (fingerprints.length === 0) {
      fingerprints.push({
        family: 'unknown',
        confidence: 0.2,
        reason: 'No strong Wasm ecosystem fingerprint detected',
      });
    }
    return fingerprints;
  }

  private buildSummaryLines(
    parsed: ParsedModule,
    styleHints: string[],
    purposeHints: string[],
    riskTags: string[],
    options: WasmAnalysisOptions,
  ): string[] {
    const sectionNames =
      parsed.sections.map(section => section.name).join(', ') || 'none';
    const headerHintValues = parsed.headerCandidates
      .slice(0, 4)
      .map(slot => slot.displayValue)
      .join('; ');
    const keyHintValues = parsed.keyMaterialCandidates
      .slice(0, 4)
      .map(slot => slot.displayValue)
      .join('; ');

    const lines: string[] = [
      `Sections: ${sectionNames}`,
      `Functions: ${parsed.functionCount} total (${parsed.importFunctionCount} imported, ${parsed.exportFunctionCount} exported)`,
      `Imports/Exports: ${parsed.imports.length}/${parsed.exports.length}`,
      `Memories/Tables/Globals: ${parsed.memories.length}/${parsed.tableCount}/${parsed.globalCount}`,
      `Data segments: ${parsed.dataSegmentCount}; code bodies: ${parsed.codeBodyCount}`,
      `String slots: ${parsed.stringSlots.length}; header-like: ${parsed.headerCandidates.length}; key-like: ${parsed.keyMaterialCandidates.length}`,
    ];

    if (parsed.headerCandidates.length > 0) {
      lines.push(`Header/data hints: ${headerHintValues}`);
    } else {
      lines.push('Header/data hints: none');
    }

    if (parsed.keyMaterialCandidates.length > 0) {
      lines.push(`Sensitive string hints: ${keyHintValues}`);
    } else {
      lines.push('Sensitive string hints: none');
    }

    lines.push(
      styleHints.length > 0
        ? `Style hints: ${styleHints.join('; ')}`
        : 'Style hints: none',
    );
    lines.push(
      purposeHints.length > 0
        ? `Purpose hints: ${purposeHints.join('; ')}`
        : 'Purpose hints: none',
    );
    lines.push(
      riskTags.length > 0
        ? `Risk tags: ${riskTags.join(', ')}`
        : 'Risk tags: none',
    );

    if (
      typeof options.maxSummaryLines === 'number' &&
      options.maxSummaryLines > 0
    ) {
      return lines.slice(0, options.maxSummaryLines);
    }
    return lines;
  }
}
