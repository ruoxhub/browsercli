/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

import {CODE_TEMPLATES, TEMPLATES_DIR, formatBytes} from './templates.js';
import type {CodeTemplateName} from './types.js';

const codeTemplateNameSchema = zod
  .enum(
    Object.keys(CODE_TEMPLATES) as [CodeTemplateName, ...CodeTemplateName[]],
  )
  .describe(
    `Template name. Available: ${Object.keys(CODE_TEMPLATES).join(', ')}`,
  );

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
        name: templateName,
        description: '',
        code: '',
        sizeBytes: 0,
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
      return;
    }

    try {
      const fs = await import('node:fs/promises');
      const templatePath = `${TEMPLATES_DIR}/${templateInfo.file}.js`;
      const code = await fs.readFile(templatePath, 'utf-8');
      const sizeBytes = new TextEncoder().encode(code).length;

      const result = {
        success: true,
        message: `已获取模板：${templateInfo.name}（${formatBytes(sizeBytes)}）`,
        tooltype: 'get_code_template',
        name: templateName,
        description: templateInfo.description,
        code,
        sizeBytes,
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      const result = {
        success: false,
        message: `读取模板失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'get_code_template',
        name: templateName,
        description: templateInfo.description,
        code: '',
        sizeBytes: 0,
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    }
  },
});
