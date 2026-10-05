/**
 * @license
 * Copyright 2026 Browser-CLI
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
  return /^-(\d|\.\d)/.test(arg);
}

/**
 * 消费紧跟在 flag 后面的值：若下一个 token 存在且不以 `-` 开头则作为字符串值，
 * 否则视为布尔 flag。返回新的游标位置（已消费时 +1）。
 *
 * 例外：负数（如 `-1`、`-3.14`）虽然以 `-` 开头，但应作为值而非 flag 处理。
 */
function consumeFlagValue(
  rawArgs: string[],
  index: number,
  flags: Record<string, string | boolean>,
  key: string,
): number {
  const next = rawArgs[index + 1];
  if (next !== undefined && (!next.startsWith('-') || isNegativeNumber(next))) {
    flags[key] = next;
    return index + 1;
  }
  flags[key] = true;
  return index;
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
        result.flags[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      } else {
        i = consumeFlagValue(rawArgs, i, result.flags, arg.slice(2));
      }
    } else if (
      arg.startsWith('-') &&
      arg.length === 2 &&
      !isNegativeNumber(arg)
    ) {
      // 短选项 -x
      i = consumeFlagValue(rawArgs, i, result.flags, arg.slice(1));
    } else if (
      arg.startsWith('-') &&
      arg.length > 2 &&
      !isNegativeNumber(arg)
    ) {
      // 组合短选项 -abc → -a -b -c
      for (const letter of arg.slice(1)) {
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
