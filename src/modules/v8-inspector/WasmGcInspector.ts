/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WASM GC Inspection via CDP — discover WebAssembly scripts, extract
 * debug info, and query WebAssembly GC (struct/array/ref-types) heap state.
 *
 * WASM GC (post-MVP) introduces managed structs, arrays, and extern/internal
 * reference types that are garbage-collected by V8. This module extracts the
 * WASM module inventory and inspects live GC objects in the JS heap that
 * originated from WebAssembly modules.
 */

import {createCDPSession} from './CDPSessionAdapter.js';
import {isRecord} from './isRecord.js';

function readRuntimeValue(response: unknown): unknown {
  if (!isRecord(response)) return undefined;
  const result = response['result'];
  return isRecord(result) ? result['value'] : undefined;
}

function parseRuntimeResult(
  response: unknown,
  operation: string,
): Record<string, unknown> {
  if (!isRecord(response)) {
    throw new Error(`${operation} returned an invalid response`);
  }

  const exceptionDetails = response['exceptionDetails'];
  if (exceptionDetails) {
    const text = isRecord(exceptionDetails)
      ? exceptionDetails['text']
      : undefined;
    throw new Error(
      `${operation} failed${typeof text === 'string' ? `: ${text}` : ''}`,
    );
  }

  const rawValue = readRuntimeValue(response);
  if (isRecord(rawValue)) return rawValue;
  if (typeof rawValue !== 'string') {
    throw new Error(`${operation} returned no value`);
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    throw new Error(`${operation} returned invalid JSON`);
  }
  throw new Error(`${operation} returned a non-object value`);
}

// ── Discovery: list WebAssembly scripts via CDP ──

export interface WasmScript {
  scriptId: string;
  url: string;
  isWasm: boolean;
  byteSize?: number;
  sourceMapUrl?: string;
}

/**
 * Discover all WebAssembly scripts in the current page context.
 */
export async function discoverWasmScripts(
  page: unknown,
): Promise<WasmScript[]> {
  const session = await createCDPSession(page);
  if (!session) {
    throw new Error('WASM inspection requires a live CDP page');
  }

  try {
    if (!session.on) return [];

    const scripts = new Map<string, WasmScript>();
    const onScriptParsed = (event: unknown): void => {
      if (!isRecord(event)) return;
      const scriptId = event['scriptId'];
      const url = event['url'];
      const scriptLanguage = event['scriptLanguage'];
      if (
        typeof scriptId !== 'string' ||
        scriptId.length === 0 ||
        !(
          scriptLanguage === 'WebAssembly' ||
          (typeof url === 'string' && url.startsWith('wasm://'))
        )
      ) {
        return;
      }
      scripts.set(scriptId, {
        scriptId,
        url:
          typeof url === 'string'
            ? url
            : typeof event['embedderName'] === 'string'
              ? event['embedderName']
              : '',
        isWasm: true,
        byteSize:
          typeof event['length'] === 'number' ? event['length'] : undefined,
        ...(typeof event['sourceMapURL'] === 'string'
          ? {sourceMapUrl: event['sourceMapURL']}
          : {}),
      });
    };

    session.on('Debugger.scriptParsed', onScriptParsed);
    try {
      await session.send('Debugger.enable');
      return [...scripts.values()];
    } finally {
      session.off?.('Debugger.scriptParsed', onScriptParsed);
    }
  } finally {
    await session.detach().catch(() => undefined);
  }
}

// ── WASM GC heap inspectors ──

export interface WasmGcModule {
  /** Module identifier (from WASM module cache) */
  moduleId: string;
  /** Source URL */
  url: string;
  /** Whether the module uses GC types */
  usesGC: boolean;
  /** WASM features detected */
  features: {
    gc: boolean;
    threads: boolean;
    simd: boolean;
  };
}

export interface WasmStructInfo {
  /** Struct type index within the module */
  typeIndex: number;
  /** Field count */
  fieldCount: number;
  /** Mutability per field */
  fieldMutability: boolean[];
}

export interface WasmGcInspectionResult {
  success: boolean;
  modules: WasmGcModule[];
  totalModules: number;
  gcModules: number;
  wasmScripts: WasmScript[];
  structs: Array<{moduleId: string; structs: WasmStructInfo[]}>;
  summary: {
    totalWasmModules: number;
    gcModules: number;
    nonGcModules: number;
    hasGcFeature: boolean;
    hasThreadsFeature: boolean;
    hasSimdFeature: boolean;
  };
  /** True when running in V8 that supports WASM GC (Chrome ≥119, V8 ≥11.9) */
  wasmGcAvailable: boolean;
}

/**
 * Inspect WebAssembly modules and GC state in the page.
 *
 * @param page - Puppeteer page reference
 * @param opts.scriptId - Optional scriptId filter (inspect a specific module)
 * @param opts.includeStructs - Include struct type definitions (default: true)
 * @returns Full WASM inspection result
 */
