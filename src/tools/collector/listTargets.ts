import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const listTargets = defineTool({
  name: 'list_targets',
  description: '列出 Chromium 当前可见的 Target 及其脚本快照能力。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {},
  handler: async (_request, response, context) => {
    try {
      if (typeof context.getBrowserTargetInspector !== 'function') {
        throw createToolError(
          ErrorCodes.RUNTIME,
          '当前工具运行时未提供 BrowserTargetInspector 上下文',
          {toolName: 'list_targets'},
        );
      }
      const targets = await context.getBrowserTargetInspector().listTargets();
      response.setStructuredContent({
        success: true,
        message: `已列出 ${targets.length} 个 Target`,
        tooltype: 'list_targets',
        data: {targets},
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        error instanceof Error ? error.message : String(error),
        {toolName: 'list_targets'},
      );
    }
  },
});
