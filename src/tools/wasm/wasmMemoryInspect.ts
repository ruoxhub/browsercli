/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';

import type {
  WasmMemoryInspectParams,
  WasmMemoryInspectResult,
} from './types.js';

export async function wasmMemoryInspect(
  params: WasmMemoryInspectParams,
): Promise<WasmMemoryInspectResult> {
  const tooltype = 'wasm_memory_inspect';

  try {
    const runtime = getRuntime();
    const page = runtime.contextProvider?.getSelectedPage();
    if (!page) {
      return {
        success: false,
        message: '没有选中的页面，请先选择一个页面',
        tooltype,
      };
    }

    const offset = params.offset ?? 0;
    const length = params.length ?? 256;
    const format = params.format ?? 'both';

    const result = await page.evaluate(
      (evalOffset: number, evalLength: number, evalFormat: string, searchPattern?: string) => {
        // 查找页面中导出的 WebAssembly.Memory
        const memories: Array<{exportName: string; buffer: ArrayBuffer}> = [];

        // 遍历全局对象查找 wasm 实例
        for (const key of Object.keys(globalThis)) {
          try {
            const obj = (globalThis as Record<string, unknown>)[key];
            if (obj && typeof obj === 'object') {
              for (const prop of Object.keys(obj as Record<string, unknown>)) {
                try {
                  const val = (obj as Record<string, unknown>)[prop];
                  if (val instanceof WebAssembly.Memory) {
                    memories.push({exportName: `${key}.${prop}`, buffer: val.buffer});
                  }
                  // 检查 Instance 的 exports
                  if (val && typeof val === 'object' && 'exports' in (val as Record<string, unknown>)) {
                    const exports = (val as Record<string, unknown>).exports as Record<string, unknown>;
                    for (const [expName, expVal] of Object.entries(exports)) {
                      if (expVal instanceof WebAssembly.Memory) {
                        memories.push({exportName: `${key}.${prop}.${expName}`, buffer: expVal.buffer});
                      }
                    }
                  }
                } catch {
                  // 跳过不可访问的属性
                }
              }
            }
          } catch {
            // 跳过不可访问的全局属性
          }
        }

        if (memories.length === 0) {
          return {found: false, memories: []};
        }

        const mem = memories[0];
        const view = new Uint8Array(mem.buffer, evalOffset, Math.min(evalLength, mem.buffer.byteLength - evalOffset));

        let hex: string | undefined;
        let ascii: string | undefined;
        const searchResults: Array<{offset: number; match: string}> = [];

        if (evalFormat === 'hex' || evalFormat === 'both') {
          hex = Array.from(view).map((b) => b.toString(16).padStart(2, '0')).join(' ');
        }

        if (evalFormat === 'ascii' || evalFormat === 'both') {
          ascii = Array.from(view).map((b) => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.').join('');
        }

        // 搜索模式
        if (searchPattern) {
          const patternBytes: number[] = [];
          // 尝试 hex 模式
          if (/^[0-9a-fA-F\s]+$/.test(searchPattern)) {
            const hexClean = searchPattern.replace(/\s/g, '');
            for (let i = 0; i < hexClean.length; i += 2) {
              patternBytes.push(parseInt(hexClean.slice(i, i + 2), 16));
            }
          } else {
            // ASCII 模式
            for (let i = 0; i < searchPattern.length; i++) {
              patternBytes.push(searchPattern.charCodeAt(i));
            }
          }

          if (patternBytes.length > 0) {
            const fullView = new Uint8Array(mem.buffer);
            for (let i = 0; i <= fullView.length - patternBytes.length; i++) {
              let match = true;
              for (let j = 0; j < patternBytes.length; j++) {
                if (fullView[i + j] !== patternBytes[j]) {
                  match = false;
                  break;
                }
              }
              if (match) {
                searchResults.push({
                  offset: i,
                  match: Array.from(fullView.slice(i, i + patternBytes.length))
                    .map((b) => b.toString(16).padStart(2, '0'))
                    .join(' '),
                });
                if (searchResults.length >= 100) break;
              }
            }
          }
        }

        return {
          found: true,
          memories: memories.map((m) => m.exportName),
          memorySize: mem.buffer.byteLength,
          hex,
          ascii,
          searchResults: searchResults.length > 0 ? searchResults : undefined,
        };
      },
      offset,
      length,
      format,
      params.searchPattern,
    );

    if (!result.found) {
      return {
        success: false,
        message: '当前页面未找到导出的 WebAssembly.Memory',
        tooltype,
      };
    }

    return {
      success: true,
      message: `检查了 ${(result as {memorySize: number}).memorySize} 字节内存（${(result as {memories: string[]}).memories.join(', ')}）`,
      tooltype,
      logFormat: 'json',
      data: {
        offset,
        length,
        format,
        hex: (result as {hex?: string}).hex,
        ascii: (result as {ascii?: string}).ascii,
        searchResults: (result as {searchResults?: Array<{offset: number; match: string}>}).searchResults,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `检查 WASM 内存失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}
