/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 共享的 AST 工具函数（供 AdvancedDeobfuscator、ASTOptimizer、Deobfuscator 共用）。
 *
 * 这里只放纯函数，没有副作用。
 */
import type * as t from '@babel/types';

const BINARY_RESULT_FNS: Record<string, (l: number, r: number) => number> = {
  '+': (l, r) => l + r,
  '-': (l, r) => l - r,
  '*': (l, r) => l * r,
  '/': (l, r) => l / r,
  '%': (l, r) => l % r,
  '**': (l, r) => l ** r,
  '|': (l, r) => l | r,
  '&': (l, r) => l & r,
  '^': (l, r) => l ^ r,
  '<<': (l, r) => l << r,
  '>>': (l, r) => l >> r,
  '>>>': (l, r) => l >>> r,
};

/**
 * 对两个数字字面量做二元运算，结果有限时返回该数字，否则返回 undefined（例如除以 0）。
 */
export function evalBinaryNumbers(
  left: t.NumericLiteral,
  right: t.NumericLiteral,
  operator: string,
): number | undefined {
  const fn = BINARY_RESULT_FNS[operator];
  if (!fn) return undefined;

  const result = fn(left.value, right.value);
  return Number.isFinite(result) ? result : undefined;
}

/**
 * 把一段代码按行/字节截断到 maxLength，避免喂给 LLM 时超 token。
 */
export function truncateCode(code: string, maxLength: number): string {
  if (code.length <= maxLength) return code;
  return code.substring(0, maxLength) + '\n\n// ... (code truncated)';
}

/**
 * 提取 babel 工具的 default 导出，兼容 CJS / ESM 双形态。
 * （@babel/traverse 和 @babel/generator 在不同打包器下默认导出位置不同。）
 */
export function unwrapBabelDefault<T>(mod: unknown): T {
  const wrapped = mod as {default?: T} | T;
  if (typeof wrapped === 'object' && wrapped !== null && 'default' in wrapped) {
    return (wrapped as {default: T}).default;
  }
  return wrapped as T;
}
