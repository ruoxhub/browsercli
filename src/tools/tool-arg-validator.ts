/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {suggestSimilarKeys} from './tool-aliases.js';
import {getToolMeta} from './tools-meta.js';
import {
  type NumberRange,
  type ToolArgSpec,
  type ToolArgSpecMap,
} from './zod-introspect.js';

export interface ValidationSuccess {
  ok: true;
  value: Record<string, unknown>;
}

export interface ValidationFailure {
  ok: false;
  error: string;
}

type TypeValidationResult = {ok: true; value: unknown} | ValidationFailure;

function normalizeRawArgs(
  toolName: string,
  rawArgs: Record<string, unknown>,
  specs: ToolArgSpecMap,
): ValidationSuccess | ValidationFailure {
  const normalized: Record<string, unknown> = {};
  const supportedKeys = Object.keys(specs);
  const supportedSet = new Set(supportedKeys);

  for (const [rawKey, value] of Object.entries(rawArgs)) {
    if (!supportedSet.has(rawKey)) {
      const suggestions = suggestSimilarKeys(rawKey, supportedKeys);
      const suggestionText = suggestions.length
        ? `（是否想用 ${suggestions.map(s => `--${s}`).join(' / ')}？）`
        : '';
      return {
        ok: false,
        error:
          `不支持参数 --${rawKey}${suggestionText}；` +
          `${toolName} 支持参数：${supportedKeys.join(', ')}`,
      };
    }
    if (!(rawKey in normalized)) {
      normalized[rawKey] = value;
    }
  }

  return {ok: true, value: normalized};
}

function coerceNumber(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  const parsed = Number(value);
  if (value.trim() !== '' && !isNaN(parsed) && Number.isFinite(parsed)) {
    return parsed;
  }

  return value;
}

/**
 * 与 coerceNumber 对称：当 string 类型参数收到一个数字（纯远程 CLI 会把
 * 纯数字 ID 自动推断为 number），归一化为字符串，避免误报类型错误。
 */
function coerceString(value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return value;
}

function coerceBoolean(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  const normalized = value.toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;

  return value;
}

function typeError(toolName: string, key: string, expected: string): string {
  return `${toolName} 的参数 ${key} 必须是${expected}`;
}

function validateType(
  toolName: string,
  key: string,
  spec: ToolArgSpec,
  value: unknown,
): TypeValidationResult {
  switch (spec.type) {
    case 'string': {
      const strValue = coerceString(value);
      return typeof strValue === 'string'
        ? {ok: true, value: strValue}
        : {ok: false, error: typeError(toolName, key, '字符串')};
    }
    case 'number': {
      const numValue = coerceNumber(value);
      if (typeof numValue !== 'number' || !Number.isFinite(numValue)) {
        return {ok: false, error: typeError(toolName, key, '数字')};
      }
      const range: NumberRange | undefined = spec.range;
      if (range) {
        if (range.int && !Number.isInteger(numValue)) {
          return {
            ok: false,
            error: `${toolName} 的参数 ${key} 必须是整数`,
          };
        }
        if (range.min) {
          const violated = range.min.inclusive
            ? numValue < range.min.value
            : numValue <= range.min.value;
          if (violated) {
            return {
              ok: false,
              error: `${toolName} 的参数 ${key} 必须${range.min.inclusive ? '不小于' : '大于'} ${range.min.value}`,
            };
          }
        }
        if (range.max) {
          const violated = range.max.inclusive
            ? numValue > range.max.value
            : numValue >= range.max.value;
          if (violated) {
            return {
              ok: false,
              error: `${toolName} 的参数 ${key} 必须${range.max.inclusive ? '不超过' : '小于'} ${range.max.value}`,
            };
          }
        }
      }
      return {ok: true, value: numValue};
    }
    case 'boolean': {
      const boolValue = coerceBoolean(value);
      return typeof boolValue === 'boolean'
        ? {ok: true, value: boolValue}
        : {ok: false, error: typeError(toolName, key, '布尔值')};
    }
    case 'string[]':
      return Array.isArray(value) &&
        value.every(item => typeof item === 'string')
        ? {ok: true, value}
        : {ok: false, error: typeError(toolName, key, '字符串数组')};
    case 'object':
      return value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
        ? {ok: true, value}
        : {
            ok: false,
            error: `${toolName} 的参数 ${key} 必须是 JSON 对象（提示：用 --data '{...}' 或 --file params.json 传递）`,
          };
    case 'json':
      // 接受已解析的对象/数组，或 JSON 字符串（CLI 以字符串传入）。
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          return {
            ok: false,
            error: `${toolName} 的参数 ${key} 必须是合法 JSON`,
          };
        }
      }
      return value !== null && typeof value === 'object'
        ? {ok: true, value}
        : {
            ok: false,
            error: `${toolName} 的参数 ${key} 必须是 JSON 对象或数组`,
          };
    default:
      return {ok: true, value};
  }
}

/**
 * 如果 rawArgs 包裹在 { args: {...} } 中且 schema 没有 "args" 字段，
 * 则解包返回内层对象；否则原样返回。
 */
function unwrapArgsWrapper(
  rawArgs: Record<string, unknown>,
  specs: ToolArgSpecMap,
): Record<string, unknown> {
  const inner = rawArgs.args;
  if (
    typeof inner === 'object' &&
    inner !== null &&
    !Array.isArray(inner) &&
    !('args' in specs)
  ) {
    return inner as Record<string, unknown>;
  }
  return rawArgs;
}

export function validateToolArgs(
  toolName: string,
  rawArgs: Record<string, unknown>,
): ValidationSuccess | ValidationFailure {
  const meta = getToolMeta(toolName);
  const specs = meta?.argSpecs;

  const actualArgs =
    rawArgs && typeof rawArgs === 'object' && 'args' in rawArgs && rawArgs.args
      ? unwrapArgsWrapper(rawArgs, specs ?? {})
      : rawArgs;

  if (!specs || Object.keys(specs).length === 0) {
    return {ok: true, value: actualArgs};
  }

  const normalizedRawArgs = normalizeRawArgs(toolName, actualArgs, specs);
  if (!normalizedRawArgs.ok) {
    return normalizedRawArgs;
  }

  const normalized: Record<string, unknown> = {};

  for (const [key, spec] of Object.entries(specs)) {
    const value =
      normalizedRawArgs.value[key] !== undefined
        ? normalizedRawArgs.value[key]
        : spec.defaultValue;

    if (spec.required && (value === undefined || value === '')) {
      return {
        ok: false,
        error: `${toolName} 的参数 ${key} 不能为空`,
      };
    }

    if (value === undefined) {
      continue;
    }

    const typeResult = validateType(toolName, key, spec, value);
    if (!typeResult.ok) {
      return typeResult as ValidationFailure;
    }

    const validatedValue = typeResult.value;

    if (
      spec.enum &&
      typeof validatedValue === 'string' &&
      !spec.enum.includes(validatedValue)
    ) {
      return {
        ok: false,
        error: `${toolName} 的参数 ${key} 仅支持：${spec.enum.join(', ')}`,
      };
    }

    normalized[key] = validatedValue;
  }

  return {ok: true, value: normalized};
}
