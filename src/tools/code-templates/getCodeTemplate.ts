/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {CODE_TEMPLATES, TEMPLATES_DIR, formatBytes} from './templates.js';
import type {CodeTemplateName, GetCodeTemplateResult} from './types.js';

/**
 * 读取代码模板文件内容（纯 Node.js 函数，不依赖 Puppeteer）。
 *
 * @param templateName - 模板名称 key
 * @returns 结构化结果对象，包含模板代码、描述和大小
 */
export async function getCodeTemplate(
  templateName: CodeTemplateName,
): Promise<GetCodeTemplateResult> {
  const templateInfo = CODE_TEMPLATES[templateName];

  if (!templateInfo) {
    return {
      success: false,
      message: `未找到模板 "${templateName}"`,
      tooltype: 'get_code_template',
      name: templateName,
      description: '',
      code: '',
      sizeBytes: 0,
    };
  }

  try {
    const fs = await import('node:fs/promises');
    const templatePath = `${TEMPLATES_DIR}/${templateInfo.file}.js`;
    const code = await fs.readFile(templatePath, 'utf-8');
    const sizeBytes = new TextEncoder().encode(code).length;

    return {
      success: true,
      message: `已获取模板：${templateInfo.name}（${formatBytes(sizeBytes)}）`,
      tooltype: 'get_code_template',
      name: templateName,
      description: templateInfo.description,
      code,
      sizeBytes,
    };
  } catch (error) {
    return {
      success: false,
      message: `读取模板失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'get_code_template',
      name: templateName,
      description: templateInfo.description,
      code: '',
      sizeBytes: 0,
    };
  }
}