/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {CODE_TEMPLATES, listTemplateInfos} from './templates.js';
import type {CodeTemplateInfo, CodeTemplateName} from './types.js';

/**
 * 列出所有可用的代码模板（纯 Node.js 函数，不依赖 Puppeteer）。
 */
export function listCodeTemplates(): {
  templates: CodeTemplateInfo[];
  count: number;
} {
  const templates = listTemplateInfos();
  return {
    templates,
    count: templates.length,
  };
}

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