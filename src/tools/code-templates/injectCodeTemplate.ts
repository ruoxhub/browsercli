/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import {CODE_TEMPLATES, TEMPLATES_DIR} from './templates.js';
import type {CodeTemplateName, InjectCodeTemplateResult} from './types.js';

/**
 * 将代码模板注入到浏览器页面中执行（依赖 Puppeteer Frame）。
 *
 * 先读取模板文件，再通过 frame.evaluate 注入执行。
 *
 * @param frame - Puppeteer Frame 对象
 * @param templateName - 模板名称 key
 * @returns 结构化结果对象
 */
export async function injectCodeTemplate(
  frame: Frame,
  templateName: CodeTemplateName,
): Promise<InjectCodeTemplateResult> {
  const templateInfo = CODE_TEMPLATES[templateName];

  if (!templateInfo) {
    return {
      success: false,
      message: `未找到模板 "${templateName}"`,
      tooltype: 'inject_code_template',
      name: templateName,
    };
  }

  try {
    const fs = await import('node:fs/promises');
    const templatePath = `${TEMPLATES_DIR}/${templateInfo.file}.js`;
    const code = await fs.readFile(templatePath, 'utf-8');

    await frame.evaluate(code);

    return {
      success: true,
      message: `已注入模板：${templateInfo.name}`,
      tooltype: 'inject_code_template',
      name: templateName,
    };
  } catch (error) {
    return {
      success: false,
      message: `注入模板失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'inject_code_template',
      name: templateName,
    };
  }
}