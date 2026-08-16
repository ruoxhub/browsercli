/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {withOperationTimeout} from '../shared/browserRuntime.js';
import {defineTool} from '../ToolDefinition.js';

export const collectWasm = defineTool({
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
  },
  handler: async (request, response, context) => {
    try {
      const {url} = request.params;
      if (!url) {
        response.setStructuredContent({
          success: false,
          message: '收集 WASM 失败：url 不能为空',
          tooltype: 'collect_wasm',
        });
        return;
      }
      const selectedPage = context.getSelectedPage();
      if (!selectedPage) {
        response.setStructuredContent({
          success: false,
          message: '收集 WASM 失败：没有选中的页面',
          tooltype: 'collect_wasm',
        });
        return;
      }
      const runtime = getRuntime();
      runtime.syncPageContext(selectedPage);
      const timeout = request.params.timeout ?? 30000;
      const result = await withOperationTimeout(
        runtime.wasmCollector.collect(
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
      response.setStructuredContent({
        success: false,
        message: `收集 WASM 失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'collect_wasm',
      });
    }
  },
});
