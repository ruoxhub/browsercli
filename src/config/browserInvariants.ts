/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 环境变量布尔真值词表 —— 唯一来源，`resolver.getEnvBoolean` 也用这一份。
 */
export const ENV_TRUE_VALUES: readonly string[] = ['true', '1', 'yes', 'on'];

/**
 * 环境变量布尔假值词表 —— 唯一来源。
 */
export const ENV_FALSE_VALUES: readonly string[] = ['false', '0', 'no', 'off'];

/**
 * 解析布尔环境变量值：`true/1/yes/on` → true，`false/0/no/off` → false，其余
 * （含 undefined、空串、无法识别）→ undefined。
 *
 * 单列在此是为了让外部模块（如 CLI）能读布尔环境变量而不引入 resolver 及其依赖图。
 */
export function parseEnvBoolean(
  value: string | undefined,
): boolean | undefined {
  const normalized = value?.toLowerCase().trim();
  if (normalized === undefined || normalized === '') return undefined;
  if (ENV_TRUE_VALUES.includes(normalized)) return true;
  if (ENV_FALSE_VALUES.includes(normalized)) return false;
  return undefined;
}

/** 读布尔环境变量：`parseEnvBoolean(process.env[key])` 的便捷形式。 */
export function getEnvFlag(key: string): boolean | undefined {
  return parseEnvBoolean(process.env[key]);
}
