/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ParsedArgs {
  flags: Record<string, string | boolean>;
  positionals: string[];
  unknown: string[];
}

/**
 * 判断字符串是否看起来像一个负数（而非短选项）
 * 规则：以单个 - 开头，后面紧跟数字或 . 数字
 */
function isNegativeNumber(arg: string): boolean {
  return /^-\d/.test(arg) || /^-\.\d/.test(arg);
}

export function parseArgs(rawArgs: string[]): ParsedArgs {
  const result: ParsedArgs = {
    flags: {},
    positionals: [],
    unknown: [],
  };

  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i];

    if (arg.startsWith('--')) {
      // 长选项
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        const key = arg.slice(2, eqIndex);
        const value = arg.slice(eqIndex + 1);
        result.flags[key] = value;
      } else {
        const key = arg.slice(2);
        const next = rawArgs[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          result.flags[key] = next;
          i++;
        } else {
          result.flags[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2 && !isNegativeNumber(arg)) {
      // 短选项 -x
      const key = arg.slice(1);
      const next = rawArgs[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        result.flags[key] = next;
        i++;
      } else {
        result.flags[key] = true;
      }
    } else if (arg.startsWith('-') && arg.length > 2 && !isNegativeNumber(arg)) {
      // 组合短选项 -abc → -a -b -c
      const letters = arg.slice(1).split('');
      for (const letter of letters) {
        result.flags[letter] = true;
      }
    } else {
      result.positionals.push(arg);
    }

    i++;
  }

  return result;
}

export function getFlag(
  args: ParsedArgs,
  key: string,
  defaultValue?: string,
): string | undefined {
  const value = args.flags[key];
  if (value === undefined) return defaultValue;
  if (typeof value === 'boolean') return defaultValue;
  return value;
}

export function hasFlag(args: ParsedArgs, key: string): boolean {
  return key in args.flags;
}

export function getBoolFlag(
  args: ParsedArgs,
  key: string,
  defaultValue = false,
): boolean {
  const value = args.flags[key];
  if (value === undefined) return defaultValue;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1';
}
