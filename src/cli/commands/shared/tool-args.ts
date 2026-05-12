/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {readFileSync} from 'node:fs';
import path from 'node:path';

import type {ParsedArgs} from '../../args-parser.js';
import type {ToolMeta} from '../../tools-meta.js';

type ToolArgCoercer = (value: string | boolean) => unknown;

const schemaCoercers: Record<string, ToolArgCoercer> = {
  boolean: value => value === true || value === 'true' || value === '1',
  number: value => Number(value),
  string: value => value,
};

function inferArgValue(value: string | boolean): unknown {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.includes(',')) return value.split(',').map(s => s.trim());
  return value;
}

/**
 * 尝试把字符串解析为 JSON 对象；失败则返回 undefined。
 * 只接受 { 开头的内容，数组/原始值交由其它路径处理。
 */
function tryParseJsonObject(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse error; caller will decide how to report
  }
  return undefined;
}

/**
 * 读取 --file 参数指定的文件内容并解析为 JSON。
 */
function readArgsFromFile(filePath: string): Record<string, unknown> {
  const resolved = path.resolve(filePath);
  const raw = readFileSync(resolved, 'utf8');
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`--file 参数指定的文件 ${resolved} 不是有效的 JSON`);
  }
}

/**
 * 解析 --data 参数（JSON 字符串）。
 * 接受 `--data '{"key":"value"}'`，返回 parsed object。
 */
function parseDataFlag(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('--data 参数必须是非空 JSON 字符串');
  }
  const parsed = tryParseJsonObject(value);
  if (!parsed) {
    throw new Error(`--data 参数不是有效的 JSON 对象：${value.slice(0, 80)}`);
  }
  return parsed;
}

/**
 * 为单个 CLI flag 做类型强制转换。
 * 对于 object 类型，优先尝试把字符串当 JSON 解析；
 * 失败则交回原值，由 validator 报错（有明确的错误提示）。
 */
function coerceFlagValue(
  key: string,
  rawValue: string | boolean,
  meta: ToolMeta,
): unknown {
  if (typeof rawValue === 'boolean') {
    return rawValue;
  }
  const schemaType = meta.schema[key];
  if (schemaType === 'object') {
    const parsed = tryParseJsonObject(rawValue);
    return parsed ?? rawValue;
  }
  const coerce = schemaCoercers[schemaType];
  return coerce ? coerce(rawValue) : inferArgValue(rawValue);
}

/**
 * 构建最终调用工具用的参数对象。
 *
 * 优先级（高 → 低）：命令行 flags > --data > --file
 *
 * 特殊 flag：
 *   --file path/to/params.json  从 JSON 文件加载基础参数
 *   --data '{"k":"v"}'          行内 JSON 参数包
 *
 * 对于 schema 类型为 object 的字段，单独传 --key '{"..."}'
 * 时会被自动解析为对象。
 */
export function buildToolArgs(
  parsed: ParsedArgs,
  meta: ToolMeta,
): Record<string, unknown> {
  const toolArgs: Record<string, unknown> = {};

  // 1. 最低优先级：--file
  const filePath = parsed.flags['file'];
  if (typeof filePath === 'string' && filePath.length > 0) {
    const fileArgs = readArgsFromFile(filePath);
    Object.assign(toolArgs, fileArgs);
  }

  // 2. 中优先级：--data (inline JSON)
  if (parsed.flags['data'] !== undefined) {
    const dataArgs = parseDataFlag(parsed.flags['data']);
    Object.assign(toolArgs, dataArgs);
  }

  // 3. 最高优先级：单个命令行 flag
  for (const [key, value] of Object.entries(parsed.flags)) {
    if (key === 'file' || key === 'data') continue;

    if (typeof value === 'boolean') {
      toolArgs[key] = value;
      continue;
    }

    toolArgs[key] = coerceFlagValue(key, value, meta);
  }

  return toolArgs;
}
