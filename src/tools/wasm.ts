/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {writeFile} from 'node:fs/promises';
import path from 'node:path';

import type {
  WasmDetectionResult,
  WasmRuntimeEvent,
} from '../modules/wasm/WasmTypes.js';
import {zod} from '../third_party/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';

import {ToolCategory} from './categories.js';
import type {DomainManifest} from './manifest.js';
import {withOperationTimeout} from './shared/browserRuntime.js';
import type {MessagesResult} from './shared/types.js';
import {defineBrowserTool, definePageTool} from './ToolDefinition.js';

// ─── types.ts ────────────────────────────────────────────

// ─── 基础结果类型 ────────────────────────────────────

export interface WasmToolResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat?: string;
}

// ─── 数据类型 ──────────────────────────────────────────

export type WasmCollectData = WasmDetectionResult;

export interface WasmDumpData {
  moduleId: string;
  hash: string;
  size: number;
  outputPath: string;
  sourceUrl?: string;
}

export interface WasmVmpTraceData {
  totalEvents: number;
  filteredEvents: number;
  events: WasmRuntimeEvent[];
  modules: Array<{id: string; hash: string; size: number}>;
}

// ─── 结果类型 ──────────────────────────────────────────

export type WasmCollectResult = WasmToolResult<WasmCollectData>;

export type WasmDumpResult = WasmToolResult<WasmDumpData>;

export type WasmVmpTraceResult = WasmToolResult<WasmVmpTraceData>;

// ─── collectWasm.ts ──────────────────────────────────────

export const collectWasm = definePageTool({
  name: 'collect_wasm',
  description:
    '重新导航到目标 URL，并捕获网络加载与运行时创建的 WebAssembly 模块。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    url: zod.string().url().describe('要重新加载并捕获 WASM 的目标 URL'),
    timeout: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('页面导航超时时间（毫秒，默认 30000）'),
    waitAfterLoadMs: zod
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('页面加载后继续等待捕获的时间（毫秒，默认 1000）'),
    includeRuntimeEvents: zod
      .boolean()
      .optional()
      .describe('是否收集运行时事件（默认 true）'),
    maxModules: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('结果中最多返回的模块数（默认 20）'),
    captureBase64: zod
      .boolean()
      .optional()
      .describe('是否在模块记录中包含 Base64 二进制（默认 false）'),
    clearPrevious: zod
      .boolean()
      .optional()
      .describe(
        '采集前是否清空当前会话已累积的 WASM 模块与运行时事件（默认 false）',
      ),
  },
  handler: async (request, response, context) => {
    try {
      const {url} = request.params;
      if (!url) {
        throw createToolError(
          ErrorCodes.VALIDATION,
          '收集 WASM 失败：url 不能为空',
          {toolName: 'collect_wasm'},
        );
      }
      const selectedPage = context.getSelectedPage();
      if (!selectedPage) {
        throw createToolError(
          ErrorCodes.PAGE_REQUIRED,
          '收集 WASM 失败：没有选中的页面',
          {toolName: 'collect_wasm'},
          {
            recovery: {
              tool: 'select_page',
              command: 'browsercli select_page',
              reason: 'A page must be selected before collecting WASM',
            },
          },
        );
      }
      const wasmCollector = context.getWasmCollector?.();
      if (!wasmCollector) {
        throw createToolError(ErrorCodes.RUNTIME, 'WasmCollector 服务不可用', {
          toolName: 'collect_wasm',
        });
      }
      if (!request.params.pageId) {
        context.syncPageContext(selectedPage);
      }
      const timeout = request.params.timeout ?? 30000;
      const result = await withOperationTimeout(
        wasmCollector.collect(
          {...request.params, url},
          undefined,
          selectedPage,
        ),
        '收集 WASM',
        timeout,
      );
      response.setStructuredContent({
        success: true,
        message: `捕获 ${result.totalModules} 个 WASM 模块、${result.totalRuntimeEvents} 个运行时事件`,
        tooltype: 'collect_wasm',
        logFormat: 'json',
        data: result,
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `收集 WASM 失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'collect_wasm'},
      );
    }
  },
});

// ─── wasmDump.ts ─────────────────────────────────────────

export const wasmDump = defineBrowserTool({
  name: 'wasm_dump',
  concurrency: 'none',
  description: '将捕获的 Wasm 模块导出为磁盘上的 .wasm 文件。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    moduleIndex: zod
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('捕获模块的索引（默认 0）'),
    outputPath: zod.string().optional().describe('.wasm 二进制文件的输出路径'),
  },
  handler: async (request, response, context) => {
    const {moduleIndex = 0, outputPath: userOutputPath} = request.params;

    try {
      const wasmCollector = context.getWasmCollector?.();
      if (!wasmCollector) {
        throw createToolError(ErrorCodes.RUNTIME, 'WasmCollector 服务不可用', {
          toolName: 'wasm_dump',
        });
      }
      const modules = wasmCollector.getModules();

      if (modules.length === 0) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          '当前会话未捕获任何 WASM 模块，请先使用 collect_wasm 捕获',
          {toolName: 'wasm_dump'},
        );
      }

      if (moduleIndex < 0 || moduleIndex >= modules.length) {
        throw createToolError(
          ErrorCodes.VALIDATION,
          `模块索引 ${moduleIndex} 超出范围（共 ${modules.length} 个模块）`,
          {toolName: 'wasm_dump'},
        );
      }

      const module = modules[moduleIndex];
      const bytes = wasmCollector.getModuleBytes(module.id);

      if (!bytes) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `模块 ${module.id} 的二进制数据不可用`,
          {toolName: 'wasm_dump'},
        );
      }

      const outputPath =
        userOutputPath ??
        path.join(
          process.cwd(),
          `wasm_dump_${moduleIndex}_${module.hash.slice(0, 8)}.wasm`,
        );

      await writeFile(outputPath, bytes);

      response.setStructuredContent({
        success: true,
        message: `已导出模块 ${module.id}（${bytes.byteLength} 字节）到 ${outputPath}`,
        tooltype: 'wasm_dump',
        logFormat: 'json',
        data: {
          moduleId: module.id,
          hash: module.hash,
          size: bytes.byteLength,
          outputPath,
          sourceUrl: module.sourceUrl,
        },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `导出 WASM 模块失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'wasm_dump'},
      );
    }
  },
});

