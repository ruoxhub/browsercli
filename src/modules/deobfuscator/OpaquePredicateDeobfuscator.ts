/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Opaque Predicates 去混淆器。提取自 AdvancedDeobfuscator.ts。
 *
 * 不透明谓词是指那些结果在编译时已知但在运行时看起来是动态的条件表达式，例如：
 * 1. if (5 > 3) { ... } - 永远为 true
 * 2. if (1 === 2) { ... } - 永远为 false
 * 3. if (x * 0 === 0) { ... } - 永远为 true (对于任何数字 x)
 * 4. if ((x | 0) === x) { ... } - 永远为 true (对于整数 x)
 */

import generateImport from '@babel/generator';
import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {logger} from '../../utils/logger.js';

import {unwrapBabelDefault} from './astUtils.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

// 简单的数字比较运算符 -> 实际比较函数
const NUMERIC_COMPARATORS: Record<string, (l: number, r: number) => boolean> = {
  '>': (l, r) => l > r,
  '<': (l, r) => l < r,
  '>=': (l, r) => l >= r,
  '<=': (l, r) => l <= r,
  '===': (l, r) => l === r,
  '==': (l, r) => l === r,
  '!==': (l, r) => l !== r,
  '!=': (l, r) => l !== r,
};

// 不透明谓词特征（简单的数字字面量比较）
const OPAQUE_PREDICATE_PATTERN = /if\s*\(\s*\d+\s*[<>!=]+\s*\d+\s*\)/;

/**
 * 判断二元表达式是否为 "x * 0" 或 "0 * x" 形式。
 * 用于识别 `x * 0 === 0` 这类恒真不透明谓词。
 */
function isMultiplyByZero(expr: t.BinaryExpression): boolean {
  return (
    (t.isNumericLiteral(expr.left) && expr.left.value === 0) ||
    (t.isNumericLiteral(expr.right) && expr.right.value === 0)
  );
}

export class OpaquePredicateDeobfuscator {
  /**
   * 检测不透明谓词
   */
  static detectOpaquePredicates(code: string): boolean {
    return OPAQUE_PREDICATE_PATTERN.test(code);
  }

  /**
   * 移除不透明谓词
   */
  static removeOpaquePredicates(code: string): string {
    logger.info('Removing opaque predicates...');

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let removed = 0;

      traverse(ast, {
        IfStatement(path) {
          const test = path.node.test;
          if (!t.isBinaryExpression(test)) return;

          // 1) 简单数字字面量比较：if (5 > 3) / if (1 === 2)
          if (t.isNumericLiteral(test.left) && t.isNumericLiteral(test.right)) {
            const comparator = NUMERIC_COMPARATORS[test.operator];
            if (!comparator) return;

            const truthy = comparator(test.left.value, test.right.value);
            if (truthy) {
              path.replaceWith(path.node.consequent);
            } else if (path.node.alternate) {
              path.replaceWith(path.node.alternate);
            } else {
              path.remove();
            }
            removed++;
            return;
          }

          // 2) x * 0 === 0：左操作数含 0 乘子则永真
          if (
            (test.operator === '===' || test.operator === '==') &&
            t.isNumericLiteral(test.right) &&
            test.right.value === 0 &&
            t.isBinaryExpression(test.left) &&
            test.left.operator === '*' &&
            isMultiplyByZero(test.left)
          ) {
            path.replaceWith(path.node.consequent);
            removed++;
          }
        },
      });

      if (removed > 0) {
        logger.info(`Removed ${removed} opaque predicates`);
        return generate(ast, {comments: true, compact: false}).code;
      }

      return code;
    } catch (error) {
      logger.error('Failed to remove opaque predicates:', error);
      return code;
    }
  }
}
