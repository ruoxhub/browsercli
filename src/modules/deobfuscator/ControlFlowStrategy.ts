/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 控制流还原策略
 *
 * 处理控制流平坦化 (Control Flow Flattening) 的还原：
 *   - while + switch 嵌套模式 → 按执行顺序重组语句
 *   - 典型模式: "0|1|2|3".split("|")
 */

import generateImport from '@babel/generator';
import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import type {Transformation} from '../../types/index.js';
import {logger} from '../../utils/logger.js';
import {unwrapBabelDefault} from './astUtils.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

/**
 * 控制流平坦化还原 (基础版)
 */
export async function unflattenControlFlow(
  code: string,
  transformations: Transformation[],
): Promise<string> {
  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    let unflattened = 0;

    traverse(ast, {
      WhileStatement(path) {
        const body = path.node.body;
        const switchNode =
          t.isBlockStatement(body) && body.body.length === 1
            ? body.body[0]
            : body;

        if (!t.isSwitchStatement(switchNode)) return;

        // 查找调度变量
        const discriminant = switchNode.discriminant;
        if (!t.isMemberExpression(discriminant)) return;

        // 检查是否是典型的 array[index++] 模式
        const obj = discriminant.object;
        if (!t.isIdentifier(obj)) return;

        // 尝试找到调度序列
        const binding = path.scope.getBinding(obj.name);
        if (!binding || !binding.path.isVariableDeclarator()) return;

        const init = binding.path.node.init;
        if (!t.isCallExpression(init)) return;

        // 典型模式: "0|1|2|3".split("|")
        const callee = init.callee;
        if (
          t.isMemberExpression(callee) &&
          t.isStringLiteral(callee.object) &&
          t.isIdentifier(callee.property, {name: 'split'}) &&
          init.arguments.length === 1 &&
          t.isStringLiteral(init.arguments[0], {value: '|'})
        ) {
          const order = callee.object.value.split('|').map(Number);
          const cases = switchNode.cases;

          // 按执行顺序重组 case 的 consequent
          const orderedStatements: t.Statement[] = [];
          for (const idx of order) {
            const matchedCase = cases.find(
              c =>
                t.isStringLiteral(c.test, {value: String(idx)}) ||
                t.isNumericLiteral(c.test, {value: idx}),
            );
            if (matchedCase) {
              for (const stmt of matchedCase.consequent) {
                if (!t.isContinueStatement(stmt) && !t.isBreakStatement(stmt)) {
                  orderedStatements.push(stmt);
                }
              }
            }
          }

          if (orderedStatements.length > 0) {
            path.replaceWithMultiple(orderedStatements);
            unflattened++;
          }
        }
      },
    });

    if (unflattened > 0) {
      const output = generate(ast, {comments: true, compact: false});
      transformations.push({
        type: 'unflatten-control-flow',
        description: `Unflattened ${unflattened} control flow patterns`,
        success: true,
      });
      return output.code;
    }
    return code;
  } catch (error) {
    logger.warn('Control flow unflattening failed', error);
    transformations.push({
      type: 'unflatten-control-flow',
      description: 'Failed',
      success: false,
    });
    return code;
  }
}
