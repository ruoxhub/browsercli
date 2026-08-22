/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {readFileSync} from 'node:fs';
import path from 'node:path';

import type {ParsedArgs} from '../../args-parser.js';
import type {ToolArgSpec, ToolArgSpecMap} from '../../tool-meta-types.js';

export const TOOL_CONTROL_FLAGS: ReadonlySet<string> = new Set([
  'file',
  'data',
  'stdin',
  'session',
  'watch',
]);

/**
 * 尝试把字符串当作 JSON 数组/对象字面量解析。
 * 仅当字符串以 `[`/`]` 或 `{`/`}` 包裹且能成功 JSON.parse 时才解析，
 * 否则原样返回。用于 `--flag '["a","b"]'` / `--flag '{"k":1}'` 这类
 * 数组/对象参数，使其与 `--data` 行为一致，而非被整体当作字符串或按逗号拆分。
 */
function maybeParseJsonLiteral(raw: string): unknown {
  const trimmed = raw.trim();
  const looksLikeLiteral =
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}'));
  if (!looksLikeLiteral) return raw;
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

function inferArgValue(value: string | boolean, spec?: ToolArgSpec): unknown {
  if (typeof value === 'boolean') return value;
  // 声明为 string 的参数（如 evaluate_script 的 function）原样保留，
  // 绝不做 true/false → boolean 或纯数字 → number 的自动转换，
  // 否则服务端会收到非字符串值并报"必须是字符串"校验错误。
  if (spec?.type === 'string') {
    return value;
  }
  if (spec?.type === 'string[]') {
    const parsed = maybeParseJsonLiteral(value);
    if (Array.isArray(parsed)) return parsed;
    return value;
  }
  // 对象参数（如 create_hook 的 params、record_reverse_evidence 的 entry）：
  // 若传入 JSON 对象字面量则解析为对象，否则原样返回交由服务端校验。
  if (spec?.type === 'object') {
    const parsed = maybeParseJsonLiteral(value);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return parsed;
    }
    return value;
  }
  // 其它类型：尝试 JSON 字面量（数组/对象），失败再退回到布尔/数字推断。
  const parsed = maybeParseJsonLiteral(value);
  if (parsed !== value) return parsed;
  if (value === 'true' || value === 'false') return value === 'true';
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** 将 kebab-case 的 CLI flag 名转为 camelCase，对齐工具的 camelCase 参数名。 */
function toCamelCase(flag: string): string {
  return flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
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
 * 读取 --file 参数指定的文件内容并解析。
 * - .json → JSON.parse
 * - .js/.mjs/.ts → 读取文件内容作为 { function: fileContent }（适用于 evaluate_script）
 */
function readArgsFromFile(filePath: string): Record<string, unknown> {
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();
  const raw = readFileSync(resolved, 'utf8');

  if (ext === '.js' || ext === '.mjs' || ext === '.ts') {
    return {function: raw};
  }

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
 * 纯远程 CLI 不持有本地 ToolMeta，因此仅做轻量推断：
 * boolean / number / JSON 自动探测；其余按字符串返回。
 */
function coerceFlagValue(
  rawValue: string | boolean,
  spec?: ToolArgSpec,
): unknown {
  if (typeof rawValue === 'boolean') {
    // consumeFlagValue 在下一参数以 '-' 开头时会将 flag 设为 true。
    // 若该参数声明为 string（如 evaluate_script 的 function），
    // 返回 undefined 让 dispatcher 的位置参数回退逻辑有机会补救。
    if (rawValue === true && spec?.type === 'string') {
      return undefined;
    }
    return rawValue;
  }
  return inferArgValue(rawValue, spec);
}

/**
 * 构建最终调用工具用的参数对象。
 *
 * 优先级（高 → 低）：命令行 flags > --data > --file > --stdin
 *
 * 特殊 flag：
 *   --file path/to/params.json  从 JSON 文件加载基础参数（.js/.mjs/.ts 文件作为 { function: content }）
 *   --data '{"k":"v"}'          行内 JSON 参数包
 *   --stdin                     从 stdin 读取 JSON 参数（最低优先级）
 */
export function buildToolArgs(
  parsed: ParsedArgs,
  argSpecs?: ToolArgSpecMap,
): Record<string, unknown> {
  const toolArgs: Record<string, unknown> = {};

  // 0. 最低优先级：--stdin（从 stdin 读取 JSON）
  if (parsed.flags['stdin'] === true && !process.stdin.isTTY) {
    try {
      // fd 0 在 Windows / Unix 均可用，避免使用 /dev/stdin 这种非可移植路径
      const stdinData = readFileSync(0, 'utf8');
      const stdinArgs = tryParseJsonObject(stdinData);
      if (stdinArgs) {
        Object.assign(toolArgs, stdinArgs);
      }
    } catch {
      // stdin 读取失败时静默忽略
    }
  }

  // 1. 次低优先级：--file
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
    if (TOOL_CONTROL_FLAGS.has(key)) continue;

    const argKey = toCamelCase(key);
    const spec = argSpecs?.[argKey];

    if (typeof value === 'boolean') {
      toolArgs[argKey] = value;
      continue;
    }

    toolArgs[argKey] = coerceFlagValue(value, spec);
  }

  return toolArgs;
}
