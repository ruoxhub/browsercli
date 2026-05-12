/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Zod schema introspection — 从 defineTool 的 zod schema 中提取
 * CLI 所需的参数规格信息（type / required / enum / defaultValue / description）
 */

import {zod} from '../third_party/index.js';
import type {ToolDefinition} from '../tools/ToolDefinition.js';

export type ToolArgType = 'string' | 'number' | 'boolean' | 'string[]' | 'object';

export interface ToolArgSpec {
  type: ToolArgType;
  required: boolean;
  defaultValue?: unknown;
  enum?: string[];
  description: string;
}

export type ToolArgSpecMap = Record<string, ToolArgSpec>;

/**
 * 判断 zod 类型是否为 optional（被 zod.optional() 包裹）
 */
function unwrapOptional(
  schema: zod.ZodTypeAny,
): {inner: zod.ZodTypeAny; isOptional: boolean; defaultValue?: unknown} {
  let current = schema;
  let isOptional = false;
  let defaultValue: unknown = undefined;

  // 处理 optional()
  if (current instanceof zod.ZodOptional) {
    isOptional = true;
    current = current.unwrap();
  }

  // 处理 default()
  if (current instanceof zod.ZodDefault) {
    isOptional = true;
    defaultValue = current._def.defaultValue();
    current = current.removeDefault();
  }

  // 处理 ZodEffects（transform / preprocess / refine）
  // 统一取 innerType()，无论 effects 类型
  if (current instanceof zod.ZodEffects) {
    current = current.innerType();
  }

  return {inner: current, isOptional, defaultValue};
}

/**
 * 从单个 zod schema 字段提取 ToolArgSpec
 */
function extractArgSpec(
  key: string,
  rawSchema: zod.ZodTypeAny,
): ToolArgSpec | null {
  const {inner, isOptional, defaultValue} = unwrapOptional(rawSchema);

  let type: ToolArgType;
  let enumValues: string[] | undefined;

  if (inner instanceof zod.ZodString) {
    type = 'string';
  } else if (inner instanceof zod.ZodNumber) {
    type = 'number';
  } else if (inner instanceof zod.ZodBoolean) {
    type = 'boolean';
  } else if (inner instanceof zod.ZodArray) {
    const element = inner.element;
    if (element instanceof zod.ZodString) {
      type = 'string[]';
    } else {
      // 无法识别的数组类型，跳过
      return null;
    }
  } else if (inner instanceof zod.ZodEnum) {
    type = 'string';
    enumValues = inner._def.values as string[];
  } else if (inner instanceof zod.ZodNativeEnum) {
    type = 'string';
    enumValues = Object.values(inner._def.values as Record<string, string>);
  } else if (inner instanceof zod.ZodUnion) {
    // 取第一个选项作为类型参考
    const first = inner._def.options[0] as zod.ZodTypeAny;
    if (first instanceof zod.ZodString) {
      type = 'string';
    } else if (first instanceof zod.ZodNumber) {
      type = 'number';
    } else if (first instanceof zod.ZodBoolean) {
      type = 'boolean';
    } else {
      return null;
    }
  } else if (inner instanceof zod.ZodRecord || inner instanceof zod.ZodObject) {
    type = 'object';
  } else {
    // 不支持的类型，跳过
    return null;
  }

  // 提取 description
  const description = inner.description ?? rawSchema.description ?? '';

  return {
    type,
    required: !isOptional,
    ...(defaultValue !== undefined && {defaultValue}),
    ...(enumValues && {enum: enumValues}),
    description,
  };
}

/**
 * 从 defineTool 的 schema (ZodRawShape) 提取完整的 ToolArgSpecMap
 */
export function extractArgSpecsFromSchema(
  schema: zod.ZodRawShape,
): ToolArgSpecMap {
  const result: ToolArgSpecMap = {};

  for (const [key, field] of Object.entries(schema)) {
    const spec = extractArgSpec(key, field as zod.ZodTypeAny);
    if (spec) {
      result[key] = spec;
    }
  }

  return result;
}

/**
 * 从 defineTool 定义中提取 arg specs
 */
export function extractArgSpecsFromDefinition(
  definition: ToolDefinition,
): ToolArgSpecMap {
  return extractArgSpecsFromSchema(definition.schema);
}

/**
 * 从 schema 中提取简化的类型映射 (Record<string, string>)
 */
export function extractSchemaTypeMap(
  schema: zod.ZodRawShape,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, field] of Object.entries(schema)) {
    const {inner} = unwrapOptional(field as zod.ZodTypeAny);

    if (inner instanceof zod.ZodString || inner instanceof zod.ZodEnum) {
      result[key] = 'string';
    } else if (inner instanceof zod.ZodNumber) {
      result[key] = 'number';
    } else if (inner instanceof zod.ZodBoolean) {
      result[key] = 'boolean';
    } else if (inner instanceof zod.ZodArray) {
      const element = inner.element;
      if (element instanceof zod.ZodString) {
        result[key] = 'string[]';
      } else {
        result[key] = 'unknown[]';
      }
    } else if (inner instanceof zod.ZodUnion) {
      const first = inner._def.options[0] as zod.ZodTypeAny;
      if (first instanceof zod.ZodString) {
        result[key] = 'string';
      } else if (first instanceof zod.ZodNumber) {
        result[key] = 'number';
      } else if (first instanceof zod.ZodBoolean) {
        result[key] = 'boolean';
      } else {
        result[key] = 'unknown';
      }
    } else if (inner instanceof zod.ZodRecord || inner instanceof zod.ZodObject) {
      result[key] = 'object';
    } else {
      result[key] = 'unknown';
    }
  }

  return result;
}
