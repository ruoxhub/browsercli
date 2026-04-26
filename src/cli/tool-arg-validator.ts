/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  TOOL_ARG_SPECS,
  type ToolArgSpec,
  type ToolArgSpecMap,
} from './tool-arg-specs.js';

interface ValidationSuccess {
  ok: true;
  value: Record<string, unknown>;
}

interface ValidationFailure {
  ok: false;
  error: string;
}

function buildAliasMap(specs: ToolArgSpecMap): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const [key, spec] of Object.entries(specs)) {
    for (const alias of spec.aliases ?? []) {
      aliases.set(alias, key);
    }
  }

  return aliases;
}

function normalizeRawArgs(
  toolName: string,
  rawArgs: Record<string, unknown>,
  specs: ToolArgSpecMap,
): ValidationSuccess | ValidationFailure {
  const aliases = buildAliasMap(specs);
  const normalized: Record<string, unknown> = {};
  const supportedKeys = new Set(Object.keys(specs));

  for (const [rawKey, value] of Object.entries(rawArgs)) {
    const key = aliases.get(rawKey) ?? rawKey;
    if (!supportedKeys.has(key)) {
      return {
        ok: false,
        error: `不支持参数 --${rawKey}；${toolName} 支持参数：${Array.from(
          supportedKeys,
        ).join(', ')}`,
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
    default:
      return null;
  }
}

export function validateToolArgs(
  toolName: string,
  rawArgs: Record<string, unknown>,
): ValidationSuccess | ValidationFailure {
  const specs = TOOL_ARG_SPECS[toolName];
  if (!specs) {
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
