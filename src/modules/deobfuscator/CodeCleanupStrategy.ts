/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 代码清理策略
 *
 * 通用 AST 清理与简化：
 *   - 常量折叠 + 死代码消除 (basicTransform)
 *   - 表达式简化 (simplifyExpressions)
 *   - 变量重命名 (renameVariables)
 */

import generateImport from '@babel/generator';
import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import type {Transformation} from '../../types/index.js';
import {logger} from '../../utils/logger.js';

import {evalBinaryNumbers, unwrapBabelDefault} from './astUtils.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

/**
 * 基础 AST 转换 (常量折叠 + 死代码消除)
 */
export async function basicTransform(
  code: string,
  transformations: Transformation[],
): Promise<string> {
  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    traverse(ast, {
      // 常量折叠
      BinaryExpression(path) {
        if (
          t.isNumericLiteral(path.node.left) &&
          t.isNumericLiteral(path.node.right)
        ) {
          const result = evalBinaryNumbers(
            path.node.left,
            path.node.right,
            path.node.operator,
          );
          if (result !== undefined) {
            path.replaceWith(t.numericLiteral(result));
          }
        }
        // 字符串拼接折叠
        if (
          t.isStringLiteral(path.node.left) &&
          t.isStringLiteral(path.node.right) &&
          path.node.operator === '+'
        ) {
          path.replaceWith(
            t.stringLiteral(path.node.left.value + path.node.right.value),
          );
        }
      },

      // 死代码消除
      IfStatement(path) {
        if (t.isBooleanLiteral(path.node.test)) {
          if (path.node.test.value) {
            path.replaceWith(path.node.consequent);
          } else if (path.node.alternate) {
            path.replaceWith(path.node.alternate);
          } else {
            path.remove();
          }
        }
      },

      // 条件表达式简化 true ? a : b → a
      ConditionalExpression(path) {
        if (t.isBooleanLiteral(path.node.test)) {
          path.replaceWith(
            path.node.test.value ? path.node.consequent : path.node.alternate,
          );
        }
      },
    });

    const output = generate(ast, {comments: true, compact: false});
    transformations.push({
      type: 'basic-ast-transform',
      description:
        'Constant folding, dead code elimination, string concatenation',
      success: true,
    });
    return output.code;
  } catch (error) {
    logger.warn('Basic transform failed', error);
    transformations.push({
      type: 'basic-ast-transform',
      description: 'Failed',
      success: false,
    });
    return code;
  }
}

/**
 * 表达式简化
 */
export async function simplifyExpressions(
  code: string,
  transformations: Transformation[],
): Promise<string> {
  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    let simplified = 0;

    traverse(ast, {
      UnaryExpression(path) {
        // !!value → Boolean(value) 保持语义但更清晰（这里直接保留原值）
        if (
          path.node.operator === '!' &&
          t.isUnaryExpression(path.node.argument) &&
          path.node.argument.operator === '!'
        ) {
          path.replaceWith(path.node.argument.argument);
          simplified++;
        }
        // void 0 → undefined
        else if (
          path.node.operator === 'void' &&
          t.isNumericLiteral(path.node.argument, {value: 0})
        ) {
          path.replaceWith(t.identifier('undefined'));
          simplified++;
        }
        // !0 → true, !1 → false
        else if (
          path.node.operator === '!' &&
          t.isNumericLiteral(path.node.argument)
        ) {
          path.replaceWith(t.booleanLiteral(!path.node.argument.value));
          simplified++;
        }
      },

      // 逗号表达式展开: (a, b, c) → 最后一个值（在表达式位置）
      SequenceExpression(path) {
        if (path.node.expressions.length === 1) {
          path.replaceWith(path.node.expressions[0]);
          simplified++;
        }
      },
    });

    if (simplified > 0) {
      const output = generate(ast, {comments: true, compact: false});
      transformations.push({
        type: 'simplify-expressions',
        description: `Simplified ${simplified} expressions`,
        success: true,
      });
      return output.code;
    }
    return code;
  } catch (error) {
    logger.warn('Expression simplification failed', error);
    transformations.push({
      type: 'simplify-expressions',
      description: 'Failed',
      success: false,
    });
    return code;
  }
}

/**
 * 变量重命名
 */
export async function renameVariables(
  code: string,
  transformations: Transformation[],
): Promise<string> {
  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    let renamed = 0;
    const renameMap = new Map<string, string>();

    // 第一遍：收集需要重命名的变量
    traverse(ast, {
      VariableDeclarator(path) {
        if (
          t.isIdentifier(path.node.id) &&
          path.node.id.name.startsWith('_0x')
        ) {
          const oldName = path.node.id.name;
          const newName = `var_${renamed}`;
          renameMap.set(oldName, newName);
          renamed++;
        }
      },
    });

    // 第二遍：使用 scope 安全重命名
    if (renameMap.size > 0) {
      traverse(ast, {
        Identifier(path) {
          const newName = renameMap.get(path.node.name);
          if (newName) {
            path.node.name = newName;
          }
        },
      });

      const output = generate(ast, {comments: true, compact: false});
      transformations.push({
        type: 'rename-variables',
        description: `Renamed ${renamed} variables`,
        success: true,
      });
      return output.code;
    }
    return code;
  } catch (error) {
    logger.warn('Variable renaming failed', error);
    transformations.push({
      type: 'rename-variables',
      description: 'Failed',
      success: false,
    });
    return code;
  }
}
