import {ErrorCodes, formatError} from '../../utils/errors.js';
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
        throw new Error('当前工具运行时未提供 BrowserTargetInspector 上下文');
      }
      const targets = await context.getBrowserTargetInspector().listTargets();
      response.setStructuredContent({
        success: true,
        message: `已列出 ${targets.length} 个 Target`,
        tooltype: 'list_targets',
        data: {targets},
      });
    } catch (error) {
      const formatted = formatError(error, ErrorCodes.RUNTIME);
      response.setStructuredContent({
        success: false,
        message: formatted.message,
        tooltype: 'list_targets',
        data: {error: formatted},
      });
    }
  },
});