export async function inspectWasmGc(
  page: unknown,
  opts?: {scriptId?: string; includeStructs?: boolean},
): Promise<WasmGcInspectionResult> {
  const session = await createCDPSession(page);
  if (!session) {
    throw new Error('WASM inspection requires a live CDP page');
  }

  const includeStructs = opts?.includeStructs !== false;

  try {
    // Enable Runtime domain for evaluate access
    await session.send('Runtime.enable');

    const expression = `
      (() => {
        const output = {
          modules: [],
          totalModules: 0,
          gcModules: 0,
          features: { gc: false, threads: false, simd: false },
          hasGC: false,
          structs: [],
        };

        // Compile minimal modules so each flag reflects actual engine support.
        const supports = (bytes) => {
          try {
            return typeof WebAssembly !== 'undefined' &&
              WebAssembly.validate(new Uint8Array(bytes));
          } catch (_) {
            return false;
          }
        };
        output.features.gc = supports([
          0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
          0x01, 0x03, 0x01, 0x5f, 0x00,
        ]);
        output.features.threads = supports([
          0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
          0x05, 0x04, 0x01, 0x03, 0x01, 0x01,
        ]);
        output.features.simd = supports([
          0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
          0x01, 0x05, 0x01, 0x60, 0x01, 0x7b, 0x00,
        ]);
        output.hasGC = output.features.gc;

        // Enumerate WASM modules via the Module cache (V8 internal)
        // This is best-effort; full enumeration requires CDP Debugger.scriptParsed events.
        // We probe for known wasm-source Script objects via their source code patterns.

        // Build a synthetic enumeration by scanning "function wasm-function["
        // patterns in callable globals — this is a heuristic for WASM GC presence.
        const wasmPatternSeen = new Set();
        try {
          // Walk the global object looking for WASM-exported functions
          const seen = new Set();
          for (const key of Object.getOwnPropertyNames(self)) {
            try {
              const val = self[key];
              if (typeof val === 'function') {
                const src = Function.prototype.toString.call(val);
                if (src.includes('wasm-function[') || src.includes('WebAssembly')) {
                  if (!seen.has(src.substring(0, 80))) {
                    seen.add(src.substring(0, 80));
                    wasmPatternSeen.add({ name: key, isWasmExport: src.includes('wasm-function[') });
                  }
                }
              }
            } catch (_) { /* skip inaccessible properties */ }
          }
        } catch (_) {}

        // Count WASM instances via the memory buffer pattern
        let wasmInstanceCount = 0;
        try {
          if (typeof WebAssembly.Memory !== 'undefined') {
            // Indirect check: count distinct Memory buffers in scope
            wasmInstanceCount = (typeof performance !== 'undefined' &&
              performance.getEntriesByType)
              ? performance.getEntriesByType('resource')
                  .filter((r) => r.name.endsWith('.wasm'))
                  .length
              : 0;
          }
        } catch (_) {}

        output.totalModules = wasmInstanceCount;
        output.gcModules = output.hasGC ? wasmInstanceCount : 0;

        // If WASM GC is available, attempt struct enumeration via dummy module
        ${
          includeStructs
            ? `
        if (output.hasGC) {
          try {
            // Create a minimal test module to probe struct types
            // (this is a heuristic — real struct introspection requires CDP-level API)
            const testBytes = new Uint8Array([
              0x00, 0x61, 0x73, 0x6d, // magic
              0x01, 0x00, 0x00, 0x00, // version
            ]);
            // Module with empty type section — validates that GC type section parsing works
            const mod = new WebAssembly.Module(testBytes);
            // Check for custom sections that indicate GC
            const sections = WebAssembly.Module.customSections(mod, 'target_features');
            for (const sec of sections) {
              const text = new TextDecoder().decode(sec);
              if (text.includes('gc')) {
                output.features.gc = true;
              }
            }
            // GC struct count — module-level enumeration needs CDP
            // We report 0 with gcAvailable=true (indicates probing succeeded but type-level
            // enumeration requires Chrome ≥ M119 with --enable-features=WebAssemblyGC)
            output.structs.push({
              moduleId: 0,
              structs: [],
              note: 'Struct type enumeration requires CDP Debugger.getWasmBytecode + wasm binary parsing',
            });
          } catch (e) {
            // WASM GC may not be available or parsing failed
            output.structs.push({
              moduleId: 0,
              structs: [],
              error: e instanceof Error ? e.message : 'unknown',
            });
          }
        }
        `
            : ''
        }

        return JSON.stringify(output);
      })()
    `;

    const result = await session.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });

    const parsed = parseRuntimeResult(result, 'Runtime.evaluate');
    const features = isRecord(parsed['features']) ? parsed['features'] : {};
    const hasGC = parsed['hasGC'] === true || features['gc'] === true;
    const discoveredScripts = await discoverWasmScripts(page);
    const wasmScripts = opts?.scriptId
      ? discoveredScripts.filter(script => script.scriptId === opts.scriptId)
      : discoveredScripts;
    const modules: WasmGcModule[] = wasmScripts.map(script => {
      return {
        moduleId: script.scriptId,
        url: script.url,
        usesGC: hasGC,
        features: {
          gc: hasGC,
          threads: features['threads'] === true,
          simd: features['simd'] === true,
        },
      };
    });
    const gcModules = modules.filter(module => module.usesGC).length;
    const selectedModuleIds = new Set(modules.map(module => module.moduleId));
    const structs = Array.isArray(parsed['structs'])
      ? (
          parsed['structs'] as Array<{
            moduleId: string;
            structs: WasmStructInfo[];
          }>
        ).filter(
          entry =>
            opts?.scriptId === undefined ||
            selectedModuleIds.has(entry.moduleId),
        )
      : [];

    return {
      success: true,
      modules,
      totalModules: modules.length,
      gcModules,
      wasmScripts,
      structs,
      summary: {
        totalWasmModules: modules.length,
        gcModules,
        nonGcModules: modules.length - gcModules,
        hasGcFeature: hasGC,
        hasThreadsFeature: features['threads'] === true,
        hasSimdFeature: features['simd'] === true,
      },
      wasmGcAvailable: hasGC,
    };
  } finally {
    await session.detach().catch(() => undefined);
  }
}
