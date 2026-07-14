/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ZodToJsonSchema —— 把 ToolMeta.argSpecs 翻成 JSON Schema (Draft 2020-12 子集)。
 *
 * 我们不直接序列化 zod schema —— `zod-introspect.ts` 已经把 zod 类型蒸馏成
 * 扁平的 ToolArgSpec（含 type / required / enum / defaultValue / description）。
 * 这个 adapter 只把 ToolArgSpec 翻成 JSON Schema，前端 ToolForm 即可用它渲染表单。
 *
 * 支持的类型：string / number / boolean / string[] / object（兜底为 any）。
 * 不支持的类型透传 type=null（前端会回退到 JSON 文本框）。
 */

import type {ToolMeta} from '../../tools/tools-meta.js';
import type {ToolArgSpec} from '../../tools/zod-introspect.js';

export interface JsonSchemaProperty {
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: JsonSchemaProperty;
}

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  additionalProperties: false;
}

function argSpecToProperty(spec: ToolArgSpec): JsonSchemaProperty {
  const base: JsonSchemaProperty = {
    description: spec.description || undefined,
    ...(spec.enum && {enum: spec.enum}),
    ...(spec.defaultValue !== undefined && {default: spec.defaultValue}),
  };

  switch (spec.type) {
    case 'string':
      return {...base, type: 'string'};
    case 'number':
      return {...base, type: 'number'};
    case 'boolean':
      return {...base, type: 'boolean'};
    case 'string[]':
      return {...base, type: 'array', items: {type: 'string'}};
    case 'object':
      return {...base, type: 'object'};
    default:
      // 不支持的类型：透传 type=undefined，前端回退 JSON 输入
      return base;
  }
}

/**
 * 把整个 ToolMeta 翻成 JSON Schema。
 *
 * 输入示例（来自 zod-introspect）：
 * argSpecs = {
 *   url: {type: 'string', required: true, description: 'Page URL'},
 *   timeout: {type: 'number', required: false, defaultValue: 5000, description: ''}
 * }
 *
 * 输出 JSON Schema：
 * {
 *   type: 'object',
 *   properties: {
 *     url: {type: 'string', description: 'Page URL'},
 *     timeout: {type: 'number', default: 5000}
 *   },
 *   required: ['url'],
 *   additionalProperties: false
 * }
 */
export function toolMetaToJsonSchema(meta: ToolMeta): JsonSchemaObject {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const [key, spec] of Object.entries(meta.argSpecs)) {
    properties[key] = argSpecToProperty(spec);
    if (spec.required) required.push(key);
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}
