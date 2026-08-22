/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {evaluateInPageRuntime} from '../../modules/debugger/evaluateInPageRuntime.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {withOperationTimeout} from '../shared/browserRuntime.js';
import {defineTool, type Context} from '../ToolDefinition.js';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_SEARCH_BYTES = 64 * 1024 * 1024;

interface MemoryInspectionResult {
  found: boolean;
  memories: string[];
  memorySize?: number;
  error?: string;
  hex?: string;
  ascii?: string;
  searchResults?: Array<{offset: number; match: string}>;
  searchTruncated?: boolean;
}

export const wasmMemoryInspect = defineTool({
  name: 'wasm_memory_inspect',
  description:
    '检查当前页面中导出的 WebAssembly.Memory —— 提供 hex/ascii 转储与模式搜索。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    offset: zod
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('读取起始的字节偏移（默认 0）'),
    length: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('要读取的字节数（默认 256）'),
    format: zod
      .enum(['hex', 'ascii', 'both'])
      .optional()
      .describe('输出格式（默认 "both"）'),
    searchPattern: zod
      .string()
      .max(4096)
      .optional()
      .describe('要搜索的十六进制模式（如 "00 FF"）或 ASCII 字符串'),
    timeoutMs: zod
      .number()
      .int()
      .positive()
      .max(30000)
      .optional()
      .describe('页面内存检查超时时间（毫秒，默认 5000）'),
  },
  handler: async (request, response, context: Context) => {
    const {
      offset = 0,
      length = 256,
      format = 'both',
      searchPattern,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    } = request.params;

    try {
      const page = context.getSelectedPage();
      if (!page) {
        throw createToolError(
          ErrorCodes.PAGE_REQUIRED,
          '没有选中的页面，请先选择一个页面',
          {toolName: 'wasm_memory_inspect'},
        );
      }

      const inspectMemory = ({
        evalOffset,
        evalLength,
        evalFormat,
        searchPattern,
        maxSearchBytes,
      }: {
        evalOffset: number;
        evalLength: number;
        evalFormat: string;
        searchPattern?: string;
        maxSearchBytes: number;
      }) => {
        const memories: Array<{
          exportName: string;
          memory: WebAssembly.Memory;
        }> = [];
        const seenMemories = new Set<WebAssembly.Memory>();

        function addMemory(name: string, value: unknown): void {
          if (value instanceof WebAssembly.Memory && !seenMemories.has(value)) {
            seenMemories.add(value);
            memories.push({exportName: name, memory: value});
          }
        }

        function inspectInstance(
          name: string,
          instance: WebAssembly.Instance,
        ): void {
          try {
            inspectOwnDataProperties(`${name}.exports`, instance.exports);
          } catch {
            // 跳过已失效或不可访问的实例。
          }
        }

        function inspectOwnDataProperties(prefix: string, value: object): void {
          let descriptors: PropertyDescriptorMap;
          try {
            descriptors = Object.getOwnPropertyDescriptors(value);
          } catch {
            return;
          }
          for (const [propertyName, descriptor] of Object.entries(
            descriptors,
          )) {
            if (!('value' in descriptor)) continue;
            const propertyValue = descriptor.value as unknown;
            const path = `${prefix}.${propertyName}`;
            addMemory(path, propertyValue);
            if (propertyValue instanceof WebAssembly.Instance) {
              inspectInstance(path, propertyValue);
            }
          }
        }

        const globalDescriptors = Object.getOwnPropertyDescriptors(globalThis);
        for (const [name, descriptor] of Object.entries(globalDescriptors)) {
          if (!('value' in descriptor)) continue;
          const value = descriptor.value as unknown;
          addMemory(name, value);
          if (value instanceof WebAssembly.Instance) {
            inspectInstance(name, value);
            continue;
          }
          if (
            value === globalThis ||
            !value ||
            (typeof value !== 'object' && typeof value !== 'function')
          ) {
            continue;
          }
          try {
            const prototype = Object.getPrototypeOf(value) as unknown;
            if (prototype === null || prototype === Object.prototype) {
              inspectOwnDataProperties(name, value);
            }
          } catch {
            // 跳过 Proxy 或不可访问的宿主对象。
          }
        }

        if (memories.length === 0) {
          return {found: false, memories: []};
        }

        const selected = memories[0];
        const buffer = selected.memory.buffer;
        const memoryNames = memories.map(memory => memory.exportName);
        if (evalOffset > buffer.byteLength) {
          return {
            found: true,
            memories: memoryNames,
            memorySize: buffer.byteLength,
            error: `读取偏移 ${evalOffset} 超出内存大小 ${buffer.byteLength}`,
          };
        }

        const view = new Uint8Array(
          buffer,
          evalOffset,
          Math.min(evalLength, buffer.byteLength - evalOffset),
        );
        let hex: string | undefined;
        let ascii: string | undefined;
        const searchResults: Array<{offset: number; match: string}> = [];

        if (evalFormat === 'hex' || evalFormat === 'both') {
          hex = Array.from(view)
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join(' ');
        }

        if (evalFormat === 'ascii' || evalFormat === 'both') {
          ascii = Array.from(view)
            .map(byte =>
              byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.',
            )
            .join('');
        }

        let searchTruncated = false;
        if (searchPattern) {
          const compactHex = searchPattern.replace(/\s/g, '');
          let patternBytes: number[];
          if (/^(?:[0-9a-fA-F]{2})+$/.test(compactHex)) {
            patternBytes = Array.from(
              {length: compactHex.length / 2},
              (_, index) =>
                parseInt(compactHex.slice(index * 2, index * 2 + 2), 16),
            );
          } else {
            patternBytes = Array.from(new TextEncoder().encode(searchPattern));
          }

          if (patternBytes.length > 0) {
            const searchLength = Math.min(buffer.byteLength, maxSearchBytes);
            const fullView = new Uint8Array(buffer, 0, searchLength);
            searchTruncated = searchLength < buffer.byteLength;
            for (
              let index = 0;
              index <= fullView.length - patternBytes.length;
              index++
            ) {
              let matches = true;
              for (
                let patternIndex = 0;
                patternIndex < patternBytes.length;
                patternIndex++
              ) {
                if (
                  fullView[index + patternIndex] !== patternBytes[patternIndex]
                ) {
                  matches = false;
                  break;
                }
              }
              if (matches) {
                searchResults.push({
                  offset: index,
                  match: Array.from(
                    fullView.slice(index, index + patternBytes.length),
                  )
                    .map(byte => byte.toString(16).padStart(2, '0'))
                    .join(' '),
                });
                if (searchResults.length >= 100) break;
              }
            }
          }
        }

        return {
          found: true,
          memories: memoryNames,
          memorySize: buffer.byteLength,
          hex,
          ascii,
          searchResults: searchResults.length > 0 ? searchResults : undefined,
          searchTruncated: searchTruncated || undefined,
        };
      };
      const inspectionExpression = `(${inspectMemory.toString()})(${JSON.stringify(
        {
          evalOffset: offset,
          evalLength: length,
          evalFormat: format,
          searchPattern,
          maxSearchBytes: MAX_SEARCH_BYTES,
        },
      )})`;
      const result = await withOperationTimeout(
        evaluateInPageRuntime<MemoryInspectionResult>(
          page.mainFrame(),
          inspectionExpression,
          timeoutMs,
        ),
        '检查 WASM 内存',
        timeoutMs,
      );

      if (!result.found) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          '当前页面未找到导出的 WebAssembly.Memory',
          {toolName: 'wasm_memory_inspect'},
        );
      }
      if (result.error) {
        throw createToolError(
          ErrorCodes.RUNTIME,
          result.error,
          {toolName: 'wasm_memory_inspect'},
          {
            details: {
              memories: result.memories,
              memorySize: result.memorySize,
            },
          },
        );
      }

      response.setStructuredContent({
        success: true,
        message: `检查了 ${result.memorySize} 字节内存（${result.memories.join(', ')}）`,
        tooltype: 'wasm_memory_inspect',
        logFormat: 'json',
        data: {
          offset,
          length,
          format,
          hex: result.hex,
          ascii: result.ascii,
          searchResults: result.searchResults,
          searchTruncated: result.searchTruncated,
        },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `检查 WASM 内存失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'wasm_memory_inspect'},
      );
    }
  },
});