// ─── wasmVmpTrace.ts ─────────────────────────────────────

export const wasmVmpTrace = definePageTool({
  name: 'wasm_vmp_trace',
  description:
    '追踪由 JS-Wasm 边界 hook 捕获的 Wasm 运行时事件，默认从当前页面增量拉取最新事件，可选按模块过滤。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    maxEvents: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('返回的最大事件数（默认 5000）'),
    filterModule: zod.string().optional().describe('按指定模块 ID 过滤事件'),
    refresh: zod
      .boolean()
      .optional()
      .describe('是否先从当前选中页面拉取最新增量运行时事件（默认 true）'),
  },
  handler: async (request, response, context) => {
    const {maxEvents = 5000, filterModule, refresh = true} = request.params;

    try {
      const wasmCollector = context.getWasmCollector?.();
      if (!wasmCollector) {
        throw createToolError(ErrorCodes.RUNTIME, 'WasmCollector 服务不可用', {
          toolName: 'wasm_vmp_trace',
        });
      }
      if (refresh && typeof wasmCollector.refreshFromPage === 'function') {
        const selectedPage = context.getSelectedPage?.();
        if (selectedPage) {
          await wasmCollector.refreshFromPage(selectedPage);
        }
      }
      const allEvents = wasmCollector.getRuntimeEvents();
      const modules = wasmCollector.getModules();

      const filtered = allEvents
        .filter(event => {
          if (filterModule && event.moduleId !== filterModule) {
            return false;
          }
          return true;
        })
        .slice(0, maxEvents);

      response.setStructuredContent({
        success: true,
        message: `捕获到 ${filtered.length} 个运行时事件（共 ${allEvents.length} 个，${modules.length} 个模块）`,
        tooltype: 'wasm_vmp_trace',
        logFormat: 'json',
        data: {
          totalEvents: allEvents.length,
          filteredEvents: filtered.length,
          events: filtered,
          modules: modules.map(m => ({id: m.id, hash: m.hash, size: m.size})),
        },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `获取 VMP trace 失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'wasm_vmp_trace'},
      );
    }
  },
});

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'wasm',
  description: 'WebAssembly reverse engineering tools.',
  profile: 'full',
  tools: [
    {modulePath: './wasm.js', handlerName: 'collectWasm'},
    {modulePath: './wasm.js', handlerName: 'wasmDump'},
    {modulePath: './wasm.js', handlerName: 'wasmVmpTrace'},
  ],
} satisfies DomainManifest;
