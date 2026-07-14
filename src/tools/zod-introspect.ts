/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Zod schema introspection — 从 defineTool 的 zod schema 中提取
 * CLI 所需的参数规格信息（type / required / enum / defaultValue / description）
 */

import {zod} from '../third_party/index.js';

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
 * 从解包后的 zod 类型推断简化的类型字符串。
 * 返回 null 表示不支持的类型。
 */
function resolveSimpleType(
  inner: zod.ZodTypeAny,
): ToolArgType | 'unknown' | null {
  if (inner instanceof zod.ZodString) return 'string';
  if (inner instanceof zod.ZodNumber) return 'number';
  if (inner instanceof zod.ZodBoolean) return 'boolean';
  if (inner instanceof zod.ZodRecord || inner instanceof zod.ZodObject) return 'object';
  if (inner instanceof zod.ZodEnum || inner instanceof zod.ZodNativeEnum) return 'string';
  if (inner instanceof zod.ZodArray) {
    return inner.element instanceof zod.ZodString ? 'string[]' : null;
  }
  if (inner instanceof zod.ZodUnion) {
    const first = inner._def.options[0] as zod.ZodTypeAny;
    if (first instanceof zod.ZodString) return 'string';
    if (first instanceof zod.ZodNumber) return 'number';
    if (first instanceof zod.ZodBoolean) return 'boolean';
    return null;
  }
  return null;
}

/**
 * 从单个 zod schema 字段提取 ToolArgSpec
 */
function extractArgSpec(
  key: string,
  rawSchema: zod.ZodTypeAny,
): ToolArgSpec | null {
  const {inner, isOptional, defaultValue} = unwrapOptional(rawSchema);
  const resolved = resolveSimpleType(inner);
  if (!resolved || resolved === 'unknown') return null;

  let enumValues: string[] | undefined;
  if (inner instanceof zod.ZodEnum) {
    enumValues = inner._def.values as string[];
  } else if (inner instanceof zod.ZodNativeEnum) {
    enumValues = Object.values(inner._def.values as Record<string, string>);
  }

  const description = inner.description ?? rawSchema.description ?? '';

  return {
    type: resolved as ToolArgType,
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
 * 从 schema 中提取简化的类型映射 (Record<string, string>)
 */
export function extractSchemaTypeMap(
  schema: zod.ZodRawShape,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, field] of Object.entries(schema)) {
    const {inner} = unwrapOptional(field as zod.ZodTypeAny);
    const resolved = resolveSimpleType(inner);
    if (resolved) {
      result[key] = resolved;
    } else if (inner instanceof zod.ZodArray) {
      result[key] = 'unknown[]';
    } else {
      result[key] = 'unknown';
    }
  }

  return result;
}
