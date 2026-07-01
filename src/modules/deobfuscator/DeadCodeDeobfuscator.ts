/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Dead Code Injection 去混淆器。提取自 AdvancedDeobfuscator.ts。
 *
 * 死代码注入是一种常见的混淆技术，包括：
 * 1. if (false) { ... } - 永远不会执行的代码块
 * 2. if (!![] ) { ... } - 永远为 true 的条件
 * 3. 不可达的代码 - return/throw 后的代码
 * 4. 未使用的变量和函数
 */

import generateImport from '@babel/generator';
import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {logger} from '../../utils/logger.js';

import {unwrapBabelDefault} from './astUtils.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

// 死代码注入特征
const DEAD_CODE_PATTERN = /if\s*\(\s*false\s*\)|if\s*\(\s*!!\s*\[\s*\]\s*\)/;

export class DeadCodeDeobfuscator {
  /**
   * 检测死代码注入
   */
  static detectDeadCodeInjection(code: string): boolean {
    return DEAD_CODE_PATTERN.test(code);
  }

  /**
   * 移除死代码
   */
  static removeDeadCode(code: string): string {
    logger.info('Removing dead code...');

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let removed = 0;

      traverse(ast, {
        // 移除 if (false) { ... } 与 if (true) { ... }
        IfStatement(path) {
          const test = path.node.test;

          // if (false) -> 保留 alternate 或删除
          if (t.isBooleanLiteral(test) && test.value === false) {
            if (path.node.alternate) {
              path.replaceWith(path.node.alternate);
            } else {
              path.remove();
            }
            removed++;
            return;
          }

          // if (true) -> 保留 then
          if (t.isBooleanLiteral(test) && test.value === true) {
            path.replaceWith(path.node.consequent);
            removed++;
            return;
          }

          // if (!![]) -> 永远为 true
          if (
            t.isUnaryExpression(test) &&
            test.operator === '!' &&
            t.isUnaryExpression(test.argument) &&
            test.argument.operator === '!' &&
            t.isArrayExpression(test.argument.argument)
          ) {
            path.replaceWith(path.node.consequent);
            removed++;
          }
        },

        // 移除 return/throw 后的不可达代码
        BlockStatement(path) {
          const body = path.node.body;
          let foundTerminator = false;
          const newBody: t.Statement[] = [];

          for (const stmt of body) {
            if (foundTerminator) {
              // 跳过 return/throw 后的代码
              removed++;
              continue;
            }

            newBody.push(stmt);

            if (t.isReturnStatement(stmt) || t.isThrowStatement(stmt)) {
              foundTerminator = true;
            }
          }

          if (newBody.length < body.length) {
            path.node.body = newBody;
          }
        },
      });

      if (removed > 0) {
        logger.info(`Removed ${removed} dead code blocks`);
        return generate(ast, {comments: true, compact: false}).code;
      }

      return code;
    } catch (error) {
      logger.error('Failed to remove dead code:', error);
      return code;
    }
  }
}
