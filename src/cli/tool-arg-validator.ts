/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ToolArgSpec,
  type ToolArgSpecMap,
} from './zod-introspect.js';
import {getToolMeta} from './tools-meta.js';
import {getAliasesForTool, suggestSimilarKeys} from './tool-aliases.js';

interface ValidationSuccess {
  ok: true;
  value: Record<string, unknown>;
}

interface ValidationFailure {
  ok: false;
  error: string;
}

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

function validateType(
  toolName: string,
  key: string,
  spec: ToolArgSpec,
  value: unknown,
): ValidationFailure | null {
  switch (spec.type) {
    case 'string':
      if (typeof value !== 'string') {
        return {
          ok: false,
          error: `${toolName} 的参数 ${key} 必须是字符串`,
        };
      }
      return null;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return {
          ok: false,
          error: `${toolName} 的参数 ${key} 必须是数字`,
        };
      }
      return null;
    case 'boolean':
      if (typeof value !== 'boolean') {
        return {
          ok: false,
          error: `${toolName} 的参数 ${key} 必须是布尔值`,
        };
      }
      return null;
    case 'string[]':
      if (
        !Array.isArray(value) ||
        value.some(item => typeof item !== 'string')
      ) {
        return {
          ok: false,
          error: `${toolName} 的参数 ${key} 必须是字符串数组`,
        };
      }
      return null;
    case 'object':
      if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value)
      ) {
        return {
          ok: false,
          error: `${toolName} 的参数 ${key} 必须是 JSON 对象（提示：用 --data '{...}' 或 --file params.json 传递）`,
        };
      }
      return null;
    default:
      return null;
  }
}

export function validateToolArgs(
  toolName: string,
  rawArgs: Record<string, unknown>,
): ValidationSuccess | ValidationFailure {
  const meta = getToolMeta(toolName);
  const specs = meta?.argSpecs;
  if (!specs || Object.keys(specs).length === 0) {
    return {ok: true, value: rawArgs};
  }

  const normalizedRawArgs = normalizeRawArgs(toolName, rawArgs, specs);
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

    const typeError = validateType(toolName, key, spec, value);
    if (typeError) {
      return typeError;
    }

    if (spec.enum && typeof value === 'string' && !spec.enum.includes(value)) {
      return {
        ok: false,
        error: `${toolName} 的参数 ${key} 仅支持：${spec.enum.join(', ')}`,
      };
    }

    normalized[key] = value;
  }

  return {ok: true, value: normalized};
}
