/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import {
  CODE_TEMPLATE_NAMES,
  CODE_TEMPLATES,
  formatBytes,
  readTemplateCode,
} from './templates.js';

const codeTemplateNameSchema = zod
  .enum(CODE_TEMPLATE_NAMES)
  .describe(`Template name. Available: ${CODE_TEMPLATE_NAMES.join(', ')}`);

/**
 * 获取代码模板文件内容。
 */
export const getCodeTemplate = defineTool({
  name: 'get_code_template',
  description:
    'Read a code template file and return its source code, description and size.',
  annotations: {
    title: 'Get Code Template',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    templateName: codeTemplateNameSchema,
  },
  handler: async (request, response) => {
    const {templateName} = request.params;
    const templateInfo = CODE_TEMPLATES[templateName];

    if (!templateInfo) {
      const result = {
        success: false,
        message: `未找到模板 "${templateName}"`,
        tooltype: 'get_code_template',
        data: {
          name: templateName,
          description: '',
          code: '',
          sizeBytes: 0,
        },
      };
      response.setStructuredContent(result);
      return;
    }

    try {
      const code = await readTemplateCode(templateInfo);
      const sizeBytes = new TextEncoder().encode(code).length;

      const result = {
        success: true,
        message: `已获取模板：${templateInfo.name}（${formatBytes(sizeBytes)}）`,
        tooltype: 'get_code_template',
        data: {
          name: templateName,
          description: templateInfo.description,
          code,
          sizeBytes,
        },
      };

      response.setStructuredContent(result);
    } catch (error) {
      const result = {
        success: false,
        message: `读取模板失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'get_code_template',
        data: {
          name: templateName,
          description: templateInfo.description,
          code: '',
          sizeBytes: 0,
        },
      };

      response.setStructuredContent(result);
    }
  },
});
