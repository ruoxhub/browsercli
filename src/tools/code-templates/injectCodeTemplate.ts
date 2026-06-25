/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {
  CODE_TEMPLATE_NAMES,
  CODE_TEMPLATES,
  readTemplateCode,
} from './templates.js';

const codeTemplateNameSchema = zod
  .enum(CODE_TEMPLATE_NAMES)
  .describe(
    `Template name to inject. Available: ${CODE_TEMPLATE_NAMES.join(', ')}`,
  );

/**
 * 将代码模板注入到浏览器页面中执行。
 */
export const injectCodeTemplate = defineTool({
  name: 'inject_code_template',
  description:
    'Inject a code template into the browser page for execution via frame.evaluate.',
  annotations: {
    title: 'Inject Code Template',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    templateName: codeTemplateNameSchema,
  },
  handler: async (request, response, context) => {
    const {templateName} = request.params;
    const templateInfo = CODE_TEMPLATES[templateName];
    const frame = (context as Context).getSelectedFrame();

    if (!templateInfo) {
      const result = {
        success: false,
        message: `未找到模板 "${templateName}"`,
        tooltype: 'inject_code_template',
        data: {
          name: templateName,
        },
      };
      response.setStructuredContent(result);
      return;
    }

    try {
      const code = await readTemplateCode(templateInfo);

      await frame.evaluate(code);

      const result = {
        success: true,
        message: `已注入模板：${templateInfo.name}`,
        tooltype: 'inject_code_template',
        data: {name: templateName},
      };
      response.setStructuredContent(result);
    } catch (error) {
      const result = {
        success: false,
        message: `注入模板失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'inject_code_template',
        data: {name: templateName},
      };
      response.setStructuredContent(result);
    }
  },
});
