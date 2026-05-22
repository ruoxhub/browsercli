/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';



export const wasmMemoryInspect = defineTool({
  name: 'wasm_memory_inspect',
  description: 'Inspect WebAssembly.Memory exports in the current page — hex/ascii dump, pattern search.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    offset: zod.number().int().nonnegative().optional().describe('Byte offset to start reading (default 0)'),
    length: zod.number().int().positive().optional().describe('Number of bytes to read (default 256)'),
    format: zod.enum(['hex', 'ascii', 'both']).optional().describe('Output format (default "both")'),
    searchPattern: zod.string().optional().describe('Hex pattern (e.g. "00 FF") or ASCII string to search for'),
  },
  handler: async (request, response, context: Context) => {
    const {
      offset = 0,
      length = 256,
      format = 'both',
      searchPattern,
    } = request.params;

    try {
      const page = context.getSelectedPage();
      if (!page) {
        response.setStructuredContent({
          success: false,
          message: '没有选中的页面，请先选择一个页面',
          tooltype: 'wasm_memory_inspect',
        });
        return;
      }

      const result = await page.evaluate(
        ({evalOffset, evalLength, evalFormat, searchPattern}: {evalOffset: number; evalLength: number; evalFormat: string; searchPattern?: string}) => {
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
        {evalOffset: offset, evalLength: length, evalFormat: format, searchPattern},
      );

      if (!result.found) {
        response.setStructuredContent({
          success: false,
          message: '当前页面未找到导出的 WebAssembly.Memory',
          tooltype: 'wasm_memory_inspect',
        });
        return;
      }

      response.setStructuredContent({
        success: true,
        message: `检查了 ${(result as {memorySize: number}).memorySize} 字节内存（${(result as {memories: string[]}).memories.join(', ')}）`,
        tooltype: 'wasm_memory_inspect',
        logFormat: 'json',
        data: {
          offset,
          length,
          format,
          hex: (result as {hex?: string}).hex,
          ascii: (result as {ascii?: string}).ascii,
          searchResults: (result as {searchResults?: Array<{offset: number; match: string}>}).searchResults,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `检查 WASM 内存失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'wasm_memory_inspect',
      });
    }
  },
});
