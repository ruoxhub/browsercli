/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {getAliasesForTool, suggestSimilarKeys} from './tool-aliases.js';
import {getToolMeta} from './tools-meta.js';
import {type ToolArgSpec, type ToolArgSpecMap} from './zod-introspect.js';

export interface ValidationSuccess {
  ok: true;
  value: Record<string, unknown>;
}

export interface ValidationFailure {
  ok: false;
  error: string;
}

type TypeValidationResult = {ok: true; value: unknown} | ValidationFailure;

/**
 * 构造给定工具的别名映射。
 * 只保留 "别名目标存在于 schema、别名本身不在 schema" 的条目，
 * 避免遮蔽真正支持的同名参数。
 */
function buildAliasMap(
  toolName: string,
  specs: ToolArgSpecMap,
): Map<string, string> {
  const map = new Map<string, string>();
  const supportedKeys = new Set(Object.keys(specs));
  const aliases = getAliasesForTool(toolName);

  for (const [alias, canonical] of Object.entries(aliases)) {
    if (supportedKeys.has(alias)) {
      // 别名本身就是合法参数 → 不做映射
      continue;
    }
    if (!supportedKeys.has(canonical)) {
      // 映射目标在当前工具上并不存在 → 跳过
      continue;
    }
    map.set(alias, canonical);
  }
  return map;
}

function normalizeRawArgs(
  toolName: string,
  rawArgs: Record<string, unknown>,
  specs: ToolArgSpecMap,
): ValidationSuccess | ValidationFailure {
  const aliases = buildAliasMap(toolName, specs);
  const normalized: Record<string, unknown> = {};
  const supportedKeys = Object.keys(specs);
  const supportedSet = new Set(supportedKeys);

  for (const [rawKey, value] of Object.entries(rawArgs)) {
    const key = aliases.get(rawKey) ?? rawKey;
    if (!supportedSet.has(key)) {
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
    if (!(key in normalized)) {
      normalized[key] = value;
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
    case 'string':
      return typeof value === 'string'
        ? {ok: true, value}
        : {ok: false, error: typeError(toolName, key, '字符串')};
    case 'number': {
      const numValue = coerceNumber(value);
      return typeof numValue === 'number' && Number.isFinite(numValue)
        ? {ok: true, value: numValue}
        : {ok: false, error: typeError(toolName, key, '数字')};
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
