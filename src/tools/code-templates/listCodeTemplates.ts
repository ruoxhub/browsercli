/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import {CODE_TEMPLATES, listTemplateInfos} from './templates.js';
import type {CodeTemplateName} from './types.js';

/**
 * 列出所有可用的代码模板。
 */
export const listCodeTemplates = defineTool({
  name: 'list_code_templates',
  description:
    'List all available code templates with their names, descriptions and file info.',
  annotations: {
    title: 'List Code Templates',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response) => {
    const templates = listTemplateInfos();
    const result = {
      success: true,
      message: `共有 ${templates.length} 个可用模板`,
      tooltype: 'list_code_templates',
      data: {
        templates,
        count: templates.length,
      }
    };
    response.setStructuredContent(result);
  },
});

/** 获取模板中文描述映射 */
export function getTemplateDescriptions(): Record<
  CodeTemplateName,
  string
> {
  const result = {} as Record<CodeTemplateName, string>;
  for (const [key, info] of Object.entries(CODE_TEMPLATES)) {
    result[key as CodeTemplateName] = info.description;
  }
  return result;
}
