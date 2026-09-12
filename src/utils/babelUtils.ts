/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 解包 Babel 的 default 导出。
 *
 * 处理 CJS / ESM 混合导入时常见的 `.default` 问题：
 * - 如果 `mod` 含有 `.default.default`，返回最内层
 * - 如果 `mod` 含有 `.default`，返回 `mod.default`
 * - 否则直接返回 `mod`
 */
export function unwrapBabelDefault<T>(mod: unknown): T {
  const candidate = mod as {default?: unknown};
  if (
    candidate &&
    (typeof candidate === 'object' || typeof candidate === 'function') &&
    'default' in candidate
  ) {
    const inner = candidate.default;
    if (
      inner &&
      (typeof inner === 'object' || typeof inner === 'function') &&
      'default' in inner
    ) {
      return (inner as {default: T}).default;
    }
    return inner as T;
  }
  return mod as T;
}
