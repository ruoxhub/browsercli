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

export type ToolArgType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'object'
  // 'json'：任意 JSON 值（对象或数组），CLI 以 JSON 字符串传入；
  // 校验层负责 JSON.parse。用于 array<object> 等复杂参数（如 variants）。
  | 'json';

export interface NumberRange {
  int?: boolean;
  min?: {value: number; inclusive: boolean};
  max?: {value: number; inclusive: boolean};
}

export interface ToolArgSpec {
  type: ToolArgType;
  required: boolean;
  defaultValue?: unknown;
  enum?: string[];
  /** zod number 约束（.int()/.min()/.max()），由校验层强制执行 */
  range?: NumberRange;
  description: string;
}

export type ToolArgSpecMap = Record<string, ToolArgSpec>;

/**
 * 判断 zod 类型是否为 optional（被 zod.optional() 包裹）
 */
function unwrapOptional(schema: zod.ZodTypeAny): {
  inner: zod.ZodTypeAny;
  isOptional: boolean;
  defaultValue?: unknown;
} {
  let current = schema;
  let isOptional = false;
  let defaultValue: unknown = undefined;

  while (true) {
    if (current instanceof zod.ZodOptional) {
      isOptional = true;
      current = current.unwrap();
      continue;
    }

    if (current instanceof zod.ZodDefault) {
      isOptional = true;
      defaultValue = current._def.defaultValue();
      current = current.removeDefault();
      continue;
    }

    // 处理 ZodEffects（transform / preprocess / refine）
    // 统一取 innerType()，无论 effects 类型
    if (current instanceof zod.ZodEffects) {
      current = current.innerType();
      continue;
    }

    break;
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
  if (inner instanceof zod.ZodRecord || inner instanceof zod.ZodObject)
    return 'object';
  if (inner instanceof zod.ZodEnum || inner instanceof zod.ZodNativeEnum)
    return 'string';
  if (inner instanceof zod.ZodArray) {
    if (inner.element instanceof zod.ZodString) return 'string[]';
    // 数组元素为对象/记录（如 array<object> 的 variants 参数）→
    // 归为 'json'，交由校验层接受 JSON 数组或对象。
    if (
      inner.element instanceof zod.ZodObject ||
      inner.element instanceof zod.ZodRecord
    ) {
      return 'json';
    }
    return null;
  }
  if (inner instanceof zod.ZodUnion) {
    const first = inner._def.options[0] as zod.ZodTypeAny;
    if (first instanceof zod.ZodString) return 'string';
    if (first instanceof zod.ZodNumber) return 'number';
    if (first instanceof zod.ZodBoolean) return 'boolean';
    return null;
  }
  // zod.unknown()（含 z.any()）表示"任意 JSON 值"，归为 'json' 而不是丢弃：
  // 丢掉会让 buildToolArgs 把该参数当未知参数拒绝，例如 create_hook 的
  // `params`（承载 target / object / property 等类型相关字段），一旦缺失
  // function / property 类 hook 就完全无法创建。
  if (inner instanceof zod.ZodUnknown || inner instanceof zod.ZodAny)
    return 'json';
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

  let range: NumberRange | undefined;
  if (resolved === 'number' && inner instanceof zod.ZodNumber) {
    const checks =
      (
        inner._def as {
          checks?: Array<{kind: string; value?: number; inclusive?: boolean}>;
        }
      ).checks ?? [];
    const int = checks.find(c => c.kind === 'int');
    const min = checks.find(c => c.kind === 'min');
    const max = checks.find(c => c.kind === 'max');
    // zod 的 check 形状是内部实现细节：value 缺失时宁可忽略该约束，
    // 也不要写入 undefined 让范围校验退化成 NaN 比较。
    if (int || min || max) {
      range = {
        ...(int ? {int: true} : {}),
        ...(typeof min?.value === 'number'
          ? {min: {value: min.value, inclusive: min.inclusive !== false}}
          : {}),
        ...(typeof max?.value === 'number'
          ? {max: {value: max.value, inclusive: max.inclusive !== false}}
          : {}),
      };
    }
  }

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
    ...(range && {range}),
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
