import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const dumpTargetScripts = defineTool({
  name: 'dump_target_scripts',
  description: '一次性读取指定 Chromium Target 当前已解析的脚本源码。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    targetId: zod
      .string()
      .min(1)
      .describe('从 list_targets 获取的 Target ID。'),
  },
  handler: async (request, response, context) => {
    try {
      if (typeof context.getBrowserTargetInspector !== 'function') {
        throw createToolError(
          ErrorCodes.RUNTIME,
          '当前工具运行时未提供 BrowserTargetInspector 上下文',
          {toolName: 'dump_target_scripts'},
        );
      }
      const result = await context
        .getBrowserTargetInspector()
        .dumpScripts(request.params.targetId);
      response.setStructuredContent({
        success: true,
        message: `已返回 ${result.scripts.length} 个 Target 脚本`,
        tooltype: 'dump_target_scripts',
        data: result,
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        error instanceof Error ? error.message : String(error),
        {toolName: 'dump_target_scripts', targetId: request.params.targetId},
      );
    }
  },
});
